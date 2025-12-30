// Created by Yanjunhui

import { Pager, BTree } from '../storage';
import { BSONDocument, BSONValue, ObjectId, BSONEncoder, BSONDecoder, cloneBSONValue, getValueByPath, Timestamp } from '../bson';
import { MonoError, MAX_DOCUMENT_SIZE, logger, AsyncMutex } from '../core';
import { IndexManager, IndexMeta, DocumentFinder } from './indexManager';

/**
 * Collection metadata
 */
export interface CollectionInfo {
    name: string;
    dataPageId: number;
    indexRootPageId: number;
    documentCount: number;
    indexes: IndexMeta[];
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Insert result
 */
export interface InsertResult {
    insertedId: any;
    acknowledged: boolean;
}

/**
 * Insert many result
 */
export interface InsertManyResult {
    insertedIds: any[];
    insertedCount: number;
    acknowledged: boolean;
}

/**
 * Update result
 */
export interface UpdateResult {
    matchedCount: number;
    modifiedCount: number;
    upsertedId?: any;
    acknowledged: boolean;
}

/**
 * Delete result
 */
export interface DeleteResult {
    deletedCount: number;
    acknowledged: boolean;
}

/**
 * Find options
 */
export interface FindOptions {
    filter?: BSONDocument;
    projection?: BSONDocument;
    sort?: BSONDocument;
    skip?: number;
    limit?: number;
    batchSize?: number;
}

/**
 * Inserted record tracking for rollback
 */
interface InsertedRecord {
    id: BSONValue;
    idKey: Buffer;
}

/**
 * Collection class (aligned with Go/Swift versions)
 * 
 * Features:
 * - Full CRUD operations
 * - Index management integration
 * - Rollback support for data consistency
 * - Unique constraint enforcement
 */
export class Collection implements DocumentFinder {
    readonly name: string;
    private pager: Pager;
    private info: CollectionInfo;
    private dataTree: BTree | null = null;
    private indexManager: IndexManager;
    private encoder: BSONEncoder;
    private decoder: BSONDecoder;
    private writeQueue: AsyncMutex = new AsyncMutex();

    constructor(name: string, pager: Pager, info: CollectionInfo) {
        this.name = name;
        this.pager = pager;
        this.info = {
            ...info,
            indexes: info.indexes || [],
        };
        this.encoder = new BSONEncoder();
        this.decoder = new BSONDecoder();
        this.indexManager = new IndexManager(pager);
        this.indexManager.setDocumentFinder(this);
    }

    /**
     * Initialize collection trees and restore indexes
     */
    async init(): Promise<void> {
        if (this.info.dataPageId > 0) {
            this.dataTree = new BTree(this.pager, this.info.dataPageId);
        } else {
            // Create new data tree
            this.dataTree = await BTree.create(this.pager);
            this.info.dataPageId = this.dataTree.getRootPageId();
        }

        // Restore indexes from catalog
        if (this.info.indexes && this.info.indexes.length > 0) {
            await this.indexManager.restoreIndexes(this.info.indexes);
        }
    }

    /**
     * Get collection info
     */
    getInfo(): CollectionInfo {
        return {
            ...this.info,
            indexes: this.indexManager.getIndexMetas(),
        };
    }

    /**
     * Get index manager
     */
    getIndexManager(): IndexManager {
        return this.indexManager;
    }

    // ==================== DocumentFinder Implementation ====================

    /**
     * Find documents without holding locks (for index building)
     */
    async findUnlocked(filter: BSONDocument | null): Promise<BSONDocument[]> {
        return this.find({ filter: filter || {} });
    }

    // ==================== Insert Operations ====================

    /**
     * Insert a single document (public API with write lock)
     */
    async insertOne(doc: BSONDocument): Promise<InsertResult> {
        return this.writeQueue.withLock(() => this.insertOneLocked(doc));
    }

