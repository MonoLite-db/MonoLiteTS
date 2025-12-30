// Created by Yanjunhui

import { BSONDocument } from '../bson';
import { MonoError, ErrorCodes } from '../core';
import { Logger } from '../core/logger';

/**
 * Transaction states
 */
export const TxnState = {
    Active: 0,
    Committed: 1,
    Aborted: 2,
} as const;

export type TxnStateType = typeof TxnState[keyof typeof TxnState];

/**
 * Isolation levels
 */
export const IsolationLevel = {
    ReadCommitted: 0,
    RepeatableRead: 1,
    Snapshot: 2,
} as const;

export type IsolationLevelType = typeof IsolationLevel[keyof typeof IsolationLevel];

/**
 * Lock types
 */
export const LockType = {
    Read: 0,
    Write: 1,
} as const;

export type LockTypeValue = typeof LockType[keyof typeof LockType];

/**
 * Default lock timeout (30 seconds)
 */
export const DEFAULT_LOCK_TIMEOUT = 30000;

/**
 * Max lock wait time (60 seconds)
 */
export const MAX_LOCK_WAIT_TIME = 60000;

/**
 * Transaction ID type
 */
export type TxnID = bigint;

/**
 * Lock structure
 */
export interface Lock {
    resource: string;
    type: LockTypeValue;
    txnId: TxnID;
    heldAt: Date;
}

/**
 * Undo record for rollback
 */
export interface UndoRecord {
    operation: 'insert' | 'update' | 'delete';
    collection: string;
    docId: unknown;
    oldDoc: BSONDocument | null;
}

/**
 * Lock request
 */
interface LockRequest {
    txnId: TxnID;
    lockType: LockTypeValue;
    resolve: (lock: Lock) => void;
    reject: (error: Error) => void;
}

/**
 * Lock entry (supports shared locks)
 */
interface LockEntry {
    resource: string;
    exclusive: Lock | null;
    shared: Map<TxnID, Lock>;
    waitQueue: LockRequest[];
}

/**
 * Transaction
 */
export class Transaction {
    readonly id: TxnID;
    state: TxnStateType = TxnState.Active;
    isolationLevel: IsolationLevelType;
    readonly startTime: Date;
    timeout: number;

    private locks: Map<string, Lock> = new Map();
    private undoLog: UndoRecord[] = [];
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
     * Add undo record
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
     * Get undo log
     */
    getUndoLog(): UndoRecord[] {
        return [...this.undoLog];
    }

    /**
     * Clear undo log
     */
    clearUndoLog(): void {
        this.undoLog = [];
    }

    /**
     * Add lock
     */
    addLock(lock: Lock): void {
        this.locks.set(lock.resource, lock);
    }

    /**
     * Remove lock
     */
    removeLock(resource: string): void {
        this.locks.delete(resource);
    }

    /**
     * Get lock for resource
     */
    getLock(resource: string): Lock | undefined {
        return this.locks.get(resource);
    }

    /**
     * Get all locks
     */
    getAllLocks(): Lock[] {
        return Array.from(this.locks.values());
    }

    /**
     * Clear all locks
     */
    clearLocks(): void {
        this.locks.clear();
    }
}

/**
 * Lock Manager
 */
export class LockManager {
    private locks: Map<string, LockEntry> = new Map();
    private waitGraph: Map<TxnID, TxnID[]> = new Map();

