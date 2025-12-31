// Created by Yanjunhui

import { BTree, KeyString } from '../storage';
import { Pager } from '../storage';
import { BSONDocument, BSONValue, ObjectId } from '../bson';
import { BSONEncoder, BSONDecoder } from '../bson';
import { MonoError } from '../core';
import { logger } from '../core';

/**
 * 索引元数据（存储在目录中）
 * // EN: Index metadata (stored in catalog)
 */
export interface IndexMeta {
    /** 索引名称 // EN: Index name */
    name: string;
    /** 索引键 // EN: Index keys */
    keys: BSONDocument;
    /** 是否唯一 // EN: Whether unique */
    unique: boolean;
    /** 根页 ID // EN: Root page ID */
    rootPageId: number;
}

/**
 * 索引信息
 * // EN: Index information
 */
export interface IndexInfo {
    /** 索引名称 // EN: Index name */
    name: string;
    /** 索引键 // EN: Index keys */
    keys: BSONDocument;
    /** 是否唯一 // EN: Whether unique */
    unique: boolean;
    /** 是否后台构建 // EN: Whether background build */
    background: boolean;
    /** 根页 ID // EN: Root page ID */
    rootPageId?: number;
}

/**
 * 文档查找器接口（用于构建索引）
 * // EN: Document finder interface (for building indexes)
 */
export interface DocumentFinder {
    findUnlocked(filter: BSONDocument | null): Promise<BSONDocument[]>;
}

/**
 * 索引类 - 包装 B+ 树用于索引操作
 * // EN: Index class - wraps a BTree for index operations
 */
export class Index {
    /** 索引信息 // EN: Index info */
    readonly info: IndexInfo;
    /** B+ 树 // EN: B+ tree */
    private tree: BTree;
    /** 页面管理器 // EN: Pager */
    private pager: Pager;

    constructor(pager: Pager, info: IndexInfo, tree: BTree) {
        this.pager = pager;
        this.info = info;
        this.tree = tree;
    }

    /**
     * 创建一个新的索引（使用新的 B+ 树）
     * // EN: Create a new index with a fresh BTree
     */
    static async create(pager: Pager, info: IndexInfo): Promise<Index> {
        const tree = await BTree.create(pager);
        info.rootPageId = tree.getRootPageId();
        return new Index(pager, info, tree);
    }

    /**
     * 从根页加载现有索引
     * // EN: Load an existing index from a root page
     */
    static load(pager: Pager, info: IndexInfo, rootPageId: number): Index {
        const tree = new BTree(pager, rootPageId);
        info.rootPageId = rootPageId;
        return new Index(pager, info, tree);
    }

    /**
     * 获取根页 ID
     * // EN: Get root page ID
     */
    getRootPageId(): number {
        return this.tree.getRootPageId();
    }

    /**
     * 插入键值对
     * // EN: Insert a key-value pair
     */
    async insert(key: Buffer, value: Buffer): Promise<void> {
        // 对于唯一索引，检查键是否已存在
        // EN: For unique indexes, check if key already exists
        if (this.info.unique) {
            const existing = await this.tree.search(key);
            if (existing !== null) {
                throw MonoError.duplicateKey(this.info.name, key.toString('hex'));
            }
        }
        await this.tree.insert(key, value);
    }

    /**
     * 删除键
     * // EN: Delete a key
     */
    async delete(key: Buffer): Promise<boolean> {
        return this.tree.delete(key);
    }

    /**
     * 搜索键
     * // EN: Search for a key
     */
    async search(key: Buffer): Promise<Buffer | null> {
        return this.tree.search(key);
    }

    /**
     * 范围搜索
     * // EN: Range search
     */
    async searchRange(startKey: Buffer | null, endKey: Buffer | null): Promise<Buffer[]> {
        return this.tree.searchRange(startKey, endKey);
    }
}

/**
 * 索引管理器 - 管理集合的索引（与 Go/Swift 版本对齐）
 * // EN: IndexManager - manages indexes for a collection (aligned with Go/Swift)
 *
 * 功能特性 // EN: Features:
 * - 创建/删除索引 // EN: Create/drop indexes
 * - 唯一约束检查 // EN: Unique constraint checking
 * - 插入/更新/删除时的索引维护 // EN: Index maintenance on insert/update/delete
 * - 支持回滚以保证一致性 // EN: Rollback support for consistency
 */
export class IndexManager {
    /** 页面管理器 // EN: Pager */
    private pager: Pager;
    /** 索引映射表 // EN: Index map */
    private indexes: Map<string, Index> = new Map();
    /** 文档查找器 // EN: Document finder */
    private documentFinder: DocumentFinder | null = null;
    /** BSON 编码器 // EN: BSON encoder */
    private encoder: BSONEncoder;
    /** BSON 解码器 // EN: BSON decoder */
    private decoder: BSONDecoder;

    constructor(pager: Pager) {
        this.pager = pager;
        this.encoder = new BSONEncoder();
        this.decoder = new BSONDecoder();
    }