    /**
     * Insert a single document (internal, requires writeQueue protection)
     *
     * P0 FIX: Implements rollback on failure
     * 1. Check unique constraints
     * 2. Write document to data tree
     * 3. Update indexes
     * 4. On failure at any step, rollback previous changes
     */
    private async insertOneLocked(doc: BSONDocument): Promise<InsertResult> {
        // Ensure _id exists
        const docToInsert = cloneBSONValue(doc) as BSONDocument;
        if (docToInsert._id === undefined) {
            docToInsert._id = new ObjectId();
        }

        // Validate and encode document
        const encoded = this.encodeDocument(docToInsert);
        if (encoded.length > MAX_DOCUMENT_SIZE) {
            throw MonoError.documentTooLarge(encoded.length, MAX_DOCUMENT_SIZE);
        }

        // Get _id as key
        const idKey = this.encodeId(docToInsert._id);

        // Check for duplicate _id
        const existing = await this.dataTree!.search(idKey);
        if (existing) {
            throw MonoError.duplicateKey('_id', docToInsert._id);
        }

        // Check unique constraints on secondary indexes
        await this.indexManager.checkUniqueConstraints(docToInsert);

        // Insert into data tree
        await this.dataTree!.insert(idKey, encoded);

        // Update indexes
        try {
            await this.indexManager.insertDocument(docToInsert);
        } catch (err) {
            // P0 CRITICAL FIX: Rollback data tree insert on index failure
            try {
                await this.dataTree!.delete(idKey);
            } catch (rollbackErr) {
                logger.error('Failed to rollback data insert', {
                    id: docToInsert._id,
                    error: String(rollbackErr),
                });
            }
            throw err;
        }

        this.info.documentCount++;
        this.info.updatedAt = new Date();

        return {
            insertedId: docToInsert._id,
            acknowledged: true,
        };
    }

    /**
     * Insert multiple documents (public API with write lock)
     *
     * P0 FIX: Implements partial rollback on failure
     */
    async insertMany(docs: BSONDocument[]): Promise<InsertManyResult> {
        return this.writeQueue.withLock(async () => {
            const insertedIds: any[] = [];
            const insertedRecords: InsertedRecord[] = [];

            for (const doc of docs) {
                try {
                    // Use insertOneLocked to avoid nested lock
                    const result = await this.insertOneLocked(doc);
                    insertedIds.push(result.insertedId);
                    insertedRecords.push({
                        id: result.insertedId,
                        idKey: this.encodeId(result.insertedId),
                    });
                } catch (err) {
                    // P0 CRITICAL FIX: Rollback all previously inserted documents
                    await this.rollbackInsertedRecords(insertedRecords);
                    throw err;
                }
            }

            return {
                insertedIds,
                insertedCount: insertedIds.length,
                acknowledged: true,
            };
        });
    }

    /**
     * Rollback inserted records on batch insert failure
     */
    private async rollbackInsertedRecords(records: InsertedRecord[]): Promise<void> {
        for (let i = records.length - 1; i >= 0; i--) {
            const record = records[i];
            try {
                // Get document for index cleanup
                const encoded = await this.dataTree!.search(record.idKey);
                if (encoded) {
                    const doc = this.decoder.decode(encoded);
                    // Delete from indexes
                    try {
                        await this.indexManager.deleteDocument(doc);
                    } catch (indexErr) {
                        logger.error('Failed to rollback index entry', {
                            id: record.id,
                            error: String(indexErr),
                        });
                    }
                }
                // Delete from data tree
                await this.dataTree!.delete(record.idKey);
                this.info.documentCount--;
            } catch (err) {
                logger.error('Failed to rollback inserted record', {
                    id: record.id,
                    error: String(err),
                });
            }
        }
    }

    // ==================== Find Operations ====================

    /**
     * Find documents matching filter
     */
    async find(options: FindOptions = {}): Promise<BSONDocument[]> {
        const allDocs = await this.dataTree!.getAll();
        let results: BSONDocument[] = [];

        // Decode and filter
        for (const encoded of allDocs) {
            const doc = this.decoder.decode(encoded);
            if (this.matchesFilter(doc, options.filter || {})) {
                results.push(doc);
            }
        }

        // Sort
        if (options.sort) {
            results = this.sortDocuments(results, options.sort);
        }

        // Skip
        if (options.skip && options.skip > 0) {
            results = results.slice(options.skip);
        }

        // Limit
        if (options.limit && options.limit > 0) {
            results = results.slice(0, options.limit);
        }

        // Project
        if (options.projection) {
            results = results.map(doc => this.applyProjection(doc, options.projection!));
        }

        return results;
    }

