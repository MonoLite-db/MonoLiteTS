// Created by Yanjunhui

/**
 * 异步互斥锁 - 用于在 async/await 环境中序列化写操作
 * EN: Async mutex for serializing write operations in async/await environment
 *
 * 在 Node.js 中，虽然 JavaScript 是单线程的，但 async/await 可能导致操作交错。
 * 此互斥锁确保写操作被序列化。
 * EN: In Node.js, although JavaScript is single-threaded, async/await can cause
 * interleaving of operations. This mutex ensures write operations are serialized.
 *
 * 使用示例 EN: Usage:
 * ```typescript
 * const mutex = new AsyncMutex();
 * await mutex.withLock(async () => {
 *     // 临界区 - 一次只有一个操作
 *     // EN: Critical section - only one operation at a time
 *     await writeToDatabase();
 * });
 * ```
 */
export class AsyncMutex {
    /** 等待队列 EN: Wait queue */
    private queue: Promise<void> = Promise.resolve();
    /** 锁定状态 EN: Locked state */
    private locked: boolean = false;

    /**
     * 使用独占锁执行函数
     * EN: Execute a function with exclusive lock
     * 操作被排队并按顺序执行
     * EN: Operations are queued and executed in order
     */
    async withLock<T>(fn: () => Promise<T>): Promise<T> {
        // 创建一个新的 Promise，当此操作完成时将被解决
        // EN: Create a new promise that will be resolved when this operation completes
        let release: () => void;
        const waitPromise = new Promise<void>(resolve => {
            release = resolve;
        });

        // 将此操作链接到所有先前操作之后
        // EN: Chain this operation after all previous operations
        const previousQueue = this.queue;
        this.queue = waitPromise;

        // 等待先前操作完成
        // EN: Wait for previous operations to complete
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
     * 检查互斥锁是否当前被锁定
     * EN: Check if mutex is currently locked
     */
    isLocked(): boolean {
        return this.locked;
    }
}

/**
 * 异步读写互斥锁 - 用于异步操作的读写锁
 * EN: AsyncRWMutex - Read-Write mutex for async operations
 *
 * 允许多个并发读取器或一个独占写入器。
 * 写入器优先以防止饥饿。
 * EN: Allows multiple concurrent readers OR one exclusive writer.
 * Writers have priority to prevent starvation.
 */
export class AsyncRWMutex {
    /** 读取器计数 EN: Reader count */
    private readers: number = 0;
    /** 是否有写入器 EN: Writer active */
    private writer: boolean = false;
    /** 等待中的写入器数量 EN: Writers waiting */
    private writerWaiting: number = 0;
    /** 等待队列 EN: Wait queue */
    private queue: Array<{
        type: 'read' | 'write';
        resolve: () => void;
    }> = [];

    /**
     * 使用读锁执行函数（共享）
     * EN: Execute a function with read lock (shared)
     * 多个读取器可以同时持有锁
     * EN: Multiple readers can hold the lock simultaneously
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
     * 使用写锁执行函数（独占）
     * EN: Execute a function with write lock (exclusive)
     * 只有一个写入器可以持有锁，不允许读取器
     * EN: Only one writer can hold the lock, no readers allowed
     */
    async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquireWrite();
        try {
            return await fn();
        } finally {
            this.releaseWrite();
        }
    }

    /**
     * 获取读锁
     * EN: Acquire read lock
     */
    private async acquireRead(): Promise<void> {
        // 如果有写入器或等待中的写入器，则在队列中等待
        // EN: If there's a writer or writers waiting, wait in queue
        if (this.writer || this.writerWaiting > 0) {
            await new Promise<void>(resolve => {
                this.queue.push({ type: 'read', resolve });
            });
        }
        this.readers++;
    }

    /**
     * 释放读锁
     * EN: Release read lock
     */
    private releaseRead(): void {
        this.readers--;
        if (this.readers === 0) {
            this.processQueue();
        }
    }

    /**
     * 获取写锁
     * EN: Acquire write lock
     */
    private async acquireWrite(): Promise<void> {
        this.writerWaiting++;
        // 如果有读取器或另一个写入器，则等待
        // EN: Wait if there are readers or another writer
        if (this.readers > 0 || this.writer) {
            await new Promise<void>(resolve => {
                this.queue.push({ type: 'write', resolve });
            });
        }
        this.writerWaiting--;
        this.writer = true;
    }

    /**
     * 释放写锁
     * EN: Release write lock
     */
    private releaseWrite(): void {
        this.writer = false;
        this.processQueue();
    }

    /**
     * 处理等待队列
     * EN: Process wait queue
     */
    private processQueue(): void {
        if (this.queue.length === 0) return;

        // 首先检查等待中的写入器（写入器优先）
        // EN: Check for waiting writers first (writer priority)
        const writerIndex = this.queue.findIndex(item => item.type === 'write');
        if (writerIndex !== -1 && this.readers === 0 && !this.writer) {
            const writer = this.queue.splice(writerIndex, 1)[0];
            writer.resolve();
            return;
        }

        // 如果没有活动或等待中的写入器，处理所有等待的读取器
        // EN: Process all waiting readers if no writer is active or waiting
        if (!this.writer && this.writerWaiting === 0) {
            const readers = this.queue.filter(item => item.type === 'read');
            this.queue = this.queue.filter(item => item.type === 'write');
            for (const reader of readers) {
                reader.resolve();
            }
        }
    }

    /**
     * 获取当前锁状态
     * EN: Get current lock status
     */
    getStatus(): { readers: number; writer: boolean; waiting: number } {
        return {
            readers: this.readers,
            writer: this.writer,
            waiting: this.queue.length,
        };
    }
}