    /**
     * Acquire a lock
     */
    async acquire(resource: string, txnId: TxnID, lockType: LockTypeValue, timeout: number): Promise<Lock> {
        // Get or create lock entry
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

        // Try to acquire immediately
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

        // Need to wait
        return new Promise((resolve, reject) => {
            const request: LockRequest = {
                txnId,
                lockType,
                resolve,
                reject,
            };

            entry!.waitQueue.push(request);

            // Collect wait-for information
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

            // Check for deadlock
            if (this.detectDeadlock(txnId)) {
                // Remove from wait queue
                const idx = entry!.waitQueue.indexOf(request);
                if (idx !== -1) {
                    entry!.waitQueue.splice(idx, 1);
                }
                this.waitGraph.delete(txnId);

                reject(MonoError.fromCode(ErrorCodes.TransactionAborted, 'deadlock detected'));
                return;
            }

            // Set timeout
            const timer = setTimeout(() => {
                // Remove from wait queue
                const idx = entry!.waitQueue.indexOf(request);
                if (idx !== -1) {
                    entry!.waitQueue.splice(idx, 1);
                }
                this.waitGraph.delete(txnId);

                reject(MonoError.fromCode(ErrorCodes.OperationFailed, 'lock acquisition timeout'));
            }, timeout);

            // Modify resolve to clear timer
            const originalResolve = resolve;
            request.resolve = (lock: Lock) => {
                clearTimeout(timer);
                this.waitGraph.delete(txnId);
                originalResolve(lock);
            };
        });
    }

    /**
     * Check if lock can be acquired
     */
    private canAcquire(entry: LockEntry, txnId: TxnID, lockType: LockTypeValue): boolean {
        if (lockType === LockType.Read) {
            // Read lock: no exclusive lock or exclusive lock is ours
            return entry.exclusive === null || entry.exclusive.txnId === txnId;
        }

        // Write lock: no other locks
        if (entry.exclusive !== null && entry.exclusive.txnId !== txnId) {
            return false;
        }

        // Check if other transactions hold shared locks
        for (const [tid] of entry.shared) {
            if (tid !== txnId) {
                return false;
            }
        }

        return true;
    }

    /**
     * Release a lock
     */
    release(resource: string, txnId: TxnID): void {
        const entry = this.locks.get(resource);
        if (!entry) {
            return;
        }

        // Release lock
        if (entry.exclusive && entry.exclusive.txnId === txnId) {
            entry.exclusive = null;
        }
        entry.shared.delete(txnId);

        // Wake waiters
        this.wakeWaiters(entry);

        // Clean up empty entry
        if (entry.exclusive === null && entry.shared.size === 0 && entry.waitQueue.length === 0) {
            this.locks.delete(resource);
        }
    }