    /**
     * Find a single document
     */
    async findOne(filter: BSONDocument = {}, projection?: BSONDocument): Promise<BSONDocument | null> {
        const results = await this.find({ filter, projection, limit: 1 });
        return results.length > 0 ? results[0] : null;
    }

    /**
     * Find document by _id
     */
    async findById(id: any): Promise<BSONDocument | null> {
        const idKey = this.encodeId(id);
        const encoded = await this.dataTree!.search(idKey);
        if (!encoded) {
            return null;
        }
        return this.decoder.decode(encoded);
    }

    // ==================== Update Operations ====================

    /**
     * Update documents matching filter (public API with write lock)
     */
    async updateMany(filter: BSONDocument, update: BSONDocument): Promise<UpdateResult> {
        return this.writeQueue.withLock(async () => {
            const docs = await this.find({ filter });
            let modifiedCount = 0;

            for (const doc of docs) {
                const oldDoc = cloneBSONValue(doc) as BSONDocument;
                const updatedDoc = await this.applyUpdate(doc, update);

                // Check unique constraints (excluding current document)
                await this.indexManager.checkUniqueConstraints(updatedDoc, oldDoc._id);

                // Delete old index entries
                await this.indexManager.deleteDocument(oldDoc);

                // Update data
                const idKey = this.encodeId(doc._id);
                const encoded = this.encodeDocument(updatedDoc);
                await this.dataTree!.insert(idKey, encoded);

                // Insert new index entries
                try {
                    await this.indexManager.insertDocument(updatedDoc);
                } catch (err) {
                    // Rollback: restore old index entries
                    try {
                        await this.indexManager.insertDocument(oldDoc);
                    } catch (rollbackErr) {
                        logger.error('Failed to rollback index update', {
                            id: doc._id,
                            error: String(rollbackErr),
                        });
                    }
                    throw err;
                }

                modifiedCount++;
            }

            this.info.updatedAt = new Date();

            return {
                matchedCount: docs.length,
                modifiedCount,
                acknowledged: true,
            };
        });
    }

    /**
     * Update a single document (public API with write lock)
     * @param filter - Filter to match document
     * @param update - Update operations to apply
     * @param upsert - If true, insert a new document if no match found
     */
    async updateOne(filter: BSONDocument, update: BSONDocument, upsert: boolean = false): Promise<UpdateResult> {
        return this.writeQueue.withLock(async () => {
            const doc = await this.findOne(filter);
            if (!doc) {
                if (!upsert) {
                    return {
                        matchedCount: 0,
                        modifiedCount: 0,
                        acknowledged: true,
                    };
                }
                // Upsert: create new document (use insertOneLocked to avoid nested lock)
                const newDoc = this.buildUpsertDocument(filter, update);
                const insertResult = await this.insertOneLocked(newDoc);
                return {
                    matchedCount: 0,
                    modifiedCount: 0,
                    upsertedId: insertResult.insertedId,
                    acknowledged: true,
                };
            }

            const oldDoc = cloneBSONValue(doc) as BSONDocument;
            const updatedDoc = await this.applyUpdate(doc, update);

            // Check unique constraints (excluding current document)
            await this.indexManager.checkUniqueConstraints(updatedDoc, oldDoc._id);

            // Delete old index entries
            await this.indexManager.deleteDocument(oldDoc);

            // Update data
            const idKey = this.encodeId(doc._id);
            const encoded = this.encodeDocument(updatedDoc);
            await this.dataTree!.insert(idKey, encoded);

            // Insert new index entries
            try {
                await this.indexManager.insertDocument(updatedDoc);
            } catch (err) {
                // Rollback: restore old index entries
                try {
                    await this.indexManager.insertDocument(oldDoc);
                } catch (rollbackErr) {
                    logger.error('Failed to rollback index update', {
                        id: doc._id,
                        error: String(rollbackErr),
                    });
                }
                throw err;
            }

            this.info.updatedAt = new Date();

            return {
                matchedCount: 1,
                modifiedCount: 1,
                acknowledged: true,
            };
        });
    }

