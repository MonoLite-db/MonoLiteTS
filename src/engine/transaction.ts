// Created by Yanjunhui

import { BSONDocument } from '../bson';
import { MonoError, ErrorCodes } from '../core';
import { Logger } from '../core/logger';

/**
 * 事务状态
 * // EN: Transaction states
 */
export const TxnState = {
    /** 活动中 // EN: Active */
    Active: 0,
    /** 已提交 // EN: Committed */
    Committed: 1,
    /** 已终止 // EN: Aborted */
    Aborted: 2,
} as const;

export type TxnStateType = typeof TxnState[keyof typeof TxnState];

/**
 * 隔离级别
 * // EN: Isolation levels
 */
export const IsolationLevel = {
    /** 读已提交 // EN: Read Committed */
    ReadCommitted: 0,
    /** 可重复读 // EN: Repeatable Read */
    RepeatableRead: 1,
    /** 快照 // EN: Snapshot */
    Snapshot: 2,
} as const;

export type IsolationLevelType = typeof IsolationLevel[keyof typeof IsolationLevel];

/**
 * 锁类型
 * // EN: Lock types
 */
export const LockType = {
    /** 读锁 // EN: Read lock */
    Read: 0,
    /** 写锁 // EN: Write lock */
    Write: 1,
} as const;

export type LockTypeValue = typeof LockType[keyof typeof LockType];

/**
 * 默认锁超时时间（30 秒）
 * // EN: Default lock timeout (30 seconds)
 */
export const DEFAULT_LOCK_TIMEOUT = 30000;

/**
 * 最大锁等待时间（60 秒）
 * // EN: Max lock wait time (60 seconds)
 */
export const MAX_LOCK_WAIT_TIME = 60000;

/**
 * 事务 ID 类型
 * // EN: Transaction ID type
 */
export type TxnID = bigint;

/**
 * 锁结构
 * // EN: Lock structure
 */
export interface Lock {
    /** 资源标识 // EN: Resource identifier */
    resource: string;
    /** 锁类型 // EN: Lock type */
    type: LockTypeValue;
    /** 事务 ID // EN: Transaction ID */
    txnId: TxnID;
    /** 持有时间 // EN: Held at time */
    heldAt: Date;
}

/**
 * 回滚记录
 * // EN: Undo record for rollback
 */
export interface UndoRecord {
    /** 操作类型 // EN: Operation type */
    operation: 'insert' | 'update' | 'delete';
    /** 集合名 // EN: Collection name */
    collection: string;
    /** 文档 ID // EN: Document ID */
    docId: unknown;
    /** 旧文档 // EN: Old document */
    oldDoc: BSONDocument | null;
}

/**
 * 锁请求
 * // EN: Lock request
 */
interface LockRequest {
    /** 事务 ID // EN: Transaction ID */
    txnId: TxnID;
    /** 锁类型 // EN: Lock type */
    lockType: LockTypeValue;
    /** 成功回调 // EN: Resolve callback */
    resolve: (lock: Lock) => void;
    /** 失败回调 // EN: Reject callback */
    reject: (error: Error) => void;
}

/**
 * 锁条目（支持共享锁）
 * // EN: Lock entry (supports shared locks)
 */
interface LockEntry {
    /** 资源标识 // EN: Resource identifier */
    resource: string;
    /** 排他锁 // EN: Exclusive lock */
    exclusive: Lock | null;
    /** 共享锁映射 // EN: Shared locks map */
    shared: Map<TxnID, Lock>;
    /** 等待队列 // EN: Wait queue */
    waitQueue: LockRequest[];
}

/**
 * 事务
 * // EN: Transaction
 */
export class Transaction {
    /** 事务 ID // EN: Transaction ID */
    readonly id: TxnID;
    /** 状态 // EN: State */
    state: TxnStateType = TxnState.Active;
    /** 隔离级别 // EN: Isolation level */
    isolationLevel: IsolationLevelType;
    /** 开始时间 // EN: Start time */
    readonly startTime: Date;
    /** 超时时间 // EN: Timeout */
    timeout: number;

