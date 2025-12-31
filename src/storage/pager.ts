// Created by Yanjunhui

import * as fs from 'fs';
import * as path from 'path';
import { PAGE_SIZE, PageType, INVALID_PAGE_ID, DEFAULT_CACHE_SIZE, FILE_HEADER_SIZE } from './constants';
import { SlottedPage } from './page';
import { FileHeader } from './fileHeader';
import { WAL, WALRecordType, MetaUpdateType } from './wal';

/**
 * 页面缓存条目
 * // EN: Page cache entry
 */
interface CacheEntry {
    /** 页面 // EN: Page */
    page: SlottedPage;
    /** 是否脏页 // EN: Whether dirty */
    dirty: boolean;
    /** 最后访问时间 // EN: Last access time */
    lastAccess: number;
}

/**
 * Pager 选项
 * // EN: Pager options
 */
export interface PagerOptions {
    /** 缓存大小 // EN: Cache size */
    cacheSize?: number;
    /** 是否启用 WAL // EN: Whether to enable WAL */
    enableWAL?: boolean;
}

/**
 * Pager - 数据库文件的页面管理器（与 Go 版本对齐）
 * // EN: Pager - Page manager for database file (aligned with Go version)
 *
 * 文件布局 // EN: File layout:
 * +--------------------+
 * | 文件头 (64B)        |  <- 偏移 0 // EN: File Header (64B) <- offset 0
 * +--------------------+
 * | 页面 0 (4KB)        |  <- 偏移 64 // EN: Page 0 (4KB) <- offset FILE_HEADER_SIZE (64)
 * +--------------------+
 * | 页面 1 (4KB)        |  <- 偏移 64 + 4096 // EN: Page 1 (4KB) <- offset 64 + 4096
 * +--------------------+
 * | ...                |
 * +--------------------+
 *
 * 职责 // EN: Responsibilities:
 * - 文件 I/O // EN: File I/O
 * - 页面分配和释放 // EN: Page allocation and deallocation
 * - 页面缓存管理 // EN: Page cache management
 * - 空闲列表管理 // EN: Free list management
 */
export class Pager {
    /** 文件路径 // EN: File path */
    private filePath: string;
    /** 文件描述符 // EN: File descriptor */
    private fd: number = -1;
    /** 文件头 // EN: File header */
    private header: FileHeader;
    /** 空闲页列表 // EN: Free pages list */
    private freePages: number[] = [];
    /** 页面缓存 // EN: Page cache */
    private cache: Map<number, CacheEntry> = new Map();
    /** 最大缓存大小 // EN: Max cache size */
    private maxCacheSize: number;
    /** 是否已关闭 // EN: Whether closed */
    private closed: boolean = false;
    // WAL 支持（与 Go 版本对齐）// EN: WAL support (aligned with Go version)
    /** WAL 实例 // EN: WAL instance */
    private wal: WAL | null = null;
    /** 是否启用 WAL // EN: Whether WAL is enabled */
    private walEnabled: boolean = true;
    /** 页面 LSN 映射 // EN: Page LSN map */
    private pageLSN: Map<number, bigint> = new Map();

    private constructor(filePath: string, header: FileHeader, maxCacheSize: number, enableWAL: boolean) {
        this.filePath = filePath;
        this.header = header;
        this.maxCacheSize = maxCacheSize;
        this.walEnabled = enableWAL;
    }

    /**
     * 计算页面在文件中的偏移量（与 Go 对齐）
     * // EN: Calculate page offset in file (aligned with Go)
     */
    private pageOffset(pageId: number): number {
        return FILE_HEADER_SIZE + pageId * PAGE_SIZE;
    }

