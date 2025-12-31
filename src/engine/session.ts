// Created by Yanjunhui

import { BSONDocument, Binary } from '../bson';
import { MonoError, ErrorCodes } from '../core';
import { Logger } from '../core/logger';
import { Transaction, TransactionManager, TxnState, TxnStateType } from './transaction';

/**
 * 会话状态
 * // EN: Session states
 */
export const SessionState = {
    /** 活动中 // EN: Active */
    Active: 0,
    /** 已结束 // EN: Ended */
    Ended: 1,
} as const;

export type SessionStateType = typeof SessionState[keyof typeof SessionState];

/**
 * 会话事务
 * // EN: Session transaction
 */
export interface SessionTransaction {
    /** 事务编号 // EN: Transaction number */
    txnNumber: bigint;
    /** 状态 // EN: State */
    state: TxnStateType;
    /** 开始时间 // EN: Start time */
    startTime: Date;
    /** 是否自动提交 // EN: Auto commit */
    autoCommit: boolean;
    /** 底层事务 // EN: Underlying transaction */
    transaction: Transaction | null;
    /** 操作数 // EN: Operation count */
    operations: number;
    /** 读关注级别 // EN: Read concern level */
    readConcern: string;
    /** 写关注级别 // EN: Write concern level */
    writeConcern: string;
}

/**
 * MongoDB 逻辑会话
 * // EN: MongoDB logical session
 */
export class Session {
    /** 会话 ID // EN: Session ID */
    id: Binary;
    /** 最后使用时间 // EN: Last used time */
    lastUsed: Date;
    /** 状态 // EN: State */
    state: SessionStateType = SessionState.Active;
    /** 当前事务 // EN: Current transaction */
    currentTxn: SessionTransaction | null = null;
    /** 已使用的事务编号 // EN: Used transaction number */
    txnNumberUsed: bigint = -1n;

    constructor(id: Binary) {
        this.id = id;
        this.lastUsed = new Date();
    }

    /**
     * 更新最后使用时间
     * // EN: Update last used time
     */
    touch(): void {
        this.lastUsed = new Date();
    }
}

/**
 * 会话选项
 * // EN: Session options
 */
export interface SessionOptions {
    /** 默认超时时间 // EN: Default timeout */
    defaultTimeout?: number;
    /** 因果一致性 // EN: Causal consistency */
    causalConsistency?: boolean;
}

/**
 * 数据库接口（用于会话管理器）
 * // EN: Database interface for session manager
 */
interface DatabaseLike {
    txnManager?: TransactionManager | null;
    getCollection?: (name: string) => unknown;
}

/**
 * 会话管理器
 * // EN: Session Manager
 */
export class SessionManager {
    /** 会话映射表 // EN: Sessions map */
    private sessions: Map<string, Session> = new Map();
    /** 数据库引用 // EN: Database reference */
    private db: DatabaseLike;
    /** 会话 TTL（30 分钟） // EN: Session TTL (30 minutes) */
    private sessionTTL: number = 30 * 60 * 1000;
    /** 清理定时器 // EN: Cleanup timer */
    private cleanupInterval: NodeJS.Timeout | null = null;
    /** 是否已停止 // EN: Whether stopped */
    private stopped: boolean = false;