    /** 锁映射 // EN: Locks map */
    private locks: Map<string, Lock> = new Map();
    /** 回滚日志 // EN: Undo log */
    private undoLog: UndoRecord[] = [];
    /** 数据库引用 // EN: Database reference */
    private db: unknown;

    constructor(
        id: TxnID,
        isolationLevel: IsolationLevelType = IsolationLevel.ReadCommitted,
        timeout: number = DEFAULT_LOCK_TIMEOUT,
        db?: unknown
    ) {
        this.id = id;
        this.isolationLevel = isolationLevel;
        this.startTime = new Date();
        this.timeout = timeout;
        this.db = db;
    }

    /**
     * 添加回滚记录
     * // EN: Add undo record
     */
    addUndoRecord(op: 'insert' | 'update' | 'delete', collection: string, docId: unknown, oldDoc: BSONDocument | null): void {
        this.undoLog.push({
            operation: op,
            collection,
            docId,
            oldDoc,
        });
    }

    /**
     * 获取回滚日志
     * // EN: Get undo log
     */
    getUndoLog(): UndoRecord[] {
        return [...this.undoLog];
    }

    /**
     * 清除回滚日志
     * // EN: Clear undo log
     */
    clearUndoLog(): void {
        this.undoLog = [];
    }

    /**
     * 添加锁
     * // EN: Add lock
     */
    addLock(lock: Lock): void {
        this.locks.set(lock.resource, lock);
    }

    /**
     * 移除锁
     * // EN: Remove lock
     */
    removeLock(resource: string): void {
        this.locks.delete(resource);
    }

    /**
     * 获取资源的锁
     * // EN: Get lock for resource
     */
    getLock(resource: string): Lock | undefined {
        return this.locks.get(resource);
    }

    /**
     * 获取所有锁
     * // EN: Get all locks
     */
    getAllLocks(): Lock[] {
        return Array.from(this.locks.values());
    }

    /**
     * 清除所有锁
     * // EN: Clear all locks
     */
    clearLocks(): void {
        this.locks.clear();
    }
}

/**
 * 锁管理器
 * // EN: Lock Manager
 */
export class LockManager {
    /** 锁映射表 // EN: Locks map */
    private locks: Map<string, LockEntry> = new Map();
    /** 等待图（用于死锁检测） // EN: Wait graph (for deadlock detection) */
    private waitGraph: Map<TxnID, TxnID[]> = new Map();

    /**
     * 获取锁
     * // EN: Acquire a lock
     */
    async acquire(resource: string, txnId: TxnID, lockType: LockTypeValue, timeout: number): Promise<Lock> {
        // 获取或创建锁条目 // EN: Get or create lock entry
        let entry = this.locks.get(resource);
        if (!entry) {
            entry = {
                resource,
                exclusive: null,
                shared: new Map(),
                waitQueue: [],
            };
            this.locks.set(resource, entry);
        }

        // 尝试立即获取 // EN: Try to acquire immediately
        if (this.canAcquire(entry, txnId, lockType)) {
            const lock: Lock = {
                resource,
                type: lockType,
                txnId,
                heldAt: new Date(),
            };

            if (lockType === LockType.Write) {
                entry.exclusive = lock;
            } else {
                entry.shared.set(txnId, lock);
            }

            return lock;
        }

        // 需要等待 // EN: Need to wait
        return new Promise((resolve, reject) => {
            const request: LockRequest = {
                txnId,
                lockType,
                resolve,
                reject,
            };

            entry!.waitQueue.push(request);

            // 收集等待信息 // EN: Collect wait-for information
            const waitForTxns: TxnID[] = [];
            if (entry!.exclusive && entry!.exclusive.txnId !== txnId) {
                waitForTxns.push(entry!.exclusive.txnId);
            }
            for (const [tid] of entry!.shared) {
                if (tid !== txnId) {
                    waitForTxns.push(tid);
                }
            }

            this.waitGraph.set(txnId, waitForTxns);

            // 检测死锁 // EN: Check for deadlock
            if (this.detectDeadlock(txnId)) {
                // 从等待队列中移除 // EN: Remove from wait queue
                const idx = entry!.waitQueue.indexOf(request);
                if (idx !== -1) {
                    entry!.waitQueue.splice(idx, 1);
                }
                this.waitGraph.delete(txnId);

                reject(MonoError.fromCode(ErrorCodes.TransactionAborted, 'deadlock detected'));
                return;
            }

            // 设置超时 // EN: Set timeout
            const timer = setTimeout(() => {
                // 从等待队列中移除 // EN: Remove from wait queue
                const idx = entry!.waitQueue.indexOf(request);
                if (idx !== -1) {
                    entry!.waitQueue.splice(idx, 1);
                }
                this.waitGraph.delete(txnId);

                reject(MonoError.fromCode(ErrorCodes.OperationFailed, 'lock acquisition timeout'));
            }, timeout);

            // 修改 resolve 以清除定时器 // EN: Modify resolve to clear timer
            const originalResolve = resolve;
            request.resolve = (lock: Lock) => {
                clearTimeout(timer);
                this.waitGraph.delete(txnId);
                originalResolve(lock);
            };
        });
    }

