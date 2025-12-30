// Created by Yanjunhui

import { BSONDocument, Binary } from '../bson';
import { MonoError, ErrorCodes } from '../core';
import { Logger } from '../core/logger';
import { Transaction, TransactionManager, TxnState, TxnStateType } from './transaction';

/**
 * Session states
 */
export const SessionState = {
    Active: 0,
    Ended: 1,
} as const;

export type SessionStateType = typeof SessionState[keyof typeof SessionState];

/**
 * Session transaction
 */
export interface SessionTransaction {
    txnNumber: bigint;
    state: TxnStateType;
    startTime: Date;
    autoCommit: boolean;
    transaction: Transaction | null;
    operations: number;
    readConcern: string;
    writeConcern: string;
}

/**
 * MongoDB logical session
 */
export class Session {
    id: Binary;
    lastUsed: Date;
    state: SessionStateType = SessionState.Active;
    currentTxn: SessionTransaction | null = null;
    txnNumberUsed: bigint = -1n;

    constructor(id: Binary) {
        this.id = id;
        this.lastUsed = new Date();
    }

    /**
     * Update last used time
     */
    touch(): void {
        this.lastUsed = new Date();
    }
}

/**
 * Session options
 */
export interface SessionOptions {
    defaultTimeout?: number;
    causalConsistency?: boolean;
}

/**
 * Database interface for session manager
 */
interface DatabaseLike {
    txnManager?: TransactionManager | null;
    getCollection?: (name: string) => unknown;
}

/**
 * Session Manager
 */
export class SessionManager {
    private sessions: Map<string, Session> = new Map();
    private db: DatabaseLike;
    private sessionTTL: number = 30 * 60 * 1000; // 30 minutes
    private cleanupInterval: NodeJS.Timeout | null = null;
    private stopped: boolean = false;