    constructor(db: DatabaseLike) {
        this.db = db;

        // 启动清理定时器 // EN: Start cleanup timer
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredSessions();
        }, 5 * 60 * 1000); // 每 5 分钟 // EN: Every 5 minutes
    }

    /**
     * 获取或创建会话
     * // EN: Get or create a session
     */
    getOrCreateSession(lsid: BSONDocument): Session {
        // 从 lsid 中提取 id // EN: Extract id from lsid
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

        // 创建新会话 // EN: Create new session
        session = new Session(sessionId);
        this.sessions.set(key, session);

        return session;
    }

    /**
     * 结束会话
     * // EN: End a session
     */
    endSession(lsid: BSONDocument): void {
        const sessionId = lsid.id as Binary | undefined;
        if (!sessionId || !(sessionId instanceof Binary)) {
            throw MonoError.fromCode(ErrorCodes.BadValue, 'lsid.id is required');
        }

        const key = this.sessionIdToKey(sessionId);
        const session = this.sessions.get(key);

        if (session) {
            // 如果有活动事务则终止 // EN: Abort active transaction if present
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
     * 刷新会话（延长超时）
     * // EN: Refresh session (extend timeout)
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
     * 在会话中启动事务
     * // EN: Start transaction in session
     */
    startTransaction(session: Session, txnNumber: bigint, readConcern: string, writeConcern: string): void {
        if (session.state !== SessionState.Active) {
            throw MonoError.fromCode(ErrorCodes.NoSuchSession, 'session has ended');
        }

        // 验证事务编号 // EN: Validate txnNumber
        if (txnNumber <= session.txnNumberUsed) {
            throw MonoError.fromCode(ErrorCodes.TransactionTooOld, 'txnNumber is too old');
        }

        // 终止任何进行中的事务 // EN: Abort any in-progress transaction
        if (session.currentTxn && session.currentTxn.state === TxnState.Active) {
            if (session.currentTxn.transaction && this.db.txnManager) {
                this.db.txnManager.abort(session.currentTxn.transaction).catch(() => {});
            }
        }

        // 创建底层事务 // EN: Create underlying transaction
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
     * 在会话中提交事务
     * // EN: Commit transaction in session
     */
    async commitTransaction(session: Session, txnNumber: bigint): Promise<void> {
        if (!session.currentTxn) {
            throw MonoError.fromCode(ErrorCodes.NoSuchTransaction, 'no transaction in progress');
        }

        // 必须匹配事务编号 // EN: Must match txnNumber
        if (session.currentTxn.txnNumber !== txnNumber) {
            throw MonoError.fromCode(ErrorCodes.NoSuchTransaction, 'transaction number mismatch');
        }

        if (session.currentTxn.state !== TxnState.Active) {
            if (session.currentTxn.state === TxnState.Committed) {
                // 允许重复提交（幂等） // EN: Repeated commit is allowed (idempotent)
                return;
            }
            throw MonoError.fromCode(ErrorCodes.TransactionAborted, 'transaction has been aborted');
        }

        // 提交底层事务 // EN: Commit underlying transaction
        if (session.currentTxn.transaction && this.db.txnManager) {
            await this.db.txnManager.commit(session.currentTxn.transaction);
        }

        session.currentTxn.state = TxnState.Committed;
        session.touch();
    }

    /**
     * 在会话中终止事务
     * // EN: Abort transaction in session
     */
    async abortTransaction(session: Session, txnNumber: bigint): Promise<void> {
        if (!session.currentTxn) {
            throw MonoError.fromCode(ErrorCodes.NoSuchTransaction, 'no transaction in progress');
        }

        // 必须匹配事务编号 // EN: Must match txnNumber
        if (session.currentTxn.txnNumber !== txnNumber) {
            throw MonoError.fromCode(ErrorCodes.NoSuchTransaction, 'transaction number mismatch');
        }

        if (session.currentTxn.state !== TxnState.Active) {
            if (session.currentTxn.state === TxnState.Aborted) {
                // 允许重复终止（幂等） // EN: Repeated abort is allowed (idempotent)
                return;
            }
            throw MonoError.fromCode(ErrorCodes.TransactionCommitted, 'transaction has been committed');
        }

        // 终止底层事务 // EN: Abort underlying transaction
        if (session.currentTxn.transaction && this.db.txnManager) {
            await this.db.txnManager.abort(session.currentTxn.transaction);
        }

        session.currentTxn.state = TxnState.Aborted;
        session.touch();
    }

    /**
     * 获取会话的活动事务
     * // EN: Get active transaction for session
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
     * 清理过期会话
     * // EN: Cleanup expired sessions
     */
    private cleanupExpiredSessions(): void {
        const now = Date.now();
        const expiredKeys: string[] = [];

        // 收集过期的会话 // EN: Collect expired sessions
        for (const [key, session] of this.sessions) {
            if (now - session.lastUsed.getTime() > this.sessionTTL) {
                // 终止活动事务 // EN: Abort active transaction
                if (session.currentTxn && session.currentTxn.state === TxnState.Active) {
                    if (session.currentTxn.transaction && this.db.txnManager) {
                        this.db.txnManager.abort(session.currentTxn.transaction).catch(() => {});
                    }
                    session.currentTxn.state = TxnState.Aborted;
                }
                expiredKeys.push(key);
            }
        }

        // 移除过期的会话 // EN: Remove expired sessions
        if (expiredKeys.length > 0) {
            for (const key of expiredKeys) {
                this.sessions.delete(key);
            }

            Logger.info('cleaned up expired sessions', { count: expiredKeys.length });
        }
    }

    /**
     * 关闭会话管理器
     * // EN: Close session manager
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

        // 终止所有活动事务 // EN: Abort all active transactions
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
     * 获取活动会话数量
     * // EN: Get active session count
     */
    getActiveSessionCount(): number {
        return this.sessions.size;
    }

    /**
     * 将会话 ID 转换为映射键
     * // EN: Convert session ID to map key
     */
    private sessionIdToKey(id: Binary): string {
        return Buffer.from(id.buffer).toString('hex');
    }
}

/**
 * 命令上下文（包含会话和事务信息）
 * // EN: Command context (contains session and transaction info)
 */
export interface CommandContext {
    /** 会话 // EN: Session */
    session: Session | null;
    /** 会话事务 // EN: Session transaction */
    sessionTxn: SessionTransaction | null;
    /** 事务编号 // EN: Transaction number */
    txnNumber: bigint;
    /** 是否自动提交 // EN: Auto commit */
    autoCommit: boolean | null;
    /** 是否启动事务 // EN: Start transaction flag */
    startTxn: boolean;
    /** 读关注级别 // EN: Read concern level */
    readConcern: string;
    /** 写关注级别 // EN: Write concern level */
    writeConcern: string;
}

/**
 * 从命令中提取命令上下文
 * // EN: Extract command context from command
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

    // 从命令中提取字段 // EN: Extract fields from command
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

    // 提取 readConcern // EN: Extract readConcern
    if (cmd.readConcern && typeof cmd.readConcern === 'object') {
        const rc = cmd.readConcern as BSONDocument;
        if (typeof rc.level === 'string') {
            ctx.readConcern = rc.level;
        }
    }

    // 提取 writeConcern // EN: Extract writeConcern
    if (cmd.writeConcern && typeof cmd.writeConcern === 'object') {
        const wc = cmd.writeConcern as BSONDocument;
        if (typeof wc.w === 'string') {
            ctx.writeConcern = wc.w;
        } else if (typeof wc.w === 'number') {
            ctx.writeConcern = 'w';
        }
    }

    // 如果存在 lsid，获取或创建会话 // EN: Get or create session if lsid is present
    if (lsid) {
        const session = sm.getOrCreateSession(lsid);
        ctx.session = session;

        // 处理事务字段 // EN: Handle transaction fields
        if (hasTxnNumber) {
            if (ctx.startTxn) {
                // 启动新事务 // EN: Start new transaction
                if (ctx.autoCommit !== false) {
                    throw MonoError.fromCode(ErrorCodes.BadValue, 'autocommit must be false for multi-document transactions');
                }
                sm.startTransaction(session, ctx.txnNumber, ctx.readConcern, ctx.writeConcern);
            }

            // 获取当前事务 // EN: Get current transaction
            if (ctx.autoCommit === false) {
                ctx.sessionTxn = sm.getActiveTransaction(session, ctx.txnNumber);
            }
        }
    }

    return ctx;
}

/**
 * 检查命令上下文是否在事务中
 * // EN: Check if command context is in transaction
 */
export function isInTransaction(ctx: CommandContext): boolean {
    return ctx.sessionTxn !== null && ctx.sessionTxn.state === TxnState.Active;
}

/**
 * 从上下文获取底层事务
 * // EN: Get underlying transaction from context
 */
export function getTransaction(ctx: CommandContext): Transaction | null {
    if (ctx.sessionTxn) {
        return ctx.sessionTxn.transaction;
    }
    return null;
}

/**
 * 在事务中记录操作
 * // EN: Record operation in transaction
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