    /**
     * 检查是否可以获取锁
     * // EN: Check if lock can be acquired
     */
    private canAcquire(entry: LockEntry, txnId: TxnID, lockType: LockTypeValue): boolean {
        if (lockType === LockType.Read) {
            // 读锁：没有排他锁或排他锁是自己的 // EN: Read lock: no exclusive lock or exclusive lock is ours
            return entry.exclusive === null || entry.exclusive.txnId === txnId;
        }

        // 写锁：没有其他锁 // EN: Write lock: no other locks
        if (entry.exclusive !== null && entry.exclusive.txnId !== txnId) {
            return false;
        }

        // 检查其他事务是否持有共享锁 // EN: Check if other transactions hold shared locks
        for (const [tid] of entry.shared) {
            if (tid !== txnId) {
                return false;
            }
        }

        return true;
    }

    /**
     * 释放锁
     * // EN: Release a lock
     */
    release(resource: string, txnId: TxnID): void {
        const entry = this.locks.get(resource);
        if (!entry) {
            return;
        }

        // 释放锁 // EN: Release lock
        if (entry.exclusive && entry.exclusive.txnId === txnId) {
            entry.exclusive = null;
        }
        entry.shared.delete(txnId);

        // 唤醒等待者 // EN: Wake waiters
        this.wakeWaiters(entry);

        // 清理空条目 // EN: Clean up empty entry
        if (entry.exclusive === null && entry.shared.size === 0 && entry.waitQueue.length === 0) {
            this.locks.delete(resource);
        }
    }

    /**
     * 唤醒等待中的事务
     * // EN: Wake waiting transactions
     */
    private wakeWaiters(entry: LockEntry): void {
        const newQueue: LockRequest[] = [];

        for (const request of entry.waitQueue) {
            if (this.canAcquire(entry, request.txnId, request.lockType)) {
                const lock: Lock = {
                    resource: entry.resource,
                    type: request.lockType,
                    txnId: request.txnId,
                    heldAt: new Date(),
                };

                if (request.lockType === LockType.Write) {
                    entry.exclusive = lock;
                } else {
                    entry.shared.set(request.txnId, lock);
                }

                request.resolve(lock);
            } else {
                newQueue.push(request);
            }
        }

        entry.waitQueue = newQueue;
    }

    /**
     * 使用 DFS 检测死锁
     * // EN: Detect deadlock using DFS
     */
    private detectDeadlock(startTxnId: TxnID): boolean {
        const visited = new Set<TxnID>();
        const inStack = new Set<TxnID>();

        const dfs = (txnId: TxnID): boolean => {
            if (inStack.has(txnId)) {
                return true; // 检测到环 // EN: Cycle detected
            }
            if (visited.has(txnId)) {
                return false;
            }

            visited.add(txnId);
            inStack.add(txnId);

            const waitFor = this.waitGraph.get(txnId) || [];
            for (const waitForTxnId of waitFor) {
                if (dfs(waitForTxnId)) {
                    return true;
                }
            }

            inStack.delete(txnId);
            return false;
        };

        return dfs(startTxnId);
    }
}

