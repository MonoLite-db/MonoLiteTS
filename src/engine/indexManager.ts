// Created by Yanjunhui

import { BTree, KeyString } from '../storage';
import { Pager } from '../storage';
import { BSONDocument, BSONValue, ObjectId } from '../bson';
import { BSONEncoder, BSONDecoder } from '../bson';
import { MonoError } from '../core';
import { logger } from '../core';

/**
 * Index metadata (stored in catalog)
 */
export interface IndexMeta {
    name: string;
    keys: BSONDocument;
    unique: boolean;
    rootPageId: number;
}

/**
 * Index information
 */
export interface IndexInfo {
    name: string;
    keys: BSONDocument;
    unique: boolean;
    background: boolean;
    rootPageId?: number;
}

/**
 * Document finder interface (for building indexes)
 */
export interface DocumentFinder {
    findUnlocked(filter: BSONDocument | null): Promise<BSONDocument[]>;
}

/**
 * Index class - wraps a BTree for index operations
 */
export class Index {
    readonly info: IndexInfo;
    private tree: BTree;
    private pager: Pager;

    constructor(pager: Pager, info: IndexInfo, tree: BTree) {
        this.pager = pager;
        this.info = info;
        this.tree = tree;
    }

    /**
     * Create a new index with a fresh BTree
     */
    static async create(pager: Pager, info: IndexInfo): Promise<Index> {
        const tree = await BTree.create(pager);
        info.rootPageId = tree.getRootPageId();
        return new Index(pager, info, tree);
    }

    /**
     * Load an existing index from a root page
     */
    static load(pager: Pager, info: IndexInfo, rootPageId: number): Index {
        const tree = new BTree(pager, rootPageId);
        info.rootPageId = rootPageId;
        return new Index(pager, info, tree);
    }

    /**
     * Get root page ID
     */
    getRootPageId(): number {
        return this.tree.getRootPageId();
    }

    /**
     * Insert a key-value pair
     */
    async insert(key: Buffer, value: Buffer): Promise<void> {
        // For unique indexes, check if key already exists
        if (this.info.unique) {
            const existing = await this.tree.search(key);
            if (existing !== null) {
                throw MonoError.duplicateKey(this.info.name, key.toString('hex'));
            }
        }
        await this.tree.insert(key, value);
    }

    /**
     * Delete a key
     */
    async delete(key: Buffer): Promise<boolean> {
        return this.tree.delete(key);
    }

    /**
     * Search for a key
     */
    async search(key: Buffer): Promise<Buffer | null> {
        return this.tree.search(key);
    }

    /**
     * Range search
     */
    async searchRange(startKey: Buffer | null, endKey: Buffer | null): Promise<Buffer[]> {
        return this.tree.searchRange(startKey, endKey);
    }
}

/**
 * IndexManager - manages indexes for a collection (aligned with Go/Swift)
 * 
 * Features:
 * - Create/drop indexes
 * - Unique constraint checking
 * - Index maintenance on insert/update/delete
 * - Rollback support for consistency
 */
export class IndexManager {
    private pager: Pager;
    private indexes: Map<string, Index> = new Map();
    private documentFinder: DocumentFinder | null = null;
    private encoder: BSONEncoder;
    private decoder: BSONDecoder;

    constructor(pager: Pager) {
        this.pager = pager;
        this.encoder = new BSONEncoder();
        this.decoder = new BSONDecoder();
    }

    /**
     * Set document finder for index building
     */
    setDocumentFinder(finder: DocumentFinder): void {
        this.documentFinder = finder;
    }

    // ==================== Index Creation & Deletion ====================

    /**
     * Create an index
     */
    async createIndex(keys: BSONDocument, options: BSONDocument = {}): Promise<string> {
        // Generate index name
        let name = this.generateIndexName(keys);
        if (options.name && typeof options.name === 'string') {
            name = options.name;
        }

        // Check if already exists
        if (this.indexes.has(name)) {
            return name; // Already exists
        }

        // Parse options
        const unique = options.unique === true;
        const background = options.background === true;

        // Create index info
        const info: IndexInfo = {
            name,
            keys,
            unique,
            background,
        };

        // Create index
        const index = await Index.create(this.pager, info);
        this.indexes.set(name, index);

        // Build index for existing documents
        await this.buildIndex(index);

        logger.info('Index created', { name, keys, unique });
        return name;
    }

