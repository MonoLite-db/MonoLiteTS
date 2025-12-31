// Created by Yanjunhui

import * as path from 'path';
import { Pager, BTree, PageType } from '../storage';
import { BSONDocument, BSONEncoder, BSONDecoder, ObjectId, Binary } from '../bson';
import { MonoError, validateCollectionName, logger } from '../core';
import { Collection, CollectionInfo } from './collection';
import { TransactionManager, TxnState } from './transaction';
import { SessionManager, extractCommandContext, isInTransaction, CommandContext } from './session';
import { CursorManager } from './cursorManager';

/**
 * 数据库配置选项
 * // EN: Database configuration options
 */
export interface DatabaseOptions {
    /** 数据库文件路径 // EN: Database file path */
    filePath: string;
    /** 缓存大小（可选） // EN: Cache size (optional) */
    cacheSize?: number;
}

/**
 * 数据库统计信息
 * // EN: Database statistics
 */
export interface DatabaseStats {
    /** 集合数量 // EN: Number of collections */
    collections: number;
    /** 文档数量 // EN: Number of documents */
    documents: number;
    /** 数据大小 // EN: Data size */
    dataSize: number;
    /** 存储大小 // EN: Storage size */
    storageSize: number;
    /** 索引数量 // EN: Number of indexes */
    indexes: number;
}

/**
 * 数据库类（与 Go 版本对齐）
 * // EN: Database class (aligned with Go version)
 *
 * 管理集合、目录，并提供命令接口
 * // EN: Manages collections, catalog, and provides command interface
 */
export class Database {
    /** 数据库文件路径 // EN: Database file path */
    private filePath: string;
    /** 页面管理器 // EN: Page manager */
    private pager: Pager | null = null;
    /** 集合目录 // EN: Collection catalog */
    private catalog: Map<string, Collection> = new Map();
    /** 目录 B+ 树 // EN: Catalog B+ tree */
    private catalogTree: BTree | null = null;
    /** BSON 编码器 // EN: BSON encoder */
    private encoder: BSONEncoder;
    /** BSON 解码器 // EN: BSON decoder */
    private decoder: BSONDecoder;
    /** 数据库是否已关闭 // EN: Whether database is closed */
    private closed: boolean = false;

    // 管理器（与 Go/Swift 对齐）// EN: Managers (aligned with Go/Swift)
    /** 事务管理器 // EN: Transaction manager */
    txnManager: TransactionManager | null = null;
    /** 会话管理器 // EN: Session manager */
    private sessionManager: SessionManager | null = null;
    /** 游标管理器 // EN: Cursor manager */
    private cursorManager: CursorManager | null = null;
    /** 数据库启动时间 // EN: Database start time */
    private startTime: Date;

    private constructor(filePath: string) {
        this.filePath = filePath;
        this.encoder = new BSONEncoder();
        this.decoder = new BSONDecoder();
        this.startTime = new Date();
    }

    /**
     * 打开或创建数据库
     * // EN: Open or create a database
     */
    static async open(options: DatabaseOptions): Promise<Database> {
        const db = new Database(options.filePath);
        db.pager = await Pager.open(options.filePath, {
            cacheSize: options.cacheSize,
        });

        // 初始化或加载目录 // EN: Initialize or load catalog
        await db.initCatalog();

        // 初始化管理器（与 Go/Swift 对齐）// EN: Initialize managers (aligned with Go/Swift)
        db.txnManager = new TransactionManager(db);
        db.sessionManager = new SessionManager(db);
        db.cursorManager = new CursorManager();

        logger.info('Database opened', { path: options.filePath });
        return db;
    }

    /**
     * 关闭数据库
     * // EN: Close the database
     */
    async close(): Promise<void> {
        if (this.closed) return;

        // 关闭管理器 // EN: Close managers
        if (this.sessionManager) {
            this.sessionManager.close();
            this.sessionManager = null;
        }
        if (this.cursorManager) {
            this.cursorManager.close();
            this.cursorManager = null;
        }
        this.txnManager = null;

        await this.flush();
        if (this.pager) {
            await this.pager.close();
            this.pager = null;
        }
        this.catalog.clear();
        this.closed = true;

        logger.info('Database closed', { path: this.filePath });
    }

    /**
     * 将所有数据刷新到磁盘
     * // EN: Flush all data to disk
     */
    async flush(): Promise<void> {
        if (this.pager) {
            await this.pager.flush();
        }
    }

    /**
     * 获取数据库文件路径
     * // EN: Get database file path
     */
    getFilePath(): string {
        return this.filePath;
    }