/**
 * 事务管理器
 * // EN: Transaction Manager
 */
export class TransactionManager {
    /** 下一个事务 ID // EN: Next transaction ID */
    private nextTxnId: bigint = 1n;
    /** 活动事务映射 // EN: Active transactions map */
    private activeTxns: Map<TxnID, Transaction> = new Map();
    /** 锁管理器 // EN: Lock manager */
    private lockManager: LockManager = new LockManager();
    /** 数据库引用 // EN: Database reference */
    private db: unknown;

    constructor(db?: unknown) {
        this.db = db;
    }

    /**
     * 开始新事务
     * // EN: Begin a new transaction
     */
    begin(): Transaction {
        return this.beginWithOptions(IsolationLevel.ReadCommitted, DEFAULT_LOCK_TIMEOUT);
    }

    /**
     * 使用选项开始事务
     * // EN: Begin a transaction with options
     */
    beginWithOptions(isolation: IsolationLevelType, timeout: number): Transaction {
        const txnId = this.nextTxnId++;
        const txn = new Transaction(txnId, isolation, timeout, this.db);

        this.activeTxns.set(txnId, txn);
        return txn;
    }

    /**
     * 提交事务
     * // EN: Commit a transaction
     */
    async commit(txn: Transaction): Promise<void> {
        if (txn.state !== TxnState.Active) {
            throw MonoError.fromCode(ErrorCodes.TransactionCommitted, 'transaction is not active');
        }

        // 标记为已提交 // EN: Mark as committed
        txn.state = TxnState.Committed;

        // 释放所有锁 // EN: Release all locks
        this.releaseAllLocks(txn);

        // 清除回滚日志 // EN: Clear undo log
        txn.clearUndoLog();

        // 从活动事务中移除 // EN: Remove from active transactions
        this.activeTxns.delete(txn.id);

        // 如果数据库可用，刷新数据到磁盘 // EN: Flush data to disk if db is available
        if (this.db && typeof (this.db as { flush?: () => Promise<void> }).flush === 'function') {
            await (this.db as { flush: () => Promise<void> }).flush();
        }
    }

    /**
     * 终止事务
     * // EN: Abort a transaction
     */
    async abort(txn: Transaction): Promise<void> {
        if (txn.state !== TxnState.Active) {
            throw MonoError.fromCode(ErrorCodes.TransactionAborted, 'transaction is not active');
        }

        // 执行回滚 // EN: Perform rollback
        try {
            await this.rollback(txn);
        } catch (err) {
            Logger.error('rollback failed', {
                txnId: txn.id.toString(),
                error: err instanceof Error ? err.message : String(err),
            });
        }

        // 标记为已终止 // EN: Mark as aborted
        txn.state = TxnState.Aborted;

        // 释放所有锁 // EN: Release all locks
        this.releaseAllLocks(txn);

        // 从活动事务中移除 // EN: Remove from active transactions
        this.activeTxns.delete(txn.id);
    }

    /**
     * 回滚事务
     * // EN: Rollback a transaction
     */
    private async rollback(txn: Transaction): Promise<void> {
        const undoLog = txn.getUndoLog();

        // 按逆序应用回滚操作 // EN: Apply undo operations in reverse order
        for (let i = undoLog.length - 1; i >= 0; i--) {
            const record = undoLog[i];

            if (!this.db || typeof (this.db as { getCollection?: (name: string) => unknown }).getCollection !== 'function') {
                continue;
            }

            const col = (this.db as { getCollection: (name: string) => unknown }).getCollection(record.collection);
            if (!col) {
                continue;
            }

            const collection = col as {
                deleteOne?: (filter: BSONDocument) => void;
                replaceOne?: (filter: BSONDocument, doc: BSONDocument) => void;
                insert?: (doc: BSONDocument) => void;
            };

            switch (record.operation) {
                case 'insert':
                    // 回滚插入：删除文档 // EN: Roll back insert: delete document
                    if (collection.deleteOne) {
                        collection.deleteOne({ _id: record.docId as any });
                    }
                    break;

                case 'update':
                    // 回滚更新：恢复旧文档 // EN: Roll back update: restore old document
                    if (record.oldDoc && collection.replaceOne) {
                        collection.replaceOne({ _id: record.docId as any }, record.oldDoc);
                    }
                    break;

                case 'delete':
                    // 回滚删除：重新插入文档 // EN: Roll back delete: re-insert document
                    if (record.oldDoc && collection.insert) {
                        collection.insert(record.oldDoc);
                    }
                    break;
            }
        }
    }

