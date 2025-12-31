// Created by Yanjunhui

import { BSONDocument, ObjectId } from '../bson';
import { MonoError, ErrorCodes, logger } from '../core';

/**
 * 游标状态
 * // EN: Cursor state
 */
export const CursorState = {
    /** 活动中 // EN: Active */
    Active: 0,
    /** 已耗尽 // EN: Exhausted */
    Exhausted: 1,
    /** 已终止 // EN: Killed */
    Killed: 2,
} as const;

export type CursorStateType = typeof CursorState[keyof typeof CursorState];

/**
 * 游标（与 Go/Swift 版本对齐）
 * 保存查询结果并允许通过 getMore 批量获取
 * // EN: Cursor (aligned with Go/Swift versions)
 * // EN: Holds query results and allows batch retrieval via getMore
 */
export class Cursor {
    /** 游标 ID // EN: Cursor ID */
    readonly id: bigint;
    /** 命名空间 // EN: Namespace */
    readonly ns: string;
    /** 文档列表 // EN: Documents list */
    private documents: BSONDocument[];
    /** 当前位置 // EN: Current position */
    private position: number = 0;
    /** 批次大小 // EN: Batch size */
    private batchSize: number;
    /** 状态 // EN: State */
    state: CursorStateType = CursorState.Active;
    /** 创建时间 // EN: Created at */
    readonly createdAt: Date;
    /** 最后使用时间 // EN: Last used */
    lastUsed: Date;

    constructor(
        id: bigint,
        ns: string,
        documents: BSONDocument[],
        batchSize: number = 101
    ) {
        this.id = id;
        this.ns = ns;
        this.documents = documents;
        this.batchSize = batchSize;
        this.createdAt = new Date();
        this.lastUsed = new Date();
    }

    /**
     * 获取第一批结果
     * // EN: Get first batch of results
     */
    getFirstBatch(): BSONDocument[] {
        this.lastUsed = new Date();
        const batch = this.documents.slice(0, this.batchSize);
        this.position = batch.length;

        if (this.position >= this.documents.length) {
            this.state = CursorState.Exhausted;
        }

        return batch;
    }

    /**
     * 获取下一批结果
     * // EN: Get next batch of results
     */
    getNextBatch(requestedBatchSize?: number): BSONDocument[] {
        if (this.state !== CursorState.Active) {
            return [];
        }

        this.lastUsed = new Date();
        const size = requestedBatchSize ?? this.batchSize;
        const batch = this.documents.slice(this.position, this.position + size);
        this.position += batch.length;

        if (this.position >= this.documents.length) {
            this.state = CursorState.Exhausted;
        }

        return batch;
    }

    /**
     * 检查游标是否有更多文档
     * // EN: Check if cursor has more documents
     */
    hasMore(): boolean {
        return this.state === CursorState.Active && this.position < this.documents.length;
    }

    /**
     * 获取剩余数量
     * // EN: Get remaining count
     */
    remaining(): number {
        return Math.max(0, this.documents.length - this.position);
    }

    /**
     * 终止游标
     * // EN: Kill the cursor
     */
    kill(): void {
        this.state = CursorState.Killed;
        this.documents = [];
    }
}

/**
 * 游标管理器（与 Go/Swift 版本对齐）
 * // EN: CursorManager (aligned with Go/Swift versions)
 *
 * 功能特性 // EN: Features:
 * - 创建和管理查询结果的游标 // EN: Creates and manages cursors for query results
 * - 支持 getMore 批量获取 // EN: Supports getMore for batch retrieval
 * - 自动清理空闲/过期的游标 // EN: Automatic cleanup of idle/expired cursors
 */
export class CursorManager {
    /** 游标映射表 // EN: Cursors map */
    private cursors: Map<bigint, Cursor> = new Map();
    /** 下一个游标 ID // EN: Next cursor ID */
    private nextCursorId: bigint = 1n;
    /** 游标 TTL（10 分钟） // EN: Cursor TTL (10 minutes) */
    private cursorTTL: number = 10 * 60 * 1000;
    /** 清理定时器 // EN: Cleanup timer */
    private cleanupInterval: NodeJS.Timeout | null = null;
    /** 是否已停止 // EN: Whether stopped */
    private stopped: boolean = false;