    /**
     * Replace a single document (public API with write lock)
     */
    async replaceOne(filter: BSONDocument, replacement: BSONDocument): Promise<UpdateResult> {
        return this.writeQueue.withLock(async () => {
            const doc = await this.findOne(filter);
            if (!doc) {
                return {
                    matchedCount: 0,
                    modifiedCount: 0,
                    acknowledged: true,
                };
            }

            const oldDoc = cloneBSONValue(doc) as BSONDocument;

            // Keep original _id
            const newDoc = cloneBSONValue(replacement) as BSONDocument;
            newDoc._id = doc._id;

            // Check unique constraints (excluding current document)
            await this.indexManager.checkUniqueConstraints(newDoc, oldDoc._id);

            // Delete old index entries
            await this.indexManager.deleteDocument(oldDoc);

            // Update data
            const idKey = this.encodeId(doc._id);
            const encoded = this.encodeDocument(newDoc);
            await this.dataTree!.insert(idKey, encoded);

            // Insert new index entries
            try {
                await this.indexManager.insertDocument(newDoc);
            } catch (err) {
                // Rollback: restore old index entries
                try {
                    await this.indexManager.insertDocument(oldDoc);
                } catch (rollbackErr) {
                    logger.error('Failed to rollback index replace', {
                        id: doc._id,
                        error: String(rollbackErr),
                    });
                }
                throw err;
            }

            this.info.updatedAt = new Date();

            return {
                matchedCount: 1,
                modifiedCount: 1,
                acknowledged: true,
            };
        });
    }

    // ==================== Delete Operations ====================

    /**
     * Delete documents matching filter (public API with write lock)
     *
     * P0 FIX: Delete indexes BEFORE data, with rollback on failure
     */
    async deleteMany(filter: BSONDocument): Promise<DeleteResult> {
        return this.writeQueue.withLock(async () => {
            const docs = await this.find({ filter });
            let deletedCount = 0;

            for (const doc of docs) {
                // P0 FIX: Delete from indexes first
                await this.indexManager.deleteDocument(doc);

                const idKey = this.encodeId(doc._id);
                try {
                    const deleted = await this.dataTree!.delete(idKey);
                    if (deleted) {
                        deletedCount++;
                        this.info.documentCount--;
                    }
                } catch (err) {
                    // P0 CRITICAL FIX: Restore index entries on data delete failure
                    try {
                        await this.indexManager.insertDocument(doc);
                    } catch (rollbackErr) {
                        logger.error('CRITICAL: Failed to restore index after delete failure', {
                            id: doc._id,
                            error: String(rollbackErr),
                        });
                    }
                    throw err;
                }
            }

            this.info.updatedAt = new Date();

            return {
                deletedCount,
                acknowledged: true,
            };
        });
    }

    /**
     * Delete a single document (public API with write lock)
     *
     * P0 FIX: Delete indexes BEFORE data, with rollback on failure
     */
    async deleteOne(filter: BSONDocument): Promise<DeleteResult> {
        return this.writeQueue.withLock(async () => {
            const doc = await this.findOne(filter);
            if (!doc) {
                return {
                    deletedCount: 0,
                    acknowledged: true,
                };
            }

            // P0 FIX: Delete from indexes first
            await this.indexManager.deleteDocument(doc);

            const idKey = this.encodeId(doc._id);
            try {
                await this.dataTree!.delete(idKey);
            } catch (err) {
                // P0 CRITICAL FIX: Restore index entries on data delete failure
                try {
                    await this.indexManager.insertDocument(doc);
                } catch (rollbackErr) {
                    logger.error('CRITICAL: Failed to restore index after delete failure', {
                        id: doc._id,
                        error: String(rollbackErr),
                    });
                }
                throw err;
            }

            this.info.documentCount--;
            this.info.updatedAt = new Date();

            return {
                deletedCount: 1,
                acknowledged: true,
            };
        });
    }

    // ==================== Count & Distinct ====================

    /**
     * Count documents matching filter
     */
    async countDocuments(filter: BSONDocument = {}): Promise<number> {
        if (Object.keys(filter).length === 0) {
            return this.info.documentCount;
        }
        const docs = await this.find({ filter });
        return docs.length;
    }

