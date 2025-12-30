// Created by Yanjunhui

import { FILE_MAGIC, FILE_VERSION, PAGE_SIZE, FILE_HEADER_SIZE, INVALID_PAGE_ID } from './constants';
import { DataEndian } from './dataEndian';

/**
 * Database file header (64 bytes, aligned with Go version)
 *
 * Layout:
 * - magic: 4 bytes (offset 0) - "MONO" = 0x4D4F4E4F
 * - version: 2 bytes (offset 4)
 * - pageSize: 2 bytes (offset 6)
 * - pageCount: 4 bytes (offset 8)
 * - freeListHead: 4 bytes (offset 12)
 * - metaPageId: 4 bytes (offset 16)
 * - catalogPageId: 4 bytes (offset 20)
 * - createTime: 8 bytes (offset 24) - Unix milliseconds
 * - modifyTime: 8 bytes (offset 32) - Unix milliseconds
 * - reserved: 24 bytes (offset 40-63)
 */
export class FileHeader {
    private data: Buffer;

    constructor(data?: Buffer) {
        if (data) {
            // Accept both 64-byte header and full page
            if (data.length === FILE_HEADER_SIZE) {
                this.data = data;
            } else if (data.length === PAGE_SIZE) {
                // Extract header from full page (for backward compatibility)
                this.data = Buffer.alloc(FILE_HEADER_SIZE);
                data.copy(this.data, 0, 0, FILE_HEADER_SIZE);
            } else {
                throw new Error(`Invalid header size: ${data.length}, expected ${FILE_HEADER_SIZE}`);
            }
        } else {
            this.data = Buffer.alloc(FILE_HEADER_SIZE);
        }
    }

    /**
     * Create a new file header
     */
    static create(): FileHeader {
        const header = new FileHeader();
        const now = Date.now();
        header.setMagic(FILE_MAGIC);
        header.setVersion(FILE_VERSION);
        header.setPageSize(PAGE_SIZE);
        header.setPageCount(1); // At least one meta page
        header.setFreeListHead(INVALID_PAGE_ID);
        header.setMetaPageId(INVALID_PAGE_ID);
        header.setCatalogPageId(INVALID_PAGE_ID);
        header.setCreateTime(BigInt(now));
        header.setModifyTime(BigInt(now));
        return header;
    }

    /**
     * Parse header from buffer
     */
    static fromBuffer(buf: Buffer): FileHeader {
        const header = new FileHeader(Buffer.from(buf));
        if (!header.verify()) {
            throw new Error('Invalid file header: magic mismatch');
        }
        return header;
    }

    /**
     * Get raw buffer (64 bytes)
     */
    toBuffer(): Buffer {
        return this.data;
    }

    /**
     * Get a copy of raw buffer
     */
    toBufferCopy(): Buffer {
        return Buffer.from(this.data);
    }

    // Field accessors (aligned with Go version)
    getMagic(): number {
        return DataEndian.readUInt32LE(this.data, 0);
    }

    setMagic(magic: number): void {
        DataEndian.writeUInt32LE(this.data, 0, magic);
    }

    getVersion(): number {
        return DataEndian.readUInt16LE(this.data, 4);
    }

    setVersion(version: number): void {
        DataEndian.writeUInt16LE(this.data, 4, version);
    }

    getPageSize(): number {
        return DataEndian.readUInt16LE(this.data, 6);
    }

    setPageSize(size: number): void {
        DataEndian.writeUInt16LE(this.data, 6, size);
    }

    getPageCount(): number {
        return DataEndian.readUInt32LE(this.data, 8);
    }

    setPageCount(count: number): void {
        DataEndian.writeUInt32LE(this.data, 8, count);
    }

    getFreeListHead(): number {
        return DataEndian.readUInt32LE(this.data, 12);
    }

    setFreeListHead(pageId: number): void {
        DataEndian.writeUInt32LE(this.data, 12, pageId);
    }

    getMetaPageId(): number {
        return DataEndian.readUInt32LE(this.data, 16);
    }

    setMetaPageId(pageId: number): void {
        DataEndian.writeUInt32LE(this.data, 16, pageId);
    }

    getCatalogPageId(): number {
        return DataEndian.readUInt32LE(this.data, 20);
    }

    setCatalogPageId(pageId: number): void {
        DataEndian.writeUInt32LE(this.data, 20, pageId);
    }

    getCreateTime(): bigint {
        return DataEndian.readUInt64LE(this.data, 24);
    }

    setCreateTime(time: bigint): void {
        DataEndian.writeUInt64LE(this.data, 24, time);
    }

    getModifyTime(): bigint {
        return DataEndian.readUInt64LE(this.data, 32);
    }

    setModifyTime(time: bigint): void {
        DataEndian.writeUInt64LE(this.data, 32, time);
    }

    /**
     * Update modify time to current time
     */
    touch(): void {
        this.setModifyTime(BigInt(Date.now()));
    }

    /**
     * Verify header validity
     */
    verify(): boolean {
        if (this.getMagic() !== FILE_MAGIC) {
            return false;
        }
        if (this.getVersion() !== FILE_VERSION) {
            return false;
        }
        if (this.getPageSize() !== PAGE_SIZE) {
            return false;
        }
        return true;
    }

    // Legacy getters for backward compatibility
    getRootPageId(): number {
        return this.getCatalogPageId();
    }

    setRootPageId(pageId: number): void {
        this.setCatalogPageId(pageId);
    }

    getWalLSN(): bigint {
        // WAL LSN is now managed by WAL, return 0 for compatibility
        return BigInt(0);
    }

    setWalLSN(_lsn: bigint): void {
        // No-op for backward compatibility
    }
}