    /**
     * Wake waiting transactions
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
     * Detect deadlock using DFS
     */
    private detectDeadlock(startTxnId: TxnID): boolean {
        const visited = new Set<TxnID>();
        const inStack = new Set<TxnID>();

        const dfs = (txnId: TxnID): boolean => {
            if (inStack.has(txnId)) {
                return true; // Cycle detected
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
 * Transaction Manager
 */
export class TransactionManager {
    private nextTxnId: bigint = 1n;
    private activeTxns: Map<TxnID, Transaction> = new Map();
    private lockManager: LockManager = new LockManager();
    private db: unknown;

    constructor(db?: unknown) {
        this.db = db;
    }

    /**
     * Begin a new transaction
     */
    begin(): Transaction {
        return this.beginWithOptions(IsolationLevel.ReadCommitted, DEFAULT_LOCK_TIMEOUT);
    }

    /**
     * Begin a transaction with options
     */
    beginWithOptions(isolation: IsolationLevelType, timeout: number): Transaction {
        const txnId = this.nextTxnId++;
        const txn = new Transaction(txnId, isolation, timeout, this.db);

        this.activeTxns.set(txnId, txn);
        return txn;
    }

    /**
     * Commit a transaction
     */
    async commit(txn: Transaction): Promise<void> {
        if (txn.state !== TxnState.Active) {
            throw MonoError.fromCode(ErrorCodes.TransactionCommitted, 'transaction is not active');
        }

        // Mark as committed
        txn.state = TxnState.Committed;

        // Release all locks
        this.releaseAllLocks(txn);

        // Clear undo log
        txn.clearUndoLog();

        // Remove from active transactions
        this.activeTxns.delete(txn.id);

        // Flush data to disk if db is available
        if (this.db && typeof (this.db as { flush?: () => Promise<void> }).flush === 'function') {
            await (this.db as { flush: () => Promise<void> }).flush();
        }
    }

    /**
     * Abort a transaction
     */
    async abort(txn: Transaction): Promise<void> {
        if (txn.state !== TxnState.Active) {
            throw MonoError.fromCode(ErrorCodes.TransactionAborted, 'transaction is not active');
        }

        // Perform rollback
        try {
            await this.rollback(txn);
        } catch (err) {
            Logger.error('rollback failed', {
                txnId: txn.id.toString(),
                error: err instanceof Error ? err.message : String(err),
            });
        }

        // Mark as aborted
        txn.state = TxnState.Aborted;

        // Release all locks
        this.releaseAllLocks(txn);

        // Remove from active transactions
        this.activeTxns.delete(txn.id);
    }

    /**
     * Rollback a transaction
     */
    private async rollback(txn: Transaction): Promise<void> {
        const undoLog = txn.getUndoLog();

        // Apply undo operations in reverse order
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
                    // Roll back insert: delete document
                    if (collection.deleteOne) {
                        collection.deleteOne({ _id: record.docId as any });
                    }
                    break;

                case 'update':
                    // Roll back update: restore old document
                    if (record.oldDoc && collection.replaceOne) {
                        collection.replaceOne({ _id: record.docId as any }, record.oldDoc);
                    }
                    break;

                case 'delete':
                    // Roll back delete: re-insert document
                    if (record.oldDoc && collection.insert) {
                        collection.insert(record.oldDoc);
                    }
                    break;
            }
        }
    }

    /**
     * Release all locks held by a transaction
     */
    private releaseAllLocks(txn: Transaction): void {
        const locks = txn.getAllLocks();
        txn.clearLocks();

        for (const lock of locks) {
            this.lockManager.release(lock.resource, txn.id);
        }
    }

    /**
     * Acquire a lock for a transaction
     */
    async acquireLock(txn: Transaction, resource: string, lockType: LockTypeValue): Promise<void> {
        if (txn.state !== TxnState.Active) {
            throw MonoError.fromCode(ErrorCodes.NoSuchTransaction, 'transaction is not active');
        }

        // Check if already holds lock
        const existingLock = txn.getLock(resource);
        if (existingLock) {
            // If already holds write lock, or requesting read lock, return
            if (existingLock.type === LockType.Write || lockType === LockType.Read) {
                return;
            }
            // Need lock upgrade: read -> write
            await this.upgradeLock(txn, resource, existingLock);
            return;
        }

        // Normal lock acquisition
        const lock = await this.lockManager.acquire(resource, txn.id, lockType, txn.timeout);
        txn.addLock(lock);
    }

    /**
     * Upgrade lock from read to write
     */
    private async upgradeLock(txn: Transaction, resource: string, existingLock: Lock): Promise<void> {
        // Step 1: Release read lock
        this.lockManager.release(resource, txn.id);
        txn.removeLock(resource);

        // Step 2: Acquire write lock
        try {
            const newLock = await this.lockManager.acquire(resource, txn.id, LockType.Write, txn.timeout);
            txn.addLock(newLock);
        } catch (err) {
            // Upgrade failed, try to restore read lock
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
     * Get active transaction count
     */
    getActiveTransactionCount(): number {
        return this.activeTxns.size;
    }

    /**
     * Get transaction by ID
     */
    getTransaction(txnId: TxnID): Transaction | undefined {
        return this.activeTxns.get(txnId);
    }
}

/**
 * Generate collection-level lock resource identifier
 */
export function collectionLockResource(collection: string): string {
    return `col:${collection}`;
}

/**
 * Generate document-level lock resource identifier
 */
export function documentLockResource(collection: string, docId: unknown): string {
    return `doc:${collection}:${docId}`;
}