    /**
     * Get distinct values for a field
     */
    async distinct(field: string, filter: BSONDocument = {}): Promise<any[]> {
        const docs = await this.find({ filter });
        const values = new Set<string>();
        const result: any[] = [];

        for (const doc of docs) {
            const value = getValueByPath(doc, field);
            if (value !== undefined) {
                const key = JSON.stringify(value);
                if (!values.has(key)) {
                    values.add(key);
                    result.push(value);
                }
            }
        }

        return result;
    }

    // ==================== Index Operations ====================

    /**
     * Create an index (public API with write lock)
     */
    async createIndex(keys: BSONDocument, options: BSONDocument = {}): Promise<string> {
        return this.writeQueue.withLock(() => this.indexManager.createIndex(keys, options));
    }

    /**
     * Drop an index (public API with write lock)
     */
    async dropIndex(name: string): Promise<void> {
        return this.writeQueue.withLock(() => this.indexManager.dropIndex(name));
    }

    /**
     * List all indexes
     */
    listIndexes(): BSONDocument[] {
        return this.indexManager.listIndexes();
    }

    // ==================== Helper Methods ====================

    private encodeDocument(doc: BSONDocument): Buffer {
        return this.encoder.encode(doc);
    }

    private encodeId(id: any): Buffer {
        if (id instanceof ObjectId) {
            return Buffer.from(id.id);
        }
        return this.encoder.encode({ _id: id });
    }

    private matchesFilter(doc: BSONDocument, filter: BSONDocument): boolean {
        for (const [key, value] of Object.entries(filter)) {
            if (key.startsWith('$')) {
                // Logical operators
                if (!this.matchLogicalOperator(doc, key, value)) {
                    return false;
                }
            } else {
                // Field match
                const docValue = getValueByPath(doc, key);
                if (!this.matchFieldValue(docValue, value)) {
                    return false;
                }
            }
        }
        return true;
    }

    private matchLogicalOperator(doc: BSONDocument, op: string, value: any): boolean {
        switch (op) {
            case '$and':
                return (value as BSONDocument[]).every(cond => this.matchesFilter(doc, cond));
            case '$or':
                return (value as BSONDocument[]).some(cond => this.matchesFilter(doc, cond));
            case '$nor':
                return !(value as BSONDocument[]).some(cond => this.matchesFilter(doc, cond));
            case '$not':
                return !this.matchesFilter(doc, value);
            default:
                return true;
        }
    }

    private matchFieldValue(docValue: any, filterValue: any): boolean {
        if (filterValue === null) {
            return docValue === null || docValue === undefined;
        }

        if (typeof filterValue === 'object' && !Array.isArray(filterValue) &&
            !(filterValue instanceof ObjectId) && !(filterValue instanceof Date)) {
            // Check for operators
            for (const [op, opValue] of Object.entries(filterValue)) {
                if (op.startsWith('$')) {
                    if (!this.matchOperator(docValue, op, opValue)) {
                        return false;
                    }
                }
            }
            // If no operators, treat as equality
            if (!Object.keys(filterValue).some(k => k.startsWith('$'))) {
                return this.equals(docValue, filterValue);
            }
            return true;
        }

        return this.equals(docValue, filterValue);
    }

    private matchOperator(docValue: any, op: string, opValue: any): boolean {
        switch (op) {
            case '$eq':
                return this.equals(docValue, opValue);
            case '$ne':
                return !this.equals(docValue, opValue);
            case '$gt':
                return this.compare(docValue, opValue) > 0;
            case '$gte':
                return this.compare(docValue, opValue) >= 0;
            case '$lt':
                return this.compare(docValue, opValue) < 0;
            case '$lte':
                return this.compare(docValue, opValue) <= 0;
            case '$in':
                return (opValue as any[]).some(v => this.equals(docValue, v));
            case '$nin':
                return !(opValue as any[]).some(v => this.equals(docValue, v));
            case '$exists':
                return opValue ? docValue !== undefined : docValue === undefined;
            case '$type':
                return this.matchType(docValue, opValue);
            case '$regex':
                return this.matchRegex(docValue, opValue);
            case '$size':
                return Array.isArray(docValue) && docValue.length === opValue;
            case '$all':
                return Array.isArray(docValue) &&
                    (opValue as any[]).every(v => docValue.some(dv => this.equals(dv, v)));
            case '$elemMatch':
                return Array.isArray(docValue) &&
                    docValue.some(item => this.matchesFilter(item, opValue));
            case '$mod':
                const [divisor, remainder] = opValue as [number, number];
                return typeof docValue === 'number' && docValue % divisor === remainder;
            case '$not':
                return !this.matchFieldValue(docValue, opValue);
            default:
                return true;
        }
    }