    /**
     * 打开或创建数据库文件
     * // EN: Open or create a database file
     */
    static async open(filePath: string, options?: PagerOptions): Promise<Pager> {
        const maxCacheSize = options?.cacheSize ?? DEFAULT_CACHE_SIZE;
        const enableWAL = options?.enableWAL ?? true;

        let header: FileHeader;
        let fd: number;
        let exists = false;

        if (fs.existsSync(filePath)) {
            // Open existing file
            exists = true;
            fd = fs.openSync(filePath, 'r+');
            const headerBuf = Buffer.alloc(FILE_HEADER_SIZE);
            fs.readSync(fd, headerBuf, 0, FILE_HEADER_SIZE, 0);
            header = FileHeader.fromBuffer(headerBuf);
        } else {
            // Create new file
            const dir = path.dirname(filePath);
            if (dir && !fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fd = fs.openSync(filePath, 'w+');
            header = FileHeader.create();

            // Write header
            fs.writeSync(fd, header.toBuffer(), 0, FILE_HEADER_SIZE, 0);

            // Create and write initial meta page (Page 0)
            const metaPage = SlottedPage.create(0, PageType.Meta);
            fs.writeSync(fd, metaPage.toBuffer(), 0, PAGE_SIZE, FILE_HEADER_SIZE);

            fs.fsyncSync(fd);
        }

        const pager = new Pager(filePath, header, maxCacheSize, enableWAL);
        pager.fd = fd;

        // Load free list
        await pager.loadFreeList();

        // Initialize WAL (aligned with Go version)
        if (enableWAL) {
            const walPath = filePath + '.wal';
            pager.wal = await WAL.open(walPath);

            // Perform crash recovery if file existed
            if (exists) {
                await pager.recover();
            }
        }

        return pager;
    }

    /**
     * Load free page list from FreeListHead chain
     */
    private async loadFreeList(): Promise<void> {
        this.freePages = [];
        let currentId = this.header.getFreeListHead();

        while (currentId !== INVALID_PAGE_ID) {
            this.freePages.push(currentId);

            // Read page to get next free page ID
            const offset = this.pageOffset(currentId);
            const buf = Buffer.alloc(PAGE_SIZE);
            fs.readSync(this.fd, buf, 0, PAGE_SIZE, offset);

            const page = SlottedPage.fromBuffer(buf);
            currentId = page.getNextPageId();

            // Prevent infinite loop
            if (this.freePages.length > this.header.getPageCount()) {
                throw new Error('Free list cycle detected');
            }
        }
    }

    /**
     * Crash recovery from WAL (aligned with Go version)
     *
     * Follows WAL-ahead principle: WAL records represent committed intent
     * and must be fully replayed to restore consistency.
     */
    private async recover(): Promise<void> {
        if (!this.wal) return;

        const checkpointLSN = this.wal.getCheckpointLSN();
        const records = await this.wal.readAfter(checkpointLSN);
        if (records.length === 0) return;

        // Track allocated page types for ensureFileSize
        const allocPageTypes = new Map<number, PageType>();

        // Get current file size
        const stats = fs.fstatSync(this.fd);
        const actualSize = stats.size;

        // Redo: replay all records
        for (const record of records) {
            switch (record.type) {
                case WALRecordType.PageWrite:
                    // Replay page write (only if complete page data)
                    if (record.data.length === PAGE_SIZE) {
                        const offset = this.pageOffset(record.pageId);
                        fs.writeSync(this.fd, record.data, 0, PAGE_SIZE, offset);
                    }
                    break;

                case WALRecordType.AllocPage:
                    // Page allocation - ensure pageCount is correct
                    if (record.pageId >= this.header.getPageCount()) {
                        this.header.setPageCount(record.pageId + 1);
                    }
                    // Record page type
                    const pageType = record.data.length >= 1 ? record.data[0] as PageType : PageType.Data;
                    allocPageTypes.set(record.pageId, pageType);

                    // If physical page exists, initialize it
                    const offset = this.pageOffset(record.pageId);
                    if (offset + PAGE_SIZE <= actualSize) {
                        const initPage = SlottedPage.create(record.pageId, pageType);
                        fs.writeSync(this.fd, initPage.toBuffer(), 0, PAGE_SIZE, offset);
                    }
                    break;

                case WALRecordType.FreePage:
                    // Free page - handled via MetaUpdate
                    break;

                case WALRecordType.MetaUpdate:
                    // Replay metadata updates
                    if (record.data.length >= 9) {
                        const metaType = record.data[0] as MetaUpdateType;
                        const newValue = record.data.readUInt32LE(5);

                        switch (metaType) {
                            case MetaUpdateType.FreeListHead:
                                this.header.setFreeListHead(newValue);
                                break;
                            case MetaUpdateType.PageCount:
                                this.header.setPageCount(newValue);
                                break;
                            case MetaUpdateType.CatalogPageId:
                                this.header.setCatalogPageId(newValue);
                                break;
                        }
                    }
                    break;

                case WALRecordType.Commit:
                case WALRecordType.Checkpoint:
                    // No action needed
                    break;
            }
        }

        // Sync data file
        fs.fsyncSync(this.fd);

        // Ensure file size matches PageCount
        await this.ensureFileSize(allocPageTypes);

        // Write updated header
        fs.writeSync(this.fd, this.header.toBuffer(), 0, FILE_HEADER_SIZE, 0);
        fs.fsyncSync(this.fd);

        // Reload free list
        await this.loadFreeList();
    }

    /**
     * Ensure file size matches PageCount
     */
    private async ensureFileSize(allocPageTypes?: Map<number, PageType>): Promise<void> {
        const expectedSize = FILE_HEADER_SIZE + this.header.getPageCount() * PAGE_SIZE;
        const stats = fs.fstatSync(this.fd);
        const actualSize = stats.size;

        if (actualSize < expectedSize) {
            // Need to extend file
            let startOffset = actualSize;

            // Handle partial page at end
            if (actualSize > FILE_HEADER_SIZE) {
                const relOffset = actualSize - FILE_HEADER_SIZE;
                const remainder = relOffset % PAGE_SIZE;
                if (remainder !== 0) {
                    startOffset = actualSize - remainder;
                }
            } else {
                startOffset = FILE_HEADER_SIZE;
            }

            // Write missing pages
            for (let offset = startOffset; offset < expectedSize; offset += PAGE_SIZE) {
                const pageId = (offset - FILE_HEADER_SIZE) / PAGE_SIZE;
                const pageType = allocPageTypes?.get(pageId) ?? PageType.Data;
                const page = SlottedPage.create(pageId, pageType);
                fs.writeSync(this.fd, page.toBuffer(), 0, PAGE_SIZE, offset);
            }
        }
    }

    /**
     * Close the pager
     */
    async close(): Promise<void> {
        if (this.closed) return;

        await this.flush();

        // Close WAL
        if (this.wal) {
            await this.wal.close();
            this.wal = null;
        }

        if (this.fd >= 0) {
            fs.closeSync(this.fd);
            this.fd = -1;
        }
        this.cache.clear();
        this.pageLSN.clear();
        this.freePages = [];
        this.closed = true;
    }

    /**
     * Get file path
     */
    getFilePath(): string {
        return this.filePath;
    }

    /**
     * Get page count
     */
    getPageCount(): number {
        return this.header.getPageCount();
    }

    /**
     * Get catalog page ID (root page)
     */
    getCatalogPageId(): number {
        return this.header.getCatalogPageId();
    }

    /**
     * Set catalog page ID
     */
    setCatalogPageId(pageId: number): void {
        this.header.setCatalogPageId(pageId);
    }

    // Legacy methods for backward compatibility
    getRootPageId(): number {
        return this.getCatalogPageId();
    }

    setRootPageId(pageId: number): void {
        this.setCatalogPageId(pageId);
    }

    /**
     * Allocate a new page (WAL-ahead principle)
     */
    async allocPage(pageType: PageType): Promise<SlottedPage> {
        let pageId: number;
        let fromFreeList = false;
        const oldFreeListHead = this.header.getFreeListHead();
        let newFreeListHead = INVALID_PAGE_ID;
        const oldPageCount = this.header.getPageCount();
        let newPageCount = oldPageCount;

        // Try to reuse from free list
        if (this.freePages.length > 0) {
            fromFreeList = true;
            pageId = this.freePages[0];

            // Read page to get next free pointer
            const offset = this.pageOffset(pageId);
            const buf = Buffer.alloc(PAGE_SIZE);
            fs.readSync(this.fd, buf, 0, PAGE_SIZE, offset);
            const freePage = SlottedPage.fromBuffer(buf);
            newFreeListHead = freePage.getNextPageId();
        } else {
            // Allocate new page at end of file
            pageId = this.header.getPageCount();
            newPageCount = pageId + 1;
        }

        // WAL-ahead: write allocation and meta records first
        if (this.wal && this.walEnabled) {
            await this.wal.appendAllocPage(pageId, pageType);

            if (fromFreeList) {
                await this.wal.appendMetaUpdate(MetaUpdateType.FreeListHead, oldFreeListHead, newFreeListHead);
            } else {
                await this.wal.appendMetaUpdate(MetaUpdateType.PageCount, oldPageCount, newPageCount);
            }

            await this.wal.sync();
        }

        // Now safe to update memory state
        if (fromFreeList) {
            this.freePages.shift();
            this.header.setFreeListHead(newFreeListHead);
        } else {
            this.header.setPageCount(newPageCount);
        }
        this.header.touch();

        // Create new page
        const page = SlottedPage.create(pageId, pageType);

        // Write initialized page to file immediately (for new pages)
        if (!fromFreeList) {
            const offset = this.pageOffset(pageId);
            fs.writeSync(this.fd, page.toBuffer(), 0, PAGE_SIZE, offset);
        }

        // Write header
        fs.writeSync(this.fd, this.header.toBuffer(), 0, FILE_HEADER_SIZE, 0);

        // Cache the page
        this.cachePage(pageId, page, true);

        return page;
    }

    /**
     * Free a page (add to free list, WAL-ahead)
     */
    async freePage(pageId: number): Promise<void> {
        if (pageId === 0 || pageId === INVALID_PAGE_ID) {
            throw new Error('Cannot free meta page or invalid page');
        }

        const oldFreeListHead = this.header.getFreeListHead();
        const newFreeListHead = pageId;

        // WAL-ahead: write free and meta records first
        if (this.wal && this.walEnabled) {
            await this.wal.appendFreePage(pageId);
            await this.wal.appendMetaUpdate(MetaUpdateType.FreeListHead, oldFreeListHead, newFreeListHead);
            await this.wal.sync();
        }

        // Read page and update it
        const offset = this.pageOffset(pageId);
        const buf = Buffer.alloc(PAGE_SIZE);
        fs.readSync(this.fd, buf, 0, PAGE_SIZE, offset);

        const page = SlottedPage.fromBuffer(buf);
        page.setPageType(PageType.Free);
        page.setNextPageId(oldFreeListHead);

        // Write page with WAL
        await this.writePageDirect(pageId, page.toBuffer());

        // Update header
        this.header.setFreeListHead(newFreeListHead);
        this.header.touch();
        fs.writeSync(this.fd, this.header.toBuffer(), 0, FILE_HEADER_SIZE, 0);

        // Update free list (LIFO)
        this.freePages.unshift(pageId);

        // Remove from cache
        this.cache.delete(pageId);
    }

    /**
     * Read a page from file or cache
     */
    async readPage(pageId: number): Promise<SlottedPage> {
        // Check cache
        const cached = this.cache.get(pageId);
        if (cached) {
            cached.lastAccess = Date.now();
            return cached.page;
        }

        // Read from file
        const offset = this.pageOffset(pageId);
        const buf = Buffer.alloc(PAGE_SIZE);
        fs.readSync(this.fd, buf, 0, PAGE_SIZE, offset);

        const page = SlottedPage.fromBuffer(buf);
        this.cachePage(pageId, page, false);
        return page;
    }

    /**
     * Write a page (marks as dirty, actual write on flush)
     */
    async writePage(page: SlottedPage): Promise<void> {
        const pageId = page.getPageId();
        this.cachePage(pageId, page, true);
    }

    /**
     * Write page directly to file (WAL-ahead principle)
     */
    private async writePageDirect(pageId: number, buf: Buffer): Promise<void> {
        // WAL-ahead: write to WAL first
        if (this.wal && this.walEnabled) {
            const lsn = await this.wal.appendPageWrite(pageId, buf);
            this.pageLSN.set(pageId, lsn);
        }

        // Then write to data file
        const offset = this.pageOffset(pageId);
        fs.writeSync(this.fd, buf, 0, PAGE_SIZE, offset);
    }

    /**
     * Cache a page
     */
    private cachePage(pageId: number, page: SlottedPage, dirty: boolean): void {
        const existing = this.cache.get(pageId);
        if (existing) {
            existing.page = page;
            existing.dirty = existing.dirty || dirty;
            existing.lastAccess = Date.now();
        } else {
            // Evict if cache is full
            if (this.cache.size >= this.maxCacheSize) {
                this.evictOne();
            }
            this.cache.set(pageId, {
                page,
                dirty,
                lastAccess: Date.now(),
            });
        }
    }

    /**
     * Evict one page from cache (LRU)
     */
    private evictOne(): void {
        let oldestId = -1;
        let oldestTime = Infinity;

        for (const [id, entry] of this.cache) {
            // Don't evict dirty pages
            if (entry.dirty) continue;
            if (entry.lastAccess < oldestTime) {
                oldestTime = entry.lastAccess;
                oldestId = id;
            }
        }

        if (oldestId >= 0) {
            this.cache.delete(oldestId);
        } else {
            // All pages are dirty, flush and evict oldest
            let oldestDirtyId = -1;
            oldestTime = Infinity;
            for (const [id, entry] of this.cache) {
                if (entry.lastAccess < oldestTime) {
                    oldestTime = entry.lastAccess;
                    oldestDirtyId = id;
                }
            }
            if (oldestDirtyId >= 0) {
                const entry = this.cache.get(oldestDirtyId)!;
                this.writePageDirect(oldestDirtyId, entry.page.toBuffer());
                this.cache.delete(oldestDirtyId);
            }
        }
    }

    /**
     * Flush all dirty pages and header to disk
     */
    async flush(): Promise<void> {
        // Write dirty pages
        for (const [pageId, entry] of this.cache) {
            if (entry.dirty) {
                await this.writePageDirect(pageId, entry.page.toBuffer());
                entry.dirty = false;
            }
        }

        // Write commit record to WAL
        if (this.wal && this.walEnabled) {
            await this.wal.appendCommit();
        }

        // Write header
        fs.writeSync(this.fd, this.header.toBuffer(), 0, FILE_HEADER_SIZE, 0);

        // Sync to disk
        fs.fsyncSync(this.fd);
    }

    /**
     * Sync to disk without flushing cache
     */
    async sync(): Promise<void> {
        await this.flush();
    }

    /**
     * Create a checkpoint (aligned with Go version)
     */
    async checkpoint(): Promise<void> {
        await this.flush();

        if (this.wal && this.walEnabled) {
            await this.wal.appendCheckpoint();
            fs.writeSync(this.fd, this.header.toBuffer(), 0, FILE_HEADER_SIZE, 0);
            fs.fsyncSync(this.fd);
            await this.wal.truncate();
        }
    }

    /**
     * Get header for direct access
     */
    getHeader(): FileHeader {
        return this.header;
    }

    /**
     * Get WAL size (for monitoring)
     */
    getWALSize(): number {
        return this.wal?.getSize() ?? 0;
    }

    /**
     * Check if WAL is enabled
     */
    isWALEnabled(): boolean {
        return this.walEnabled && this.wal !== null;
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { size: number; maxSize: number; dirtyCount: number } {
        let dirtyCount = 0;
        for (const entry of this.cache.values()) {
            if (entry.dirty) dirtyCount++;
        }
        return {
            size: this.cache.size,
            maxSize: this.maxCacheSize,
            dirtyCount,
        };
    }

    // Legacy getters/setters
    getWalLSN(): bigint {
        return BigInt(0);
    }

    setWalLSN(_lsn: bigint): void {
        // No-op
    }
}