    /**
     * Build index for existing documents
     */
    private async buildIndex(index: Index): Promise<void> {
        if (!this.documentFinder) return;

        const docs = await this.documentFinder.findUnlocked(null);

        for (const doc of docs) {
            const key = this.encodeIndexEntryKey(index, doc);
            if (!key) continue;

            const idVal = this.getDocField(doc, '_id');
            if (idVal === undefined) continue;

            const idBytes = this.encoder.encode({ _id: idVal });

            try {
                await index.insert(key, idBytes);
            } catch (err) {
                if (index.info.unique) {
                    throw MonoError.duplicateKey(index.info.name, key);
                }
                throw MonoError.cannotCreateIndex(`failed to build index ${index.info.name}: ${err}`);
            }
        }
    }

    /**
     * Drop an index
     */
    async dropIndex(name: string): Promise<void> {
        if (name === '_id_') {
            throw MonoError.illegalOperation('cannot drop _id index');
        }

        if (!this.indexes.has(name)) {
            throw MonoError.indexNotFound(name);
        }

        this.indexes.delete(name);
        logger.info('Index dropped', { name });
    }

    /**
     * List all indexes
     */
    listIndexes(): BSONDocument[] {
        const result: BSONDocument[] = [];

        // Add default _id index
        result.push({
            name: '_id_',
            key: { _id: 1 },
            v: 2,
        });

        // Add user indexes (sorted by name for stability)
        const names = Array.from(this.indexes.keys()).sort();
        for (const name of names) {
            const index = this.indexes.get(name)!;
            result.push({
                name: index.info.name,
                key: index.info.keys,
                unique: index.info.unique,
                v: 2,
            });
        }

        return result;
    }

    /**
     * Get index by name
     */
    getIndex(name: string): Index | null {
        return this.indexes.get(name) ?? null;
    }

    /**
     * Get all index metas for persistence
     */
    getIndexMetas(): IndexMeta[] {
        const metas: IndexMeta[] = [];
        for (const [name, index] of this.indexes) {
            metas.push({
                name: index.info.name,
                keys: index.info.keys,
                unique: index.info.unique,
                rootPageId: index.getRootPageId(),
            });
        }
        return metas;
    }

    // ==================== Unique Constraint Checking ====================

    /**
     * Check unique constraints for a document
     * Returns error if document would violate any unique constraint
     * 
     * @param doc Document to check
     * @param excludingId If provided, exclude this _id from duplicate check (for updates)
     */
    async checkUniqueConstraints(doc: BSONDocument, excludingId?: BSONValue): Promise<void> {
        for (const index of this.indexes.values()) {
            if (!index.info.unique) continue;

            const key = this.encodeIndexEntryKey(index, doc);
            if (!key) continue;

            // Check if key already exists
            const existing = await index.search(key);
            if (existing !== null) {
                // If excludingId provided, check if it's the same document
                if (excludingId !== undefined) {
                    const existingId = this.decodeIdValue(existing);
                    if (existingId !== undefined && this.valuesEqual(existingId, excludingId)) {
                        continue; // Same document, OK
                    }
                }
                throw MonoError.duplicateKey(index.info.name, key);
            }
        }
    }

    // ==================== Document Index Operations ====================

    /**
     * Insert document into all indexes
     * 
     * P0 FIX: Includes rollback support - if any index fails, previously
     * successful entries are rolled back
     */
    async insertDocument(doc: BSONDocument): Promise<void> {
        // Track successful inserts for rollback
        const insertedEntries: Array<{ index: Index; key: Buffer }> = [];

        for (const index of this.indexes.values()) {
            const key = this.encodeIndexEntryKey(index, doc);
            if (!key) continue;

            const idVal = this.getDocField(doc, '_id');
            if (idVal === undefined) continue;

            const idBytes = this.encoder.encode({ _id: idVal });

            try {
                await index.insert(key, idBytes);
                insertedEntries.push({ index, key });
            } catch (err) {
                // P0 CRITICAL FIX: Rollback all successful inserts
                for (let i = insertedEntries.length - 1; i >= 0; i--) {
                    const entry = insertedEntries[i];
                    try {
                        await entry.index.delete(entry.key);
                    } catch (rollbackErr) {
                        logger.error('Failed to rollback index entry', {
                            index: entry.index.info.name,
                            error: String(rollbackErr),
                        });
                    }
                }
                throw MonoError.internalError(`failed to update index '${index.info.name}': ${err}`);
            }
        }
    }