    private matchType(docValue: any, typeValue: any): boolean {
        const typeMap: Record<string, string> = {
            'double': 'number',
            'string': 'string',
            'object': 'object',
            'array': 'array',
            'bool': 'boolean',
            'date': 'Date',
            'null': 'null',
            'int': 'number',
            'long': 'bigint',
        };

        const expectedType = typeof typeValue === 'string' ? typeMap[typeValue] : null;
        if (!expectedType) return false;

        if (expectedType === 'null') return docValue === null;
        if (expectedType === 'array') return Array.isArray(docValue);
        if (expectedType === 'Date') return docValue instanceof Date;
        return typeof docValue === expectedType;
    }

    private matchRegex(docValue: any, pattern: any): boolean {
        if (typeof docValue !== 'string') return false;
        const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
        return regex.test(docValue);
    }

    private equals(a: any, b: any): boolean {
        if (a === b) return true;
        if (a === null || b === null) return a === b;
        if (a === undefined || b === undefined) return a === b;

        if (a instanceof ObjectId && b instanceof ObjectId) {
            return a.equals(b);
        }
        if (a instanceof Date && b instanceof Date) {
            return a.getTime() === b.getTime();
        }
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            return a.every((v, i) => this.equals(v, b[i]));
        }
        if (typeof a === 'object' && typeof b === 'object') {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) return false;
            return keysA.every(k => this.equals(a[k], b[k]));
        }
        return false;
    }

    private compare(a: any, b: any): number {
        if (a === b) return 0;
        if (a === null || a === undefined) return -1;
        if (b === null || b === undefined) return 1;

        if (typeof a === 'number' && typeof b === 'number') {
            return a - b;
        }
        if (typeof a === 'string' && typeof b === 'string') {
            return a.localeCompare(b);
        }
        if (a instanceof Date && b instanceof Date) {
            return a.getTime() - b.getTime();
        }

        return String(a).localeCompare(String(b));
    }

    private sortDocuments(docs: BSONDocument[], sort: BSONDocument): BSONDocument[] {
        const sortKeys = Object.entries(sort);
        return [...docs].sort((a, b) => {
            for (const [key, direction] of sortKeys) {
                const aVal = getValueByPath(a, key);
                const bVal = getValueByPath(b, key);
                const cmp = this.compare(aVal, bVal);
                if (cmp !== 0) {
                    return (direction as number) > 0 ? cmp : -cmp;
                }
            }
            return 0;
        });
    }

    private applyProjection(doc: BSONDocument, projection: BSONDocument): BSONDocument {
        const isInclusion = Object.values(projection).some(v => v === 1 || v === true);

        if (isInclusion) {
            const result: BSONDocument = {};
            // Always include _id unless explicitly excluded
            if (projection._id !== 0 && projection._id !== false) {
                result._id = doc._id;
            }
            for (const [key, value] of Object.entries(projection)) {
                if (key === '_id') continue;
                if (value === 1 || value === true) {
                    const val = getValueByPath(doc, key);
                    if (val !== undefined) {
                        result[key] = val;
                    }
                }
            }
            return result;
        } else {
            const result = cloneBSONValue(doc) as BSONDocument;
            for (const [key, value] of Object.entries(projection)) {
                if (value === 0 || value === false) {
                    delete result[key];
                }
            }
            return result;
        }
    }

    /**
     * Build document for upsert operation
     * Combines filter equality conditions with update operations
     */
    private buildUpsertDocument(filter: BSONDocument, update: BSONDocument): BSONDocument {
        const doc: BSONDocument = {};

        // Extract equality conditions from filter
        for (const [key, value] of Object.entries(filter)) {
            if (!key.startsWith('$')) {
                // Simple equality or object with operators
                if (typeof value === 'object' && value !== null && !Array.isArray(value) &&
                    !(value instanceof ObjectId) && !(value instanceof Date)) {
                    // Check if it's an operator object
                    const keys = Object.keys(value);
                    if (keys.length > 0 && keys[0].startsWith('$')) {
                        // Operator object, extract $eq if present
                        if ('$eq' in value) {
                            this.setPath(doc, key, (value as BSONDocument).$eq);
                        }
                        continue;
                    }
                }
                // Direct value
                this.setPath(doc, key, value);
            }
        }

        // Apply update operations
        for (const [op, value] of Object.entries(update)) {
            if (op === '$set' || op === '$setOnInsert') {
                for (const [k, v] of Object.entries(value as BSONDocument)) {
                    this.setPath(doc, k, v);
                }
            }
        }

        // Generate _id if not present
        if (!doc._id) {
            doc._id = new ObjectId();
        }

        return doc;
    }

    private async applyUpdate(doc: BSONDocument, update: BSONDocument): Promise<BSONDocument> {
        const result = cloneBSONValue(doc) as BSONDocument;

        for (const [op, value] of Object.entries(update)) {
            switch (op) {
                case '$set':
                    for (const [k, v] of Object.entries(value as BSONDocument)) {
                        this.setPath(result, k, v);
                    }
                    break;
                case '$unset':
                    for (const k of Object.keys(value as BSONDocument)) {
                        this.deletePath(result, k);
                    }
                    break;
                case '$inc':
                    for (const [k, v] of Object.entries(value as BSONDocument)) {
                        const current = getValueByPath(result, k) || 0;
                        this.setPath(result, k, (current as number) + (v as number));
                    }
                    break;
                case '$mul':
                    for (const [k, v] of Object.entries(value as BSONDocument)) {
                        const current = getValueByPath(result, k) || 0;
                        this.setPath(result, k, (current as number) * (v as number));
                    }
                    break;
                case '$min':
                    for (const [k, v] of Object.entries(value as BSONDocument)) {
                        const current = getValueByPath(result, k);
                        if (current === undefined || this.compare(v, current) < 0) {
                            this.setPath(result, k, v);
                        }
                    }
                    break;
                case '$max':
                    for (const [k, v] of Object.entries(value as BSONDocument)) {
                        const current = getValueByPath(result, k);
                        if (current === undefined || this.compare(v, current) > 0) {
                            this.setPath(result, k, v);
                        }
                    }
                    break;
                case '$push':
                    for (const [k, v] of Object.entries(value as BSONDocument)) {
                        let arr = getValueByPath(result, k) as any[] || [];
                        if (!Array.isArray(arr)) arr = [];
                        if (v && typeof v === 'object' && '$each' in v) {
                            arr.push(...((v as BSONDocument).$each as any[]));
                        } else {
                            arr.push(v);
                        }
                        this.setPath(result, k, arr);
                    }
                    break;
                case '$pull':
                    for (const [k, v] of Object.entries(value as BSONDocument)) {
                        let arr = getValueByPath(result, k) as any[];
                        if (Array.isArray(arr)) {
                            arr = arr.filter(item => !this.equals(item, v));
                            this.setPath(result, k, arr);
                        }
                    }
                    break;
                case '$pullAll':
                    for (const [k, v] of Object.entries(value as BSONDocument)) {
                        let arr = getValueByPath(result, k) as any[];
                        if (Array.isArray(arr) && Array.isArray(v)) {
                            arr = arr.filter(item => !(v as any[]).some(pv => this.equals(item, pv)));
                            this.setPath(result, k, arr);
                        }
                    }
                    break;
                case '$addToSet':
                    for (const [k, v] of Object.entries(value as BSONDocument)) {
                        let arr = getValueByPath(result, k) as any[] || [];
                        if (!Array.isArray(arr)) arr = [];
                        const values = v && typeof v === 'object' && '$each' in v ? (v as BSONDocument).$each as any[] : [v];
                        for (const item of values) {
                            if (!arr.some(existing => this.equals(existing, item))) {
                                arr.push(item);
                            }
                        }
                        this.setPath(result, k, arr);
                    }
                    break;
                case '$pop':
                    for (const [k, v] of Object.entries(value as BSONDocument)) {
                        const arr = getValueByPath(result, k) as any[];
                        if (Array.isArray(arr) && arr.length > 0) {
                            if ((v as number) > 0) {
                                arr.pop();
                            } else {
                                arr.shift();
                            }
                            this.setPath(result, k, arr);
                        }
                    }
                    break;
                case '$rename':
                    for (const [oldName, newName] of Object.entries(value as BSONDocument)) {
                        const val = getValueByPath(result, oldName);
                        if (val !== undefined) {
                            this.deletePath(result, oldName);
                            this.setPath(result, newName as string, val);
                        }
                    }
                    break;
                case '$currentDate':
                    for (const [k, v] of Object.entries(value as BSONDocument)) {
                        const now = new Date();
                        if (v === true) {
                            // true means set to DateTime
                            this.setPath(result, k, now);
                        } else if (typeof v === 'object' && v !== null && '$type' in v) {
                            // Check for $type specification
                            const typeName = (v as BSONDocument).$type;
                            if (typeName === 'timestamp') {
                                // Set to BSON Timestamp
                                this.setPath(result, k, new Timestamp({ t: Math.floor(now.getTime() / 1000), i: 0 }));
                            } else {
                                this.setPath(result, k, now);
                            }
                        } else {
                            // Default to DateTime
                            this.setPath(result, k, now);
                        }
                    }
                    break;
            }
        }

        return result;
    }

    private setPath(doc: BSONDocument, path: string, value: any): void {
        const parts = path.split('.');
        let current: any = doc;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!(part in current) || current[part] === null) {
                current[part] = {};
            }
            current = current[part];
        }

        current[parts[parts.length - 1]] = value;
    }

    private deletePath(doc: BSONDocument, path: string): void {
        const parts = path.split('.');
        let current: any = doc;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!(part in current)) return;
            current = current[part];
        }

        delete current[parts[parts.length - 1]];
    }

    /**
     * Validate collection integrity (aligned with Go/Swift)
     * 
     * Performs:
     * - Data tree integrity check
     * - Index tree integrity checks
     * - Document-index consistency verification
     */
    async validate(): Promise<{
        valid: boolean;
        errors: string[];
        warnings: string[];
        nrecords: number;
        nIndexes: number;
    }> {
        const errors: string[] = [];
        const warnings: string[] = [];
        let valid = true;

        // Validate data tree
        if (this.dataTree) {
            try {
                const treeErrors = await this.dataTree.verify();
                if (treeErrors.length > 0) {
                    valid = false;
                    errors.push(...treeErrors.map(e => `Data tree: ${e}`));
                }
            } catch (err) {
                valid = false;
                errors.push(`Data tree verification failed: ${err}`);
            }
        }

        // Validate index trees
        const indexMetas = this.indexManager.listIndexes();
        for (const meta of indexMetas) {
            const indexName = meta.name as string;
            try {
                const indexErrors = await this.indexManager.validateIndex(indexName);
                if (indexErrors.length > 0) {
                    valid = false;
                    errors.push(...indexErrors.map(e => `Index ${indexName}: ${e}`));
                }
            } catch (err) {
                valid = false;
                errors.push(`Index ${indexName} verification failed: ${err}`);
            }
        }

        // Verify document-index consistency (sample check)
        try {
            const docs = await this.find({ limit: 100 });
            for (const doc of docs) {
                // Check each secondary index has an entry for this document
                for (const meta of indexMetas) {
                    const indexName = meta.name as string;
                    const indexKey = meta.key as BSONDocument | undefined;
                    if (indexName === '_id_') continue; // Skip _id index
                    if (!indexKey) continue;

                    const keyFields = Object.keys(indexKey);
                    const keyValues: any[] = [];
                    for (const field of keyFields) {
                        keyValues.push(getValueByPath(doc, field));
                    }

                    // Skip if any key field is missing
                    if (keyValues.some(v => v === undefined)) continue;

                    // Check if index entry exists
                    const found = await this.indexManager.findByIndexHint(indexName, {
                        [keyFields[0]]: keyValues[0],
                    });
                    if (!found || found.length === 0) {
                        warnings.push(`Document ${doc._id}: missing index entry in ${indexName}`);
                    }
                }
            }
        } catch (err) {
            warnings.push(`Document-index consistency check failed: ${err}`);
        }

        return {
            valid,
            errors,
            warnings,
            nrecords: this.info.documentCount,
            nIndexes: indexMetas.length + 1, // +1 for _id index
        };
    }
}