    constructor() {
        // 启动清理定时器 // EN: Start cleanup timer
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredCursors();
        }, 60 * 1000); // 每 1 分钟 // EN: Every 1 minute
    }

    /**
     * 创建新游标
     * 如果所有文档都在第一批中，返回游标 ID 0（不需要游标）
     * // EN: Create a new cursor
     * // EN: If all documents fit in first batch, returns cursor id 0 (no cursor needed)
     */
    createCursor(
        ns: string,
        documents: BSONDocument[],
        batchSize: number = 101
    ): Cursor {
        const id = this.nextCursorId++;
        const cursor = new Cursor(id, ns, documents, batchSize);

        // 获取第一批以确定是否需要游标 // EN: Get first batch to determine if cursor is needed
        const firstBatch = cursor.getFirstBatch();

        // 如果第一批已返回所有文档，则不存储游标 // EN: If all documents returned in first batch, don't store cursor
        if (cursor.state === CursorState.Exhausted) {
            // 返回 ID 为 0 的伪游标 // EN: Return a pseudo-cursor with id 0
            return new Cursor(0n, ns, firstBatch, batchSize);
        }

        this.cursors.set(id, cursor);
        logger.debug('Cursor created', { id: id.toString(), ns, count: documents.length });

        return cursor;
    }

    /**
     * 根据 ID 获取游标
     * // EN: Get cursor by ID
     */
    getCursor(id: bigint): Cursor | null {
        const cursor = this.cursors.get(id);
        if (!cursor) {
            return null;
        }

        if (cursor.state !== CursorState.Active) {
            this.cursors.delete(id);
            return null;
        }

        return cursor;
    }

    /**
     * 从游标获取更多文档
     * // EN: Get more documents from cursor
     */
    getMore(cursorId: bigint, batchSize?: number): { documents: BSONDocument[]; cursorId: bigint } {
        if (cursorId === 0n) {
            throw MonoError.cursorNotFound(cursorId);
        }

        const cursor = this.getCursor(cursorId);
        if (!cursor) {
            throw MonoError.cursorNotFound(cursorId);
        }

        const documents = cursor.getNextBatch(batchSize);

        // 如果游标已耗尽，移除它并返回 ID 0 // EN: If cursor exhausted, remove it and return id 0
        if (cursor.state === CursorState.Exhausted) {
            this.cursors.delete(cursorId);
            return { documents, cursorId: 0n };
        }

        return { documents, cursorId };
    }

    /**
     * 终止游标
     * // EN: Kill cursors
     */
    killCursors(ids: bigint[]): {
        cursorsKilled: bigint[];
        cursorsNotFound: bigint[];
        cursorsAlive: bigint[];
        cursorsUnknown: bigint[];
    } {
        const cursorsKilled: bigint[] = [];
        const cursorsNotFound: bigint[] = [];

        for (const id of ids) {
            const cursor = this.cursors.get(id);
            if (cursor) {
                cursor.kill();
                this.cursors.delete(id);
                cursorsKilled.push(id);
            } else {
                cursorsNotFound.push(id);
            }
        }

        return {
            cursorsKilled,
            cursorsNotFound,
            cursorsAlive: [],
            cursorsUnknown: [],
        };
    }

    /**
     * 清理过期游标
     * // EN: Cleanup expired cursors
     */
    private cleanupExpiredCursors(): void {
        const now = Date.now();
        const expiredIds: bigint[] = [];

        for (const [id, cursor] of this.cursors) {
            if (now - cursor.lastUsed.getTime() > this.cursorTTL) {
                expiredIds.push(id);
            }
        }

        if (expiredIds.length > 0) {
            for (const id of expiredIds) {
                const cursor = this.cursors.get(id);
                if (cursor) {
                    cursor.kill();
                    this.cursors.delete(id);
                }
            }
            logger.info('Cleaned up expired cursors', { count: expiredIds.length });
        }
    }

    /**
     * 关闭游标管理器
     * // EN: Close cursor manager
     */
    close(): void {
        if (this.stopped) return;
        this.stopped = true;

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        // 终止所有游标 // EN: Kill all cursors
        for (const cursor of this.cursors.values()) {
            cursor.kill();
        }
        this.cursors.clear();
    }

    /**
     * 获取活动游标数量
     * // EN: Get active cursor count
     */
    getActiveCursorCount(): number {
        return this.cursors.size;
    }
}