    constructor(db: DatabaseLike) {
        this.db = db;

        // Start cleanup timer
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredSessions();
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    /**
     * Get or create a session
     */
    getOrCreateSession(lsid: BSONDocument): Session {
        // Extract id from lsid
        const sessionId = lsid.id as Binary | undefined;
        if (!sessionId || !(sessionId instanceof Binary)) {
            throw MonoError.fromCode(ErrorCodes.BadValue, 'lsid.id is required');
        }

        const key = this.sessionIdToKey(sessionId);

        let session = this.sessions.get(key);
        if (session) {
            session.touch();
            return session;
        }

        // Create new session
        session = new Session(sessionId);
        this.sessions.set(key, session);

        return session;
    }

    /**
     * End a session
     */
    endSession(lsid: BSONDocument): void {
        const sessionId = lsid.id as Binary | undefined;
        if (!sessionId || !(sessionId instanceof Binary)) {
            throw MonoError.fromCode(ErrorCodes.BadValue, 'lsid.id is required');
        }

        const key = this.sessionIdToKey(sessionId);
        const session = this.sessions.get(key);

        if (session) {
            // Abort active transaction if present
            if (session.currentTxn && session.currentTxn.state === TxnState.Active) {
                if (session.currentTxn.transaction && this.db.txnManager) {
                    this.db.txnManager.abort(session.currentTxn.transaction).catch(() => {});
                }
                session.currentTxn.state = TxnState.Aborted;
            }
            session.state = SessionState.Ended;
            this.sessions.delete(key);
        }
    }

    /**
     * Refresh session (extend timeout)
     */
    refreshSession(lsid: BSONDocument): void {
        const sessionId = lsid.id as Binary | undefined;
        if (!sessionId || !(sessionId instanceof Binary)) {
            return;
        }

        const key = this.sessionIdToKey(sessionId);
        const session = this.sessions.get(key);

        if (!session) {
            throw MonoError.fromCode(ErrorCodes.NoSuchSession, 'session not found');
        }

        session.touch();
    }

    /**
     * Start transaction in session
     */
    startTransaction(session: Session, txnNumber: bigint, readConcern: string, writeConcern: string): void {
        if (session.state !== SessionState.Active) {
            throw MonoError.fromCode(ErrorCodes.NoSuchSession, 'session has ended');
        }

        // Validate txnNumber
        if (txnNumber <= session.txnNumberUsed) {
            throw MonoError.fromCode(ErrorCodes.TransactionTooOld, 'txnNumber is too old');
        }

        // Abort any in-progress transaction
        if (session.currentTxn && session.currentTxn.state === TxnState.Active) {
            if (session.currentTxn.transaction && this.db.txnManager) {
                this.db.txnManager.abort(session.currentTxn.transaction).catch(() => {});
            }
        }

        // Create underlying transaction
        let txn: Transaction | null = null;
        if (this.db.txnManager) {
            txn = this.db.txnManager.begin();
        }

        session.currentTxn = {
            txnNumber,
            state: TxnState.Active,
            startTime: new Date(),
            autoCommit: false,
            transaction: txn,
            operations: 0,
            readConcern,
            writeConcern,
        };
        session.txnNumberUsed = txnNumber;
        session.touch();
    }

    /**
     * Commit transaction in session
     */
    async commitTransaction(session: Session, txnNumber: bigint): Promise<void> {
        if (!session.currentTxn) {
            throw MonoError.fromCode(ErrorCodes.NoSuchTransaction, 'no transaction in progress');
        }

        // Must match txnNumber
        if (session.currentTxn.txnNumber !== txnNumber) {
            throw MonoError.fromCode(ErrorCodes.NoSuchTransaction, 'transaction number mismatch');
        }

        if (session.currentTxn.state !== TxnState.Active) {
            if (session.currentTxn.state === TxnState.Committed) {
                // Repeated commit is allowed (idempotent)
                return;
            }
            throw MonoError.fromCode(ErrorCodes.TransactionAborted, 'transaction has been aborted');
        }

        // Commit underlying transaction
        if (session.currentTxn.transaction && this.db.txnManager) {
            await this.db.txnManager.commit(session.currentTxn.transaction);
        }

        session.currentTxn.state = TxnState.Committed;
        session.touch();
    }

    /**
     * Abort transaction in session
     */
    async abortTransaction(session: Session, txnNumber: bigint): Promise<void> {
        if (!session.currentTxn) {
            throw MonoError.fromCode(ErrorCodes.NoSuchTransaction, 'no transaction in progress');
        }

        // Must match txnNumber
        if (session.currentTxn.txnNumber !== txnNumber) {
            throw MonoError.fromCode(ErrorCodes.NoSuchTransaction, 'transaction number mismatch');
        }

        if (session.currentTxn.state !== TxnState.Active) {
            if (session.currentTxn.state === TxnState.Aborted) {
                // Repeated abort is allowed (idempotent)
                return;
            }
            throw MonoError.fromCode(ErrorCodes.TransactionCommitted, 'transaction has been committed');
        }

        // Abort underlying transaction
        if (session.currentTxn.transaction && this.db.txnManager) {
            await this.db.txnManager.abort(session.currentTxn.transaction);
        }

        session.currentTxn.state = TxnState.Aborted;
        session.touch();
    }

    /**
     * Get active transaction for session
     */
    getActiveTransaction(session: Session, txnNumber: bigint): SessionTransaction {
        if (!session.currentTxn) {
            throw MonoError.fromCode(ErrorCodes.NoSuchTransaction, 'no transaction in progress');
        }

        if (session.currentTxn.txnNumber !== txnNumber) {
            throw MonoError.fromCode(ErrorCodes.NoSuchTransaction, 'transaction number mismatch');
        }

        if (session.currentTxn.state !== TxnState.Active) {
            if (session.currentTxn.state === TxnState.Committed) {
                throw MonoError.fromCode(ErrorCodes.TransactionCommitted, 'transaction has been committed');
            }
            throw MonoError.fromCode(ErrorCodes.TransactionAborted, 'transaction has been aborted');
        }

        return session.currentTxn;
    }

    /**
     * Cleanup expired sessions
     */
    private cleanupExpiredSessions(): void {
        const now = Date.now();
        const expiredKeys: string[] = [];

        // Collect expired sessions
        for (const [key, session] of this.sessions) {
            if (now - session.lastUsed.getTime() > this.sessionTTL) {
                // Abort active transaction
                if (session.currentTxn && session.currentTxn.state === TxnState.Active) {
                    if (session.currentTxn.transaction && this.db.txnManager) {
                        this.db.txnManager.abort(session.currentTxn.transaction).catch(() => {});
                    }
                    session.currentTxn.state = TxnState.Aborted;
                }
                expiredKeys.push(key);
            }
        }

        // Remove expired sessions
        if (expiredKeys.length > 0) {
            for (const key of expiredKeys) {
                this.sessions.delete(key);
            }

            Logger.info('cleaned up expired sessions', { count: expiredKeys.length });
        }
    }

    /**
     * Close session manager
     */
    close(): void {
        if (this.stopped) {
            return;
        }
        this.stopped = true;

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        // Abort all active transactions
        for (const session of this.sessions.values()) {
            if (session.currentTxn && session.currentTxn.state === TxnState.Active) {
                if (session.currentTxn.transaction && this.db.txnManager) {
                    this.db.txnManager.abort(session.currentTxn.transaction).catch(() => {});
                }
                session.currentTxn.state = TxnState.Aborted;
            }
        }

        this.sessions.clear();
    }

    /**
     * Get active session count
     */
    getActiveSessionCount(): number {
        return this.sessions.size;
    }

    /**
     * Convert session ID to map key
     */
    private sessionIdToKey(id: Binary): string {
        return Buffer.from(id.buffer).toString('hex');
    }
}

/**
 * Command context (contains session and transaction info)
 */
export interface CommandContext {
    session: Session | null;
    sessionTxn: SessionTransaction | null;
    txnNumber: bigint;
    autoCommit: boolean | null;
    startTxn: boolean;
    readConcern: string;
    writeConcern: string;
}

/**
 * Extract command context from command
 */
export function extractCommandContext(sm: SessionManager, cmd: BSONDocument): CommandContext {
    const ctx: CommandContext = {
        session: null,
        sessionTxn: null,
        txnNumber: 0n,
        autoCommit: null,
        startTxn: false,
        readConcern: '',
        writeConcern: '',
    };

    let lsid: BSONDocument | null = null;
    let hasTxnNumber = false;

    // Extract fields from command
    if (cmd.lsid && typeof cmd.lsid === 'object') {
        lsid = cmd.lsid as BSONDocument;
    }

    if ('txnNumber' in cmd) {
        const txnVal = cmd.txnNumber;
        if (typeof txnVal === 'number') {
            ctx.txnNumber = BigInt(txnVal);
            hasTxnNumber = true;
        } else if (typeof txnVal === 'bigint') {
            ctx.txnNumber = txnVal;
            hasTxnNumber = true;
        }
    }

    if ('autocommit' in cmd && typeof cmd.autocommit === 'boolean') {
        ctx.autoCommit = cmd.autocommit;
    }

    if ('startTransaction' in cmd && typeof cmd.startTransaction === 'boolean') {
        ctx.startTxn = cmd.startTransaction;
    }

    // Extract readConcern
    if (cmd.readConcern && typeof cmd.readConcern === 'object') {
        const rc = cmd.readConcern as BSONDocument;
        if (typeof rc.level === 'string') {
            ctx.readConcern = rc.level;
        }
    }

    // Extract writeConcern
    if (cmd.writeConcern && typeof cmd.writeConcern === 'object') {
        const wc = cmd.writeConcern as BSONDocument;
        if (typeof wc.w === 'string') {
            ctx.writeConcern = wc.w;
        } else if (typeof wc.w === 'number') {
            ctx.writeConcern = 'w';
        }
    }

    // Get or create session if lsid is present
    if (lsid) {
        const session = sm.getOrCreateSession(lsid);
        ctx.session = session;

        // Handle transaction fields
        if (hasTxnNumber) {
            if (ctx.startTxn) {
                // Start new transaction
                if (ctx.autoCommit !== false) {
                    throw MonoError.fromCode(ErrorCodes.BadValue, 'autocommit must be false for multi-document transactions');
                }
                sm.startTransaction(session, ctx.txnNumber, ctx.readConcern, ctx.writeConcern);
            }

            // Get current transaction
            if (ctx.autoCommit === false) {
                ctx.sessionTxn = sm.getActiveTransaction(session, ctx.txnNumber);
            }
        }
    }

    return ctx;
}

/**
 * Check if command context is in transaction
 */
export function isInTransaction(ctx: CommandContext): boolean {
    return ctx.sessionTxn !== null && ctx.sessionTxn.state === TxnState.Active;
}

/**
 * Get underlying transaction from context
 */
export function getTransaction(ctx: CommandContext): Transaction | null {
    if (ctx.sessionTxn) {
        return ctx.sessionTxn.transaction;
    }
    return null;
}

/**
 * Record operation in transaction
 */
export function recordOperationInTxn(
    ctx: CommandContext,
    op: 'insert' | 'update' | 'delete',
    collection: string,
    docId: unknown,
    oldDoc: BSONDocument | null
): void {
    if (ctx.sessionTxn && ctx.sessionTxn.transaction) {
        ctx.sessionTxn.transaction.addUndoRecord(op, collection, docId, oldDoc);
        ctx.sessionTxn.operations++;
    }
}