    /**
     * Delete document from all indexes
     * 
     * P0 FIX: Includes rollback support - if any delete fails, previously
     * successful deletes are restored
     */
    async deleteDocument(doc: BSONDocument): Promise<void> {
        // Track successful deletes for rollback
        const deletedEntries: Array<{ index: Index; key: Buffer; idBytes: Buffer }> = [];

        // Pre-fetch _id
        const idVal = this.getDocField(doc, '_id');
        let idBytes: Buffer | null = null;
        if (idVal !== undefined) {
            idBytes = this.encoder.encode({ _id: idVal });
        }

        for (const index of this.indexes.values()) {
            const key = this.encodeIndexEntryKey(index, doc);
            if (!key) continue;

            try {
                await index.delete(key);
                if (idBytes) {
                    deletedEntries.push({ index, key, idBytes });
                }
            } catch (err) {
                // P0 CRITICAL FIX: Rollback all successful deletes (re-insert)
                for (let i = deletedEntries.length - 1; i >= 0; i--) {
                    const entry = deletedEntries[i];
                    try {
                        await entry.index.insert(entry.key, entry.idBytes);
                    } catch (rollbackErr) {
                        logger.error('Failed to rollback index delete', {
                            index: entry.index.info.name,
                            error: String(rollbackErr),
                        });
                    }
                }
                throw MonoError.internalError(`failed to delete index '${index.info.name}': ${err}`);
            }
        }
    }

    /**
     * Atomic operation: check unique constraints + insert document
     * Used for Collection.insert to ensure consistency
     */
    async checkAndInsertDocument(doc: BSONDocument, excludingId?: BSONValue): Promise<void> {
        await this.checkUniqueConstraints(doc, excludingId);
        await this.insertDocument(doc);
    }

    // ==================== Index Restoration ====================

    /**
     * Restore indexes from persisted metadata
     */
    async restoreIndexes(metas: IndexMeta[]): Promise<void> {
        for (const meta of metas) {
            const info: IndexInfo = {
                name: meta.name,
                keys: meta.keys,
                unique: meta.unique,
                background: false,
                rootPageId: meta.rootPageId,
            };
            const index = Index.load(this.pager, info, meta.rootPageId);
            this.indexes.set(meta.name, index);
        }
    }

    // ==================== Helper Methods ====================

    /**
     * Generate index name from keys (e.g., "field1_1_field2_-1")
     */
    private generateIndexName(keys: BSONDocument): string {
        const parts: string[] = [];
        for (const [field, direction] of Object.entries(keys)) {
            const dir = typeof direction === 'number' ? direction : 1;
            parts.push(`${field}_${dir}`);
        }
        return parts.join('_');
    }

    /**
     * Encode index entry key
     * 
     * For unique indexes: key = KeyString(fields)
     * For non-unique indexes: key = KeyString(fields) + 0x00 + BSON(_id)
     * 
     * This ensures non-unique indexes can still have duplicate field values
     * while maintaining B+Tree uniqueness via the appended _id
     */
    private encodeIndexEntryKey(index: Index, doc: BSONDocument): Buffer | null {
        const values: any[] = [];
        const directions: boolean[] = [];

        for (const [field, direction] of Object.entries(index.info.keys)) {
            const value = this.getDocField(doc, field);
            if (value === undefined) {
                // Treat missing fields as null for indexing
                values.push(null);
            } else {
                values.push(value);
            }
            directions.push((direction as number) >= 0);
        }

        const base = KeyString.fromValues(values, directions);
        if (base.length === 0) {
            return null;
        }

        if (index.info.unique) {
            return base;
        }

        // For non-unique indexes, append _id to ensure uniqueness
        const idVal = this.getDocField(doc, '_id');
        if (idVal === undefined) {
            return base;
        }

        const idBytes = this.encoder.encode({ _id: idVal });
        const key = Buffer.alloc(base.length + 1 + idBytes.length);
        base.copy(key, 0);
        key[base.length] = 0x00; // Separator
        idBytes.copy(key, base.length + 1);

        return key;
    }