    /**
     * 获取集合（当 autoCreate 为 true 时，如果不存在则创建）
     * // EN: Get a collection (create if not exists when autoCreate is true)
     */
    async getCollection(name: string, autoCreate: boolean = false): Promise<Collection | null> {
        let collection = this.catalog.get(name);
        if (collection) {
            return collection;
        }

        if (autoCreate) {
            return this.createCollection(name);
        }

        return null;
    }

    /**
     * 创建新集合
     * // EN: Create a new collection
     */
    async createCollection(name: string): Promise<Collection> {
        // 验证名称 // EN: Validate name
        const validation = validateCollectionName(name);
        if (!validation.valid) {
            throw MonoError.invalidNamespace(validation.error!);
        }

        // 检查是否存在 // EN: Check if exists
        if (this.catalog.has(name)) {
            throw MonoError.invalidNamespace(`collection already exists: ${name}`);
        }

        // 创建集合信息 // EN: Create collection info
        const info: CollectionInfo = {
            name,
            dataPageId: 0,
            indexRootPageId: 0,
            documentCount: 0,
            indexes: [],
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        // 创建集合实例 // EN: Create collection instance
        const collection = new Collection(name, this.pager!, info);
        await collection.init();

        // 更新分配的页面 ID // EN: Update info with allocated page IDs
        const updatedInfo = collection.getInfo();

        // 存储到目录 // EN: Store in catalog
        this.catalog.set(name, collection);
        await this.saveCatalogEntry(name, updatedInfo);

        logger.info('Collection created', { name });
        return collection;
    }

    /**
     * 删除集合
     * // EN: Drop a collection
     */
    async dropCollection(name: string): Promise<boolean> {
        const collection = this.catalog.get(name);
        if (!collection) {
            return false;
        }

        // 从目录中移除 // EN: Remove from catalog
        this.catalog.delete(name);
        await this.deleteCatalogEntry(name);

        logger.info('Collection dropped', { name });
        return true;
    }

    /**
     * 列出所有集合名称
     * // EN: List all collection names
     */
    listCollections(): string[] {
        return Array.from(this.catalog.keys());
    }

    /**
     * 获取数据库统计信息
     * // EN: Get database statistics
     */
    async getStats(): Promise<DatabaseStats> {
        let totalDocs = 0;
        let totalIndexes = 0;

        for (const collection of this.catalog.values()) {
            const info = collection.getInfo();
            totalDocs += info.documentCount;
            totalIndexes += 1; // _id index
        }

        return {
            collections: this.catalog.size,
            documents: totalDocs,
            dataSize: 0, // TODO: calculate actual data size
            storageSize: this.pager?.getPageCount() || 0,
            indexes: totalIndexes,
        };
    }

    /**
     * 执行数据库命令
     * // EN: Run a database command
     */
    async runCommand(cmd: BSONDocument): Promise<BSONDocument> {
        const cmdName = Object.keys(cmd)[0];
        const cmdValue = cmd[cmdName];

        switch (cmdName.toLowerCase()) {
            case 'ping':
                return { ok: 1 };

            case 'ismaster':
            case 'ismaster':
            case 'hello':
                return this.helloCommand();

            case 'buildinfo':
                return this.buildInfoCommand();

            case 'serverstatus':
                return this.serverStatusCommand();

            case 'connectionstatus':
                return { ok: 1, authInfo: { authenticatedUsers: [] } };

            case 'listcollections':
                return this.listCollectionsCommand(cmd);

            case 'create':
                return this.createCommand(cmdValue as string, cmd);

            case 'drop':
                return this.dropCommand(cmdValue as string);

            case 'insert':
                return this.insertCommand(cmdValue as string, cmd);

            case 'find':
                return this.findCommand(cmdValue as string, cmd);

            case 'update':
                return this.updateCommand(cmdValue as string, cmd);

            case 'delete':
                return this.deleteCommand(cmdValue as string, cmd);

            case 'count':
                return this.countCommand(cmdValue as string, cmd);

            case 'distinct':
                return this.distinctCommand(cmdValue as string, cmd);

            case 'aggregate':
                return this.aggregateCommand(cmdValue as string, cmd);

            case 'findandmodify':
                return this.findAndModifyCommand(cmdValue as string, cmd);

            case 'createindexes':
                return this.createIndexesCommand(cmdValue as string, cmd);

            case 'listindexes':
                return this.listIndexesCommand(cmdValue as string);

            case 'dropindexes':
                return this.dropIndexesCommand(cmdValue as string, cmd);

            case 'dbstats':
                return this.dbStatsCommand();

            case 'collstats':
                return this.collStatsCommand(cmdValue as string);

            case 'validate':
                return this.validateCommand(cmdValue as string);

            case 'getmore':
                return this.getMoreCommand(cmd);

            case 'killcursors':
                return this.killCursorsCommand(cmd);

            case 'endsessions':
                return this.endSessionsCommand(cmd);

            case 'refreshsessions':
                return this.refreshSessionsCommand(cmd);

            case 'starttransaction':
                return this.startTransactionCommand(cmd);

            case 'committransaction':
                return this.commitTransactionCommand(cmd);

            case 'aborttransaction':
                return this.abortTransactionCommand(cmd);

            case 'explain':
                return this.explainCommand(cmd);

            default:
                throw MonoError.commandNotFound(cmdName);
        }
    }

    // 命令实现 // EN: Command implementations

    /** hello 命令 // EN: hello command */
    private helloCommand(): BSONDocument {
        return {
            ok: 1,
            ismaster: true,
            maxBsonObjectSize: 16 * 1024 * 1024,
            maxMessageSizeBytes: 48 * 1024 * 1024,
            maxWriteBatchSize: 100000,
            localTime: new Date(),
            minWireVersion: 0,
            maxWireVersion: 13,
            readOnly: false,
        };
    }

    /** 构建信息命令 // EN: buildInfo command */
    private buildInfoCommand(): BSONDocument {
        return {
            ok: 1,
            version: '1.0.0',
            gitVersion: 'unknown',
            modules: [],
            allocator: 'system',
            javascriptEngine: 'none',
            sysInfo: 'MonoLiteTS',
            bits: 64,
            debug: false,
            maxBsonObjectSize: 16 * 1024 * 1024,
        };
    }

    /** 服务器状态命令 // EN: serverStatus command */
    private serverStatusCommand(): BSONDocument {
        return {
            ok: 1,
            host: 'localhost',
            version: '1.0.0',
            process: 'monolite',
            pid: process.pid,
            uptime: process.uptime(),
            uptimeMillis: process.uptime() * 1000,
            uptimeEstimate: process.uptime(),
            localTime: new Date(),
            connections: {
                current: 1,
                available: 100,
                totalCreated: 1,
            },
            mem: {
                resident: Math.round(process.memoryUsage().rss / (1024 * 1024)),
                virtual: Math.round(process.memoryUsage().heapTotal / (1024 * 1024)),
            },
        };
    }

    /** 列出集合命令 // EN: listCollections command */
    private async listCollectionsCommand(cmd: BSONDocument): Promise<BSONDocument> {
        const collections: BSONDocument[] = [];
        for (const [name, collection] of this.catalog) {
            const info = collection.getInfo();
            collections.push({
                name,
                type: 'collection',
                options: {},
                info: {
                    readOnly: false,
                    uuid: new ObjectId().toHexString(),
                },
            });
        }

        return {
            ok: 1,
            cursor: {
                id: BigInt(0),
                ns: 'test.$cmd.listCollections',
                firstBatch: collections,
            },
        };
    }

    /** 创建集合命令 // EN: create collection command */
    private async createCommand(name: string, cmd: BSONDocument): Promise<BSONDocument> {
        await this.createCollection(name);
        return { ok: 1 };
    }

    /** 删除集合命令 // EN: drop collection command */
    private async dropCommand(name: string): Promise<BSONDocument> {
        const dropped = await this.dropCollection(name);
        return { ok: 1, dropped };
    }

    /** 插入命令 // EN: insert command */
    private async insertCommand(collName: string, cmd: BSONDocument): Promise<BSONDocument> {
        const collection = await this.getCollection(collName, true);
        if (!collection) {
            throw MonoError.namespaceNotFound(collName);
        }

        const documents = cmd.documents as BSONDocument[];
        const result = await collection.insertMany(documents);

        return {
            ok: 1,
            n: result.insertedCount,
        };
    }

    /** 查询命令 // EN: find command */
    private async findCommand(collName: string, cmd: BSONDocument): Promise<BSONDocument> {
        const collection = await this.getCollection(collName);
        if (!collection) {
            return {
                ok: 1,
                cursor: {
                    id: BigInt(0),
                    ns: `test.${collName}`,
                    firstBatch: [],
                },
            };
        }

        const docs = await collection.find({
            filter: cmd.filter as BSONDocument,
            projection: cmd.projection as BSONDocument,
            sort: cmd.sort as BSONDocument,
            skip: cmd.skip as number,
            limit: cmd.limit as number,
        });

        return {
            ok: 1,
            cursor: {
                id: BigInt(0),
                ns: `test.${collName}`,
                firstBatch: docs,
            },
        };
    }

    /** 更新命令 // EN: update command */
    private async updateCommand(collName: string, cmd: BSONDocument): Promise<BSONDocument> {
        const collection = await this.getCollection(collName);
        if (!collection) {
            throw MonoError.namespaceNotFound(collName);
        }

        const updates = cmd.updates as BSONDocument[];
        let nMatched = 0;
        let nModified = 0;

        for (const update of updates) {
            const filter = update.q as BSONDocument;
            const updateDoc = update.u as BSONDocument;
            const multi = update.multi as boolean;

            const result = multi
                ? await collection.updateMany(filter, updateDoc)
                : await collection.updateOne(filter, updateDoc);

            nMatched += result.matchedCount;
            nModified += result.modifiedCount;
        }

        return {
            ok: 1,
            n: nMatched,
            nModified,
        };
    }

    /** 删除命令 // EN: delete command */
    private async deleteCommand(collName: string, cmd: BSONDocument): Promise<BSONDocument> {
        const collection = await this.getCollection(collName);
        if (!collection) {
            throw MonoError.namespaceNotFound(collName);
        }

        const deletes = cmd.deletes as BSONDocument[];
        let n = 0;

        for (const del of deletes) {
            const filter = del.q as BSONDocument;
            const limit = (del.limit as number) || 0;

            const result = limit === 1
                ? await collection.deleteOne(filter)
                : await collection.deleteMany(filter);

            n += result.deletedCount;
        }

        return { ok: 1, n };
    }

    /** 计数命令 // EN: count command */
    private async countCommand(collName: string, cmd: BSONDocument): Promise<BSONDocument> {
        const collection = await this.getCollection(collName);
        if (!collection) {
            return { ok: 1, n: 0 };
        }

        const filter = cmd.query as BSONDocument || {};
        const count = await collection.countDocuments(filter);

        return { ok: 1, n: count };
    }

    /** 去重命令 // EN: distinct command */
    private async distinctCommand(collName: string, cmd: BSONDocument): Promise<BSONDocument> {
        const collection = await this.getCollection(collName);
        if (!collection) {
            return { ok: 1, values: [] };
        }

        const field = cmd.key as string;
        const filter = cmd.query as BSONDocument || {};
        const values = await collection.distinct(field, filter);

        return { ok: 1, values };
    }

    /** 聚合命令 // EN: aggregate command */
    private async aggregateCommand(collName: string, cmd: BSONDocument): Promise<BSONDocument> {
        const collection = await this.getCollection(collName);
        if (!collection) {
            return {
                ok: 1,
                cursor: {
                    id: BigInt(0),
                    ns: `test.${collName}`,
                    firstBatch: [],
                },
            };
        }

        // TODO: 实现完整的聚合管道 // EN: Implement full aggregation pipeline
        const pipeline = cmd.pipeline as BSONDocument[];
        let docs = await collection.find({});

        for (const stage of pipeline) {
            const stageName = Object.keys(stage)[0];
            const stageValue = stage[stageName];

            switch (stageName) {
                case '$match':
                    docs = docs.filter(doc => this.matchesFilter(doc, stageValue as BSONDocument));
                    break;
                case '$limit':
                    docs = docs.slice(0, stageValue as number);
                    break;
                case '$skip':
                    docs = docs.slice(stageValue as number);
                    break;
                case '$sort':
                    docs = this.sortDocs(docs, stageValue as BSONDocument);
                    break;
                case '$count':
                    docs = [{ [stageValue as string]: docs.length }];
                    break;
                case '$project':
                    docs = docs.map(doc => this.projectDoc(doc, stageValue as BSONDocument));
                    break;
            }
        }

        return {
            ok: 1,
            cursor: {
                id: BigInt(0),
                ns: `test.${collName}`,
                firstBatch: docs,
            },
        };
    }

    /** 简化的过滤器匹配 // EN: Simplified filter matching */
    private matchesFilter(doc: BSONDocument, filter: BSONDocument): boolean {
        for (const [key, value] of Object.entries(filter)) {
            if (doc[key] !== value) return false;
        }
        return true;
    }

    /** 文档排序 // EN: Sort documents */
    private sortDocs(docs: BSONDocument[], sort: BSONDocument): BSONDocument[] {
        return [...docs].sort((a, b) => {
            for (const [key, dir] of Object.entries(sort)) {
                const aVal = a[key];
                const bVal = b[key];
                // 处理 null/undefined 比较 // EN: Handle null/undefined comparison
                if (aVal === undefined || aVal === null) {
                    if (bVal === undefined || bVal === null) continue;
                    return (dir as number) > 0 ? -1 : 1;
                }
                if (bVal === undefined || bVal === null) {
                    return (dir as number) > 0 ? 1 : -1;
                }
                if (aVal < bVal) return (dir as number) > 0 ? -1 : 1;
                if (aVal > bVal) return (dir as number) > 0 ? 1 : -1;
            }
            return 0;
        });
    }

    /** 文档投影 // EN: Project document */
    private projectDoc(doc: BSONDocument, projection: BSONDocument): BSONDocument {
        const result: BSONDocument = {};
        for (const [key, value] of Object.entries(projection)) {
            if (value === 1 || value === true) {
                result[key] = doc[key];
            }
        }
        return result;
    }

    /** 查找并修改命令 // EN: findAndModify command */
    private async findAndModifyCommand(collName: string, cmd: BSONDocument): Promise<BSONDocument> {
        const query = cmd.query as BSONDocument || {};
        const update = cmd.update as BSONDocument;
        const remove = cmd.remove as boolean;
        const returnNew = cmd.new as boolean;
        const upsert = cmd.upsert as boolean;
        const sort = cmd.sort as BSONDocument;

        // 根据 upsert 标志获取或创建集合（与 Go/Swift 对齐）
        // EN: Get or create collection based on upsert flag (aligned with Go/Swift)
        let collection: Collection | null;
        if (upsert) {
            collection = await this.getCollection(collName, true);
        } else {
            collection = await this.getCollection(collName);
        }

        if (!collection) {
            // 集合不存在且没有 upsert - 返回空结果
            // EN: Collection doesn't exist and no upsert - return empty result
            return {
                lastErrorObject: { n: 0, updatedExisting: false },
                value: null,
                ok: 1,
            };
        }

        // 查找目标文档（支持可选排序）
        // EN: Find target document with optional sort
        let target: BSONDocument | null;
        if (sort && Object.keys(sort).length > 0) {
            const results = await collection.find({ filter: query, sort, limit: 1 });
            target = results.length > 0 ? results[0] : null;
        } else {
            target = await collection.findOne(query);
        }

        // 处理删除操作 // EN: Handle remove operation
        if (remove) {
            if (!target) {
                return {
                    lastErrorObject: { n: 0, updatedExisting: false },
                    value: null,
                    ok: 1,
                };
            }
            // 通过 _id 删除以确保命中正确的文档
            // EN: Delete by _id to ensure we hit the correct document
            await collection.deleteOne({ _id: target._id });
            return {
                lastErrorObject: { n: 1, updatedExisting: false },
                value: target,
                ok: 1,
            };
        }

        // 处理更新操作 // EN: Handle update operation
        if (!update) {
            throw MonoError.badValue('findAndModify requires update when remove is false');
        }

        if (target) {
            // 找到文档 - 更新它 // EN: Document found - update it
            await collection.updateOne({ _id: target._id }, update, false);
            const value = returnNew ? await collection.findById(target._id) : target;
            return {
                lastErrorObject: { n: 1, updatedExisting: true },
                value: value,
                ok: 1,
            };
        }

        // 未找到文档 // EN: Document not found
        if (!upsert) {
            return {
                lastErrorObject: { n: 0, updatedExisting: false },
                value: null,
                ok: 1,
            };
        }

        // Upsert 路径 // EN: Upsert path
        const res = await collection.updateOne(query, update, true);
        const upsertedId = res.upsertedId;
        const value = returnNew && upsertedId ? await collection.findById(upsertedId) : null;

        const lastErrorObject: BSONDocument = { n: 1, updatedExisting: false };
        if (upsertedId) {
            lastErrorObject.upserted = upsertedId;
        }

        return {
            lastErrorObject,
            value,
            ok: 1,
        };
    }

    /** 创建索引命令 // EN: createIndexes command */
    private async createIndexesCommand(collName: string, cmd: BSONDocument): Promise<BSONDocument> {
        const collection = await this.getCollection(collName, true);
        if (!collection) {
            throw MonoError.namespaceNotFound(collName);
        }

        const indexes = cmd.indexes as BSONDocument[];
        const numIndexesBefore = collection.listIndexes().length;
        const createdNames: string[] = [];

        for (const indexSpec of indexes) {
            const keys = indexSpec.key as BSONDocument;
            const options: BSONDocument = {};
            
            if (indexSpec.name) options.name = indexSpec.name;
            if (indexSpec.unique) options.unique = indexSpec.unique;
            if (indexSpec.background) options.background = indexSpec.background;

            const name = await collection.createIndex(keys, options);
            createdNames.push(name);
        }

        // 保存更新后的目录（包含索引元数据）
        // EN: Save updated catalog with index metadata
        await this.saveCatalogEntry(collName, collection.getInfo());

        return {
            ok: 1,
            numIndexesBefore,
            numIndexesAfter: collection.listIndexes().length,
            createdCollectionAutomatically: false,
            note: createdNames.length > 0 ? `Created indexes: ${createdNames.join(', ')}` : undefined,
        };
    }

    /** 列出索引命令 // EN: listIndexes command */
    private async listIndexesCommand(collName: string): Promise<BSONDocument> {
        const collection = await this.getCollection(collName);
        if (!collection) {
            throw MonoError.namespaceNotFound(collName);
        }

        // 获取集合的实际索引 // EN: Get actual indexes from collection
        const indexes = collection.listIndexes();

        return {
            ok: 1,
            cursor: {
                id: BigInt(0),
                ns: `test.${collName}`,
                firstBatch: indexes,
            },
        };
    }

    /** 删除索引命令 // EN: dropIndexes command */
    private async dropIndexesCommand(collName: string, cmd: BSONDocument): Promise<BSONDocument> {
        const collection = await this.getCollection(collName);
        if (!collection) {
            throw MonoError.namespaceNotFound(collName);
        }

        const indexName = cmd.index as string;
        const nIndexesWas = collection.listIndexes().length;

        if (indexName === '*') {
            // 删除除 _id 外的所有索引 // EN: Drop all indexes except _id
            const indexes = collection.listIndexes();
            for (const idx of indexes) {
                if (idx.name !== '_id_') {
                    await collection.dropIndex(idx.name as string);
                }
            }
        } else if (indexName) {
            await collection.dropIndex(indexName);
        }

        // 保存更新后的目录 // EN: Save updated catalog
        await this.saveCatalogEntry(collName, collection.getInfo());

        return {
            ok: 1,
            nIndexesWas,
        };
    }

    /** 数据库统计命令 // EN: dbStats command */
    private async dbStatsCommand(): Promise<BSONDocument> {
        const stats = await this.getStats();
        return {
            ok: 1,
            db: path.basename(this.filePath, '.monodb'),
            collections: stats.collections,
            objects: stats.documents,
            avgObjSize: 0,
            dataSize: stats.dataSize,
            storageSize: stats.storageSize,
            indexes: stats.indexes,
        };
    }

    /** 集合统计命令 // EN: collStats command */
    private async collStatsCommand(collName: string): Promise<BSONDocument> {
        const collection = await this.getCollection(collName);
        if (!collection) {
            throw MonoError.namespaceNotFound(collName);
        }

        const info = collection.getInfo();
        const indexes = collection.listIndexes();
        return {
            ok: 1,
            ns: `test.${collName}`,
            count: info.documentCount,
            size: 0,
            avgObjSize: 0,
            storageSize: 0,
            nindexes: indexes.length,
        };
    }

    /** 验证命令 // EN: validate command */
    private async validateCommand(collName: string): Promise<BSONDocument> {
        const collection = await this.getCollection(collName);
        if (!collection) {
            throw MonoError.namespaceNotFound(collName);
        }

        // 使用集合的 validate 方法进行完整性检查
        // EN: Use Collection's validate method for full integrity check
        const result = await collection.validate();

        return {
            ok: result.valid ? 1 : 0,
            ns: `test.${collName}`,
            valid: result.valid,
            errors: result.errors,
            warnings: result.warnings,
            nrecords: result.nrecords,
            nIndexes: result.nIndexes,
        };
    }

    /** 获取更多游标数据命令 // EN: getMore command */
    private async getMoreCommand(cmd: BSONDocument): Promise<BSONDocument> {
        if (!this.cursorManager) {
            throw MonoError.internalError('cursor manager not initialized');
        }

        const cursorId = cmd.getMore as bigint;
        const collection = cmd.collection as string;
        const batchSize = cmd.batchSize as number | undefined;

        try {
            const result = this.cursorManager.getMore(cursorId, batchSize);
            return {
                ok: 1,
                cursor: {
                    id: result.cursorId,
                    ns: `test.${collection}`,
                    nextBatch: result.documents,
                },
            };
        } catch (err) {
            if (err instanceof MonoError) throw err;
            throw MonoError.cursorNotFound(cursorId);
        }
    }

    /** 终止游标命令 // EN: killCursors command */
    private async killCursorsCommand(cmd: BSONDocument): Promise<BSONDocument> {
        if (!this.cursorManager) {
            throw MonoError.internalError('cursor manager not initialized');
        }

        const cursorIds = (cmd.cursors as bigint[]) || [];
        const result = this.cursorManager.killCursors(cursorIds);

        return {
            ok: 1,
            cursorsKilled: result.cursorsKilled,
            cursorsNotFound: result.cursorsNotFound,
            cursorsAlive: result.cursorsAlive,
            cursorsUnknown: result.cursorsUnknown,
        };
    }

    // 会话/事务命令（与 Go/Swift 对齐）
    // EN: Session/Transaction commands (aligned with Go/Swift)

    /** 结束会话命令 // EN: endSessions command */
    private endSessionsCommand(cmd: BSONDocument): BSONDocument {
        if (!this.sessionManager) {
            return { ok: 1 };
        }

        const sessions = cmd.endSessions as BSONDocument[] | undefined;
        if (sessions) {
            for (const lsid of sessions) {
                try {
                    this.sessionManager.endSession(lsid);
                } catch {
                    // 忽略不存在会话的错误 // EN: Ignore errors for non-existent sessions
                }
            }
        }

        return { ok: 1 };
    }

    /** 刷新会话命令 // EN: refreshSessions command */
    private refreshSessionsCommand(cmd: BSONDocument): BSONDocument {
        if (!this.sessionManager) {
            return { ok: 1 };
        }

        const sessions = cmd.refreshSessions as BSONDocument[] | undefined;
        if (sessions) {
            for (const lsid of sessions) {
                try {
                    this.sessionManager.refreshSession(lsid);
                } catch {
                    // 忽略错误 // EN: Ignore errors
                }
            }
        }

        return { ok: 1 };
    }

    /** 开始事务命令 // EN: startTransaction command */
    private async startTransactionCommand(cmd: BSONDocument): Promise<BSONDocument> {
        if (!this.sessionManager || !this.txnManager) {
            throw MonoError.internalError('session/transaction manager not initialized');
        }

        // 从 lsid 提取会话 // EN: Extract session from lsid
        const lsid = cmd.lsid as BSONDocument | undefined;
        if (!lsid) {
            throw MonoError.badValue('startTransaction requires lsid');
        }

        const txnNumber = cmd.txnNumber as bigint | number | undefined;
        if (txnNumber === undefined) {
            throw MonoError.badValue('startTransaction requires txnNumber');
        }

        const txnNum = typeof txnNumber === 'number' ? BigInt(txnNumber) : txnNumber;

        // 提取选项 // EN: Extract options
        const readConcern = (cmd.readConcern as BSONDocument)?.level as string || 'local';
        const writeConcern = (cmd.writeConcern as BSONDocument)?.w as string || 'majority';

        const session = this.sessionManager.getOrCreateSession(lsid);
        this.sessionManager.startTransaction(session, txnNum, readConcern, writeConcern);

        return { ok: 1 };
    }

    /** 提交事务命令 // EN: commitTransaction command */
    private async commitTransactionCommand(cmd: BSONDocument): Promise<BSONDocument> {
        if (!this.sessionManager || !this.txnManager) {
            throw MonoError.internalError('session/transaction manager not initialized');
        }

        const lsid = cmd.lsid as BSONDocument | undefined;
        if (!lsid) {
            throw MonoError.badValue('commitTransaction requires lsid');
        }

        const txnNumber = cmd.txnNumber as bigint | number | undefined;
        if (txnNumber === undefined) {
            throw MonoError.badValue('commitTransaction requires txnNumber');
        }

        const txnNum = typeof txnNumber === 'number' ? BigInt(txnNumber) : txnNumber;
        const session = this.sessionManager.getOrCreateSession(lsid);

        await this.sessionManager.commitTransaction(session, txnNum);

        return { ok: 1 };
    }

    /** 中止事务命令 // EN: abortTransaction command */
    private async abortTransactionCommand(cmd: BSONDocument): Promise<BSONDocument> {
        if (!this.sessionManager || !this.txnManager) {
            throw MonoError.internalError('session/transaction manager not initialized');
        }

        const lsid = cmd.lsid as BSONDocument | undefined;
        if (!lsid) {
            throw MonoError.badValue('abortTransaction requires lsid');
        }

        const txnNumber = cmd.txnNumber as bigint | number | undefined;
        if (txnNumber === undefined) {
            throw MonoError.badValue('abortTransaction requires txnNumber');
        }

        const txnNum = typeof txnNumber === 'number' ? BigInt(txnNumber) : txnNumber;
        const session = this.sessionManager.getOrCreateSession(lsid);

        await this.sessionManager.abortTransaction(session, txnNum);

        return { ok: 1 };
    }

    // 解释命令（与 Go/Swift 对齐）
    // EN: Explain command (aligned with Go/Swift)

    /** explain 命令 // EN: explain command */
    private async explainCommand(cmd: BSONDocument): Promise<BSONDocument> {
        const explainCmd = cmd.explain as BSONDocument;
        if (!explainCmd || typeof explainCmd !== 'object') {
            throw MonoError.badValue('explain requires a command document');
        }

        const verbosity = cmd.verbosity as string || 'queryPlanner';
        const cmdName = Object.keys(explainCmd)[0];
        const collName = explainCmd[cmdName] as string;

        const collection = await this.getCollection(collName);
        if (!collection) {
            throw MonoError.namespaceNotFound(collName);
        }

        const info = collection.getInfo();
        const indexes = collection.listIndexes();

        // 根据命令类型构建查询计划 // EN: Build query plan based on command type
        let queryPlan: BSONDocument = {
            namespace: `test.${collName}`,
            indexFilterSet: false,
            parsedQuery: {},
        };

        if (cmdName === 'find') {
            const filter = explainCmd.filter as BSONDocument || {};
            queryPlan = {
                ...queryPlan,
                parsedQuery: filter,
                winningPlan: {
                    stage: 'COLLSCAN',
                    filter: filter,
                    direction: 'forward',
                },
                rejectedPlans: [],
            };

            // 检查是否可以使用索引 // EN: Check if any index can be used
            for (const idx of indexes) {
                const idxKeys = idx.key as BSONDocument;
                const firstKey = Object.keys(idxKeys)[0];
                if (firstKey && firstKey in filter) {
                    queryPlan.winningPlan = {
                        stage: 'FETCH',
                        inputStage: {
                            stage: 'IXSCAN',
                            keyPattern: idxKeys,
                            indexName: idx.name,
                            isMultiKey: false,
                            direction: 'forward',
                        },
                    };
                    break;
                }
            }
        } else if (cmdName === 'aggregate') {
            const pipeline = explainCmd.pipeline as BSONDocument[] || [];
            queryPlan = {
                ...queryPlan,
                optimizedPipeline: true,
                pipeline: pipeline.map((stage, i) => ({
                    $match: stage.$match || {},
                    stage: `STAGE_${i}`,
                })),
            };
        } else if (cmdName === 'count') {
            queryPlan = {
                ...queryPlan,
                winningPlan: {
                    stage: 'COUNT',
                },
            };
        }

        const result: BSONDocument = {
            ok: 1,
            queryPlanner: {
                plannerVersion: 1,
                namespace: `test.${collName}`,
                indexFilterSet: false,
                ...queryPlan,
            },
        };

        // 如果请求，添加执行统计 // EN: Add execution stats if requested
        if (verbosity === 'executionStats' || verbosity === 'allPlansExecution') {
            result.executionStats = {
                executionSuccess: true,
                nReturned: 0,
                executionTimeMillis: 0,
                totalKeysExamined: 0,
                totalDocsExamined: info.documentCount,
            };
        }

        // 添加服务器信息 // EN: Add server info
        if (verbosity === 'allPlansExecution') {
            result.serverInfo = {
                host: 'localhost',
                port: 27017,
                version: '1.0.0',
            };
        }

        return result;
    }

    // 目录管理 // EN: Catalog management

    /** 初始化目录 // EN: Initialize catalog */
    private async initCatalog(): Promise<void> {
        const rootPageId = this.pager!.getRootPageId();

        if (rootPageId === 0) {
            // 创建新的目录树 // EN: Create new catalog tree
            this.catalogTree = await BTree.create(this.pager!);
            this.pager!.setRootPageId(this.catalogTree.getRootPageId());
        } else {
            // 加载现有目录 // EN: Load existing catalog
            this.catalogTree = new BTree(this.pager!, rootPageId);
            await this.loadCatalog();
        }
    }

    /** 加载目录 // EN: Load catalog */
    private async loadCatalog(): Promise<void> {
        const entries = await this.catalogTree!.getAll();

        for (const encoded of entries) {
            const decoded = this.decoder.decode(encoded);
            // 重建集合信息（带正确的类型）// EN: Reconstruct CollectionInfo with proper typing
            const info: CollectionInfo = {
                name: decoded.name as string,
                dataPageId: decoded.dataPageId as number,
                indexRootPageId: decoded.indexRootPageId as number,
                documentCount: decoded.documentCount as number,
                indexes: (decoded.indexes as any[]) || [],
                createdAt: decoded.createdAt instanceof Date ? decoded.createdAt : new Date(decoded.createdAt as any),
                updatedAt: decoded.updatedAt instanceof Date ? decoded.updatedAt : new Date(decoded.updatedAt as any),
            };

            const collection = new Collection(info.name, this.pager!, info);
            await collection.init();
            this.catalog.set(info.name, collection);
        }

        logger.debug('Catalog loaded', { collections: this.catalog.size });
    }

    /** 保存目录条目 // EN: Save catalog entry */
    private async saveCatalogEntry(name: string, info: CollectionInfo): Promise<void> {
        const key = Buffer.from(name, 'utf8');
        const encoded = this.encoder.encode(info as any);
        await this.catalogTree!.insert(key, encoded);
    }

    /** 删除目录条目 // EN: Delete catalog entry */
    private async deleteCatalogEntry(name: string): Promise<void> {
        const key = Buffer.from(name, 'utf8');
        await this.catalogTree!.delete(key);
    }
}
