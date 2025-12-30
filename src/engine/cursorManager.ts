// Created by Yanjunhui

import { BSONDocument, ObjectId } from '../bson';
import { MonoError, ErrorCodes, logger } from '../core';

/**
 * Cursor state
 */
export const CursorState = {
    Active: 0,
    Exhausted: 1,
    Killed: 2,
} as const;

export type CursorStateType = typeof CursorState[keyof typeof CursorState];

/**
 * Cursor (aligned with Go/Swift versions)
 * 
 * Holds query results and allows batch retrieval via getMore
 */
export class Cursor {
    readonly id: bigint;
    readonly ns: string;
    private documents: BSONDocument[];
    private position: number = 0;
    private batchSize: number;
    state: CursorStateType = CursorState.Active;
    readonly createdAt: Date;
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
     * Get first batch of results
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
     * Get next batch of results
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
     * Check if cursor has more documents
     */
    hasMore(): boolean {
        return this.state === CursorState.Active && this.position < this.documents.length;
    }

    /**
     * Get remaining count
     */
    remaining(): number {
        return Math.max(0, this.documents.length - this.position);
    }

    /**
     * Kill the cursor
     */
    kill(): void {
        this.state = CursorState.Killed;
        this.documents = [];
    }
}

/**
 * CursorManager (aligned with Go/Swift versions)
 * 
 * Features:
 * - Creates and manages cursors for query results
 * - Supports getMore for batch retrieval
 * - Automatic cleanup of idle/expired cursors
 */
export class CursorManager {
    private cursors: Map<bigint, Cursor> = new Map();
    private nextCursorId: bigint = 1n;
    private cursorTTL: number = 10 * 60 * 1000; // 10 minutes
    private cleanupInterval: NodeJS.Timeout | null = null;
    private stopped: boolean = false;

    constructor() {
        // Start cleanup timer
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredCursors();
        }, 60 * 1000); // Every 1 minute
    }

    /**
     * Create a new cursor
     * 
     * If all documents fit in first batch, returns cursor id 0 (no cursor needed)
     */
    createCursor(
        ns: string,
        documents: BSONDocument[],
        batchSize: number = 101
    ): Cursor {
        const id = this.nextCursorId++;
        const cursor = new Cursor(id, ns, documents, batchSize);
        
        // Get first batch to determine if cursor is needed
        const firstBatch = cursor.getFirstBatch();
        
        // If all documents returned in first batch, don't store cursor
        if (cursor.state === CursorState.Exhausted) {
            // Return a pseudo-cursor with id 0
            return new Cursor(0n, ns, firstBatch, batchSize);
        }

        this.cursors.set(id, cursor);
        logger.debug('Cursor created', { id: id.toString(), ns, count: documents.length });

        return cursor;
    }

    /**
     * Get cursor by ID
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
     * Get more documents from cursor
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

        // If cursor exhausted, remove it and return id 0
        if (cursor.state === CursorState.Exhausted) {
            this.cursors.delete(cursorId);
            return { documents, cursorId: 0n };
        }

        return { documents, cursorId };
    }

    /**
     * Kill cursors
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
     * Cleanup expired cursors
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
     * Close cursor manager
     */
    close(): void {
        if (this.stopped) return;
        this.stopped = true;

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        // Kill all cursors
        for (const cursor of this.cursors.values()) {
            cursor.kill();
        }
        this.cursors.clear();
    }

    /**
     * Get active cursor count
     */
    getActiveCursorCount(): number {
        return this.cursors.size;
    }
}