    /**
     * 设置文档查找器用于构建索引
     * // EN: Set document finder for index building
     */
    setDocumentFinder(finder: DocumentFinder): void {
        this.documentFinder = finder;
    }

    // ==================== 索引创建与删除 / Index Creation & Deletion ====================

    /**
     * 创建索引
     * // EN: Create an index
     */
    async createIndex(keys: BSONDocument, options: BSONDocument = {}): Promise<string> {
        // 生成索引名称 // EN: Generate index name
        let name = this.generateIndexName(keys);
        if (options.name && typeof options.name === 'string') {
            name = options.name;
        }

        // 检查是否已存在 // EN: Check if already exists
        if (this.indexes.has(name)) {
            return name; // 已存在 // EN: Already exists
        }

        // 解析选项 // EN: Parse options
        const unique = options.unique === true;
        const background = options.background === true;

        // 创建索引信息 // EN: Create index info
        const info: IndexInfo = {
            name,
            keys,
            unique,
            background,
        };

        // 创建索引 // EN: Create index
        const index = await Index.create(this.pager, info);
        this.indexes.set(name, index);

        // 为现有文档构建索引 // EN: Build index for existing documents
        await this.buildIndex(index);

        logger.info('Index created', { name, keys, unique });
        return name;
    }

    /**
     * 为现有文档构建索引
     * // EN: Build index for existing documents
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
     * 删除索引
     * // EN: Drop an index
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
     * 列出所有索引
     * // EN: List all indexes
     */
    listIndexes(): BSONDocument[] {
        const result: BSONDocument[] = [];

        // 添加默认 _id 索引 // EN: Add default _id index
        result.push({
            name: '_id_',
            key: { _id: 1 },
            v: 2,
        });

        // 添加用户索引（按名称排序以保持稳定） // EN: Add user indexes (sorted by name for stability)
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
     * 根据名称获取索引
     * // EN: Get index by name
     */
    getIndex(name: string): Index | null {
        return this.indexes.get(name) ?? null;
    }

    /**
     * 获取所有索引元数据用于持久化
     * // EN: Get all index metas for persistence
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

    // ==================== 唯一约束检查 / Unique Constraint Checking ====================

    /**
     * 检查文档的唯一约束
     * 如果文档违反任何唯一约束则返回错误
     * // EN: Check unique constraints for a document
     * // EN: Returns error if document would violate any unique constraint
     *
     * @param doc 要检查的文档 // EN: Document to check
     * @param excludingId 如果提供，则在重复检查中排除此 _id（用于更新） // EN: If provided, exclude this _id from duplicate check (for updates)
     */
    async checkUniqueConstraints(doc: BSONDocument, excludingId?: BSONValue): Promise<void> {
        for (const index of this.indexes.values()) {
            if (!index.info.unique) continue;

            const key = this.encodeIndexEntryKey(index, doc);
            if (!key) continue;

            // 检查键是否已存在 // EN: Check if key already exists
            const existing = await index.search(key);
            if (existing !== null) {
                // 如果提供了 excludingId，检查是否是同一个文档 // EN: If excludingId provided, check if it's the same document
                if (excludingId !== undefined) {
                    const existingId = this.decodeIdValue(existing);
                    if (existingId !== undefined && this.valuesEqual(existingId, excludingId)) {
                        continue; // 同一文档，允许 // EN: Same document, OK
                    }
                }
                throw MonoError.duplicateKey(index.info.name, key);
            }
        }
    }

    // ==================== 文档索引操作 / Document Index Operations ====================

    /**
     * 将文档插入所有索引
     * // EN: Insert document into all indexes
     *
     * P0 修复：支持回滚 - 如果任何索引失败，之前成功的条目将被回滚
     * // EN: P0 FIX: Includes rollback support - if any index fails, previously
     * // EN: successful entries are rolled back
     */
    async insertDocument(doc: BSONDocument): Promise<void> {
        // 跟踪成功的插入以便回滚 // EN: Track successful inserts for rollback
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
                // P0 关键修复：回滚所有成功的插入 // EN: P0 CRITICAL FIX: Rollback all successful inserts
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
     * 从所有索引中删除文档
     * // EN: Delete document from all indexes
     *
     * P0 修复：支持回滚 - 如果任何删除失败，之前成功的删除将被恢复
     * // EN: P0 FIX: Includes rollback support - if any delete fails, previously
     * // EN: successful deletes are restored
     */
    async deleteDocument(doc: BSONDocument): Promise<void> {
        // 跟踪成功的删除以便回滚 // EN: Track successful deletes for rollback
        const deletedEntries: Array<{ index: Index; key: Buffer; idBytes: Buffer }> = [];

        // 预取 _id // EN: Pre-fetch _id
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
                // P0 关键修复：回滚所有成功的删除（重新插入） // EN: P0 CRITICAL FIX: Rollback all successful deletes (re-insert)
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
     * 原子操作：检查唯一约束 + 插入文档
     * 用于 Collection.insert 以确保一致性
     * // EN: Atomic operation: check unique constraints + insert document
     * // EN: Used for Collection.insert to ensure consistency
     */
    async checkAndInsertDocument(doc: BSONDocument, excludingId?: BSONValue): Promise<void> {
        await this.checkUniqueConstraints(doc, excludingId);
        await this.insertDocument(doc);
    }

    // ==================== 索引恢复 / Index Restoration ====================

    /**
     * 从持久化的元数据恢复索引
     * // EN: Restore indexes from persisted metadata
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

    // ==================== 辅助方法 / Helper Methods ====================

    /**
     * 从键生成索引名称（例如 "field1_1_field2_-1"）
     * // EN: Generate index name from keys (e.g., "field1_1_field2_-1")
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
     * 编码索引条目键
     * // EN: Encode index entry key
     *
     * 对于唯一索引：key = KeyString(fields)
     * 对于非唯一索引：key = KeyString(fields) + 0x00 + BSON(_id)
     * // EN: For unique indexes: key = KeyString(fields)
     * // EN: For non-unique indexes: key = KeyString(fields) + 0x00 + BSON(_id)
     *
     * 这确保非唯一索引可以有重复的字段值，同时通过附加 _id 来维护 B+ 树的唯一性
     * // EN: This ensures non-unique indexes can still have duplicate field values
     * // EN: while maintaining B+Tree uniqueness via the appended _id
     */
    private encodeIndexEntryKey(index: Index, doc: BSONDocument): Buffer | null {
        const values: any[] = [];
        const directions: boolean[] = [];

        for (const [field, direction] of Object.entries(index.info.keys)) {
            const value = this.getDocField(doc, field);
            if (value === undefined) {
                // 将缺失字段视为 null 进行索引 // EN: Treat missing fields as null for indexing
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

        // 对于非唯一索引，附加 _id 以确保唯一性 // EN: For non-unique indexes, append _id to ensure uniqueness
        const idVal = this.getDocField(doc, '_id');
        if (idVal === undefined) {
            return base;
        }

        const idBytes = this.encoder.encode({ _id: idVal });
        const key = Buffer.alloc(base.length + 1 + idBytes.length);
        base.copy(key, 0);
        key[base.length] = 0x00; // 分隔符 // EN: Separator
        idBytes.copy(key, base.length + 1);

        return key;
    }

    /**
     * 从文档获取字段值（支持点符号表示法）
     * // EN: Get field value from document (supports dot notation)
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
                // 尝试数组索引 // EN: Try array index
                const index = parseInt(part, 10);
                if (!isNaN(index) && index >= 0 && index < current.length) {
                    current = current[index];
                } else {
                    // 数组元素匹配（MongoDB 语义） // EN: Array element matching (MongoDB semantics)
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
     * 从 BSON 字节解码 _id 值
     * // EN: Decode _id value from BSON bytes
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
     * 检查两个 BSON 值是否相等
     * // EN: Check if two BSON values are equal
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

        // 对于其他类型，比较 JSON 表示 // EN: For other types, compare JSON representations
        return JSON.stringify(a) === JSON.stringify(b);
    }

    // ==================== 验证方法 / Validation Methods (aligned with Go/Swift) ====================

    /**
     * 验证索引完整性
     * 返回错误消息数组，如果有效则为空
     * // EN: Validate index integrity
     * // EN: Returns array of error messages, empty if valid
     */
    async validateIndex(name: string): Promise<string[]> {
        const index = this.indexes.get(name);
        if (!index) {
            return [`Index '${name}' not found`];
        }

        // 获取底层 B+ 树并验证 // EN: Get the underlying BTree and verify it
        const tree = (index as any).tree as BTree;
        if (tree && typeof tree.verify === 'function') {
            return tree.verify();
        }

        return [];
    }

    /**
     * 根据索引提示查找文档
     * 返回索引中匹配的文档 _id
     * // EN: Find documents by index hint
     * // EN: Returns matching document _ids from the index
     */
    async findByIndexHint(indexName: string, query: BSONDocument): Promise<BSONValue[]> {
        const index = this.indexes.get(indexName);
        if (!index) {
            return [];
        }

        // 从查询值构建键 // EN: Build key from query values
        const values: any[] = [];
        const directions: boolean[] = [];

        for (const [field, direction] of Object.entries(index.info.keys)) {
            if (field in query) {
                values.push(query[field]);
            } else {
                // 如果查询没有该字段，则无法有效使用索引 // EN: If query doesn't have the field, cannot use index efficiently
                return [];
            }
            directions.push((direction as number) >= 0);
        }

        const key = KeyString.fromValues(values, directions);
        if (key.length === 0) {
            return [];
        }

        // 对于唯一索引，使用精确搜索 // EN: For unique indexes, use exact search
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

        // 对于非唯一索引，使用带前缀的范围搜索 // EN: For non-unique indexes, use range search with prefix
        const results = await index.searchRange(key, null);
        const ids: BSONValue[] = [];

        for (const result of results) {
            // 检查结果是否以键开头（前缀匹配） // EN: Check if result starts with the key (prefix match)
            // 非唯一索引键的格式为：key + 0x00 + _id // EN: Non-unique index keys have format: key + 0x00 + _id
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