    /**
     * 释放事务持有的所有锁
     * // EN: Release all locks held by a transaction
     */
    private releaseAllLocks(txn: Transaction): void {
        const locks = txn.getAllLocks();
        txn.clearLocks();

        for (const lock of locks) {
            this.lockManager.release(lock.resource, txn.id);
        }
    }

    /**
     * 为事务获取锁
     * // EN: Acquire a lock for a transaction
     */
    async acquireLock(txn: Transaction, resource: string, lockType: LockTypeValue): Promise<void> {
        if (txn.state !== TxnState.Active) {
            throw MonoError.fromCode(ErrorCodes.NoSuchTransaction, 'transaction is not active');
        }

        // 检查是否已持有锁 // EN: Check if already holds lock
        const existingLock = txn.getLock(resource);
        if (existingLock) {
            // 如果已持有写锁，或请求读锁，则返回 // EN: If already holds write lock, or requesting read lock, return
            if (existingLock.type === LockType.Write || lockType === LockType.Read) {
                return;
            }
            // 需要锁升级：读 -> 写 // EN: Need lock upgrade: read -> write
            await this.upgradeLock(txn, resource, existingLock);
            return;
        }

        // 正常获取锁 // EN: Normal lock acquisition
        const lock = await this.lockManager.acquire(resource, txn.id, lockType, txn.timeout);
        txn.addLock(lock);
    }

    /**
     * 将读锁升级为写锁
     * // EN: Upgrade lock from read to write
     */
    private async upgradeLock(txn: Transaction, resource: string, existingLock: Lock): Promise<void> {
        // 步骤 1：释放读锁 // EN: Step 1: Release read lock
        this.lockManager.release(resource, txn.id);
        txn.removeLock(resource);

        // 步骤 2：获取写锁 // EN: Step 2: Acquire write lock
        try {
            const newLock = await this.lockManager.acquire(resource, txn.id, LockType.Write, txn.timeout);
            txn.addLock(newLock);
        } catch (err) {
            // 升级失败，尝试恢复读锁 // EN: Upgrade failed, try to restore read lock
            try {
                const restoredLock = await this.lockManager.acquire(resource, txn.id, LockType.Read, txn.timeout);
                txn.addLock(restoredLock);
            } catch (restoreErr) {
                Logger.error('failed to restore read lock during upgrade failure', {
                    txnId: txn.id.toString(),
                    resource,
                    error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
                });
            }
            throw new Error(`lock upgrade failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * 获取活动事务数量
     * // EN: Get active transaction count
     */
    getActiveTransactionCount(): number {
        return this.activeTxns.size;
    }

    /**
     * 根据 ID 获取事务
     * // EN: Get transaction by ID
     */
    getTransaction(txnId: TxnID): Transaction | undefined {
        return this.activeTxns.get(txnId);
    }
}

/**
 * 生成集合级别锁资源标识符
 * // EN: Generate collection-level lock resource identifier
 */
export function collectionLockResource(collection: string): string {
    return `col:${collection}`;
}

/**
 * 生成文档级别锁资源标识符
 * // EN: Generate document-level lock resource identifier
 */
export function documentLockResource(collection: string, docId: unknown): string {
    return `doc:${collection}:${docId}`;
}
