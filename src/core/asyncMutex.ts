// Created by Yanjunhui
// Async mutex for serializing write operations in async/await environment

/**
 * AsyncMutex - Serializes async operations to prevent race conditions
 *
 * In Node.js, although JavaScript is single-threaded, async/await can cause
 * interleaving of operations. This mutex ensures write operations are serialized.
 *
 * Usage:
 * ```typescript
 * const mutex = new AsyncMutex();
 * await mutex.withLock(async () => {
 *     // Critical section - only one operation at a time
 *     await writeToDatabase();
 * });
 * ```
 */
export class AsyncMutex {
    private queue: Promise<void> = Promise.resolve();
    private locked: boolean = false;

    /**
     * Execute a function with exclusive lock
     * Operations are queued and executed in order
     */
    async withLock<T>(fn: () => Promise<T>): Promise<T> {
        // Create a new promise that will be resolved when this operation completes
        let release: () => void;
        const waitPromise = new Promise<void>(resolve => {
            release = resolve;
        });

        // Chain this operation after all previous operations
        const previousQueue = this.queue;
        this.queue = waitPromise;

        // Wait for previous operations to complete
        await previousQueue;

        this.locked = true;
        try {
            return await fn();
        } finally {
            this.locked = false;
            release!();
        }
    }

    /**
     * Check if mutex is currently locked
     */
    isLocked(): boolean {
        return this.locked;
    }
}

/**
 * AsyncRWMutex - Read-Write mutex for async operations
 *
 * Allows multiple concurrent readers OR one exclusive writer.
 * Writers have priority to prevent starvation.
 */
export class AsyncRWMutex {
    private readers: number = 0;
    private writer: boolean = false;
    private writerWaiting: number = 0;
    private queue: Array<{
        type: 'read' | 'write';
        resolve: () => void;
    }> = [];

    /**
     * Execute a function with read lock (shared)
     * Multiple readers can hold the lock simultaneously
     */
    async withReadLock<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquireRead();
        try {
            return await fn();
        } finally {
            this.releaseRead();
        }
    }

    /**
     * Execute a function with write lock (exclusive)
     * Only one writer can hold the lock, no readers allowed
     */
    async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquireWrite();
        try {
            return await fn();
        } finally {
            this.releaseWrite();
        }
    }

    private async acquireRead(): Promise<void> {
        // If there's a writer or writers waiting, wait in queue
        if (this.writer || this.writerWaiting > 0) {
            await new Promise<void>(resolve => {
                this.queue.push({ type: 'read', resolve });
            });
        }
        this.readers++;
    }

    private releaseRead(): void {
        this.readers--;
        if (this.readers === 0) {
            this.processQueue();
        }
    }

    private async acquireWrite(): Promise<void> {
        this.writerWaiting++;
        // Wait if there are readers or another writer
        if (this.readers > 0 || this.writer) {
            await new Promise<void>(resolve => {
                this.queue.push({ type: 'write', resolve });
            });
        }
        this.writerWaiting--;
        this.writer = true;
    }

    private releaseWrite(): void {
        this.writer = false;
        this.processQueue();
    }

    private processQueue(): void {
        if (this.queue.length === 0) return;

        // Check for waiting writers first (writer priority)
        const writerIndex = this.queue.findIndex(item => item.type === 'write');
        if (writerIndex !== -1 && this.readers === 0 && !this.writer) {
            const writer = this.queue.splice(writerIndex, 1)[0];
            writer.resolve();
            return;
        }

        // Process all waiting readers if no writer is active or waiting
        if (!this.writer && this.writerWaiting === 0) {
            const readers = this.queue.filter(item => item.type === 'read');
            this.queue = this.queue.filter(item => item.type === 'write');
            for (const reader of readers) {
                reader.resolve();
            }
        }
    }

    /**
     * Get current lock status
     */
    getStatus(): { readers: number; writer: boolean; waiting: number } {
        return {
            readers: this.readers,
            writer: this.writer,
            waiting: this.queue.length,
        };
    }
}