    /**
     * Get field value from document (supports dot notation)
     */
    private getDocField(doc: BSONDocument, path: string): BSONValue | undefined {
        const parts = path.split('.');
        let current: any = doc;

        for (const part of parts) {
            if (current === null || current === undefined) {
                return undefined;
            }
            if (typeof current === 'object' && !Array.isArray(current)) {
                current = current[part];
            } else if (Array.isArray(current)) {
                // Try array index
                const index = parseInt(part, 10);
                if (!isNaN(index) && index >= 0 && index < current.length) {
                    current = current[index];
                } else {
                    // Array element matching (MongoDB semantics)
                    for (const item of current) {
                        if (typeof item === 'object' && item !== null) {
                            const result = this.getDocField(item as BSONDocument, parts.slice(parts.indexOf(part)).join('.'));
                            if (result !== undefined) {
                                return result;
                            }
                        }
                    }
                    return undefined;
                }
            } else {
                return undefined;
            }
        }

        return current;
    }

    /**
     * Decode _id value from BSON bytes
     */
    private decodeIdValue(data: Buffer): BSONValue | undefined {
        try {
            const doc = this.decoder.decode(data);
            return doc._id;
        } catch {
            return undefined;
        }
    }

    /**
     * Check if two BSON values are equal
     */
    private valuesEqual(a: BSONValue, b: BSONValue): boolean {
        if (a === b) return true;
        if (a === null || b === null) return a === b;
        if (a === undefined || b === undefined) return a === b;

        if (a instanceof ObjectId && b instanceof ObjectId) {
            return a.equals(b);
        }
        if (a instanceof Date && b instanceof Date) {
            return a.getTime() === b.getTime();
        }
        if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) {
            return a.equals(b);
        }

        // For other types, compare JSON representations
        return JSON.stringify(a) === JSON.stringify(b);
    }

    // ==================== Validation Methods (aligned with Go/Swift) ====================

    /**
     * Validate index integrity
     * Returns array of error messages, empty if valid
     */
    async validateIndex(name: string): Promise<string[]> {
        const index = this.indexes.get(name);
        if (!index) {
            return [`Index '${name}' not found`];
        }

        // Get the underlying BTree and verify it
        const tree = (index as any).tree as BTree;
        if (tree && typeof tree.verify === 'function') {
            return tree.verify();
        }

        return [];
    }

    /**
     * Find documents by index hint
     * Returns matching document _ids from the index
     */
    async findByIndexHint(indexName: string, query: BSONDocument): Promise<BSONValue[]> {
        const index = this.indexes.get(indexName);
        if (!index) {
            return [];
        }

        // Build key from query values
        const values: any[] = [];
        const directions: boolean[] = [];

        for (const [field, direction] of Object.entries(index.info.keys)) {
            if (field in query) {
                values.push(query[field]);
            } else {
                // If query doesn't have the field, cannot use index efficiently
                return [];
            }
            directions.push((direction as number) >= 0);
        }

        const key = KeyString.fromValues(values, directions);
        if (key.length === 0) {
            return [];
        }

        // For unique indexes, use exact search
        if (index.info.unique) {
            const result = await index.search(key);
            if (result) {
                const idVal = this.decodeIdValue(result);
                if (idVal !== undefined) {
                    return [idVal];
                }
            }
            return [];
        }

        // For non-unique indexes, use range search with prefix
        const results = await index.searchRange(key, null);
        const ids: BSONValue[] = [];

        for (const result of results) {
            // Check if result starts with the key (prefix match)
            // Non-unique index keys have format: key + 0x00 + _id
            if (result.length < key.length + 2) continue;
            
            if (result.subarray(0, key.length).equals(key) && result[key.length] === 0x00) {
                const idBytes = result.subarray(key.length + 1);
                const idVal = this.decodeIdValue(idBytes);
                if (idVal !== undefined) {
                    ids.push(idVal);
                }
            }
        }

        return ids;
    }
}

