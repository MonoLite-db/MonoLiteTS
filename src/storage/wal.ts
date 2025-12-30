// Created by Yanjunhui

import * as fs from 'fs';
import * as path from 'path';
import { PAGE_SIZE, WAL_MAGIC, WAL_HEADER_SIZE, WAL_RECORD_HEADER_SIZE, PageType } from './constants';
import { DataEndian } from './dataEndian';

/**
 * WAL record types (aligned with Go version)
 */
export enum WALRecordType {
    PageWrite = 1,     // Page content write
    AllocPage = 2,     // Page allocation
    FreePage = 3,      // Page free
    Commit = 4,        // Transaction commit
    Checkpoint = 5,    // Checkpoint marker
    MetaUpdate = 6,    // Metadata update (FileHeader fields)
}

/**
 * Metadata update types (aligned with Go version)
 */
export enum MetaUpdateType {
    FreeListHead = 1,
    PageCount = 2,
    CatalogPageId = 3,
}

/**
 * WAL header structure (32 bytes, aligned with Go)
 */
interface WALHeader {
    magic: number;          // 4 bytes
    version: number;        // 2 bytes
    reserved1: number;      // 2 bytes
    checkpointLSN: bigint;  // 8 bytes
    fileSize: bigint;       // 8 bytes
    checksum: number;       // 4 bytes
    reserved2: number;      // 4 bytes
}

/**
 * WAL record structure
 */
export interface WALRecord {
    lsn: bigint;
    type: WALRecordType;
    flags: number;
    dataLen: number;
    pageId: number;
    checksum: number;
    data: Buffer;
}

/**
 * CRC32 implementation (aligned with Go)
 */
function crc32(data: Buffer): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 1) {
                crc = (crc >>> 1) ^ 0xEDB88320;
            } else {
                crc = crc >>> 1;
            }
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Write-Ahead Log implementation (aligned with Go version)
 *
 * File layout:
 * - Header: 32 bytes
 * - Records: variable
 *
 * Record format (20 bytes header + data):
 * - LSN: 8 bytes
 * - Type: 1 byte
 * - Flags: 1 byte
 * - DataLen: 2 bytes
 * - PageId: 4 bytes
 * - Checksum: 4 bytes
 * - Data: variable
 */
export class WAL {
    private filePath: string;
    private fd: number = -1;
    private header: WALHeader;
    private currentLSN: bigint = BigInt(0);
    private writeOffset: bigint = BigInt(WAL_HEADER_SIZE);
    private writeBuffer: Buffer;
    private writePos: number = 0;
    private closed: boolean = false;

    private static readonly BUFFER_SIZE = 64 * 1024; // 64KB write buffer

    private constructor(filePath: string) {
        this.filePath = filePath;
        this.writeBuffer = Buffer.alloc(WAL.BUFFER_SIZE);
        this.header = {
            magic: WAL_MAGIC,
            version: 1,
            reserved1: 0,
            checkpointLSN: BigInt(0),
            fileSize: BigInt(WAL_HEADER_SIZE),
            checksum: 0,
            reserved2: 0,
        };
    }

    /**
     * Open or create WAL file
     */
    static async open(filePath: string): Promise<WAL> {
        const wal = new WAL(filePath);

        const dir = path.dirname(filePath);
        if (dir && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (fs.existsSync(filePath)) {
            wal.fd = fs.openSync(filePath, 'r+');
            await wal.readHeader();
            await wal.scanForMaxLSN();
        } else {
            wal.fd = fs.openSync(filePath, 'w+');
            await wal.initNewWAL();
        }

        return wal;
    }

    /**
     * Initialize new WAL file
     */
    private async initNewWAL(): Promise<void> {
        await this.writeHeader();
    }

    /**
     * Read WAL header
     */
    private async readHeader(): Promise<void> {
        const buf = Buffer.alloc(WAL_HEADER_SIZE);
        fs.readSync(this.fd, buf, 0, WAL_HEADER_SIZE, 0);

        this.header.magic = DataEndian.readUInt32LE(buf, 0);
        if (this.header.magic !== WAL_MAGIC) {
            throw new Error(`Invalid WAL magic: ${this.header.magic.toString(16)}`);
        }

        this.header.version = DataEndian.readUInt16LE(buf, 4);
        this.header.reserved1 = DataEndian.readUInt16LE(buf, 6);
        this.header.checkpointLSN = DataEndian.readUInt64LE(buf, 8);
        this.header.fileSize = DataEndian.readUInt64LE(buf, 16);
        this.header.checksum = DataEndian.readUInt32LE(buf, 24);
        this.header.reserved2 = DataEndian.readUInt32LE(buf, 28);
    }

    /**
     * Write WAL header
     */
    private async writeHeader(): Promise<void> {
        const buf = Buffer.alloc(WAL_HEADER_SIZE);
        DataEndian.writeUInt32LE(buf, 0, this.header.magic);
        DataEndian.writeUInt16LE(buf, 4, this.header.version);
        DataEndian.writeUInt16LE(buf, 6, this.header.reserved1);
        DataEndian.writeUInt64LE(buf, 8, this.header.checkpointLSN);
        DataEndian.writeUInt64LE(buf, 16, this.header.fileSize);

        // Calculate checksum over first 24 bytes
        let checksum = 0;
        for (let i = 0; i < 24; i += 4) {
            checksum ^= DataEndian.readUInt32LE(buf, i);
        }
        this.header.checksum = checksum;
        DataEndian.writeUInt32LE(buf, 24, checksum);
        DataEndian.writeUInt32LE(buf, 28, this.header.reserved2);

        fs.writeSync(this.fd, buf, 0, WAL_HEADER_SIZE, 0);
    }

    /**
     * Scan WAL to find maximum LSN and write offset
     */
    private async scanForMaxLSN(): Promise<void> {
        const stats = fs.fstatSync(this.fd);
        if (stats.size <= WAL_HEADER_SIZE) {
            this.currentLSN = BigInt(0);
            this.writeOffset = BigInt(WAL_HEADER_SIZE);
            return;
        }

        let maxLSN = BigInt(0);
        let offset = WAL_HEADER_SIZE;
        const headerBuf = Buffer.alloc(WAL_RECORD_HEADER_SIZE);

        while (offset < stats.size) {
            try {
                const bytesRead = fs.readSync(this.fd, headerBuf, 0, WAL_RECORD_HEADER_SIZE, offset);
                if (bytesRead < WAL_RECORD_HEADER_SIZE) break;

                const lsn = DataEndian.readUInt64LE(headerBuf, 0);
                const dataLen = DataEndian.readUInt16LE(headerBuf, 10);

                // Verify record integrity
                const fullRecordBuf = Buffer.alloc(WAL_RECORD_HEADER_SIZE + dataLen);
                fs.readSync(this.fd, fullRecordBuf, 0, WAL_RECORD_HEADER_SIZE + dataLen, offset);

                const storedChecksum = DataEndian.readUInt32LE(headerBuf, 16);
                // Zero out checksum field for calculation
                const checkBuf = Buffer.from(fullRecordBuf);
                DataEndian.writeUInt32LE(checkBuf, 16, 0);
                const calcChecksum = crc32(checkBuf);

                if (storedChecksum !== calcChecksum) {
                    // Checksum mismatch, stop at valid end
                    break;
                }

                if (lsn > maxLSN) {
                    maxLSN = lsn;
                }

                // Calculate aligned record size
                const recordSize = WAL_RECORD_HEADER_SIZE + dataLen;
                const alignedSize = Math.ceil(recordSize / 8) * 8;
                offset += alignedSize;
            } catch {
                break;
            }
        }

        this.currentLSN = maxLSN;
        this.writeOffset = BigInt(offset);
    }

    /**
     * Close WAL file
     */
    async close(): Promise<void> {
        if (this.closed) return;

        await this.flush();
        if (this.fd >= 0) {
            fs.closeSync(this.fd);
            this.fd = -1;
        }
        this.closed = true;
    }

    /**
     * Get checkpoint LSN
     */
    getCheckpointLSN(): bigint {
        return this.header.checkpointLSN;
    }

    /**
     * Get current LSN
     */
    getCurrentLSN(): bigint {
        return this.currentLSN;
    }

    /**
     * Append a page write record
     */
    async appendPageWrite(pageId: number, pageData: Buffer): Promise<bigint> {
        this.currentLSN++;
        const record: WALRecord = {
            lsn: this.currentLSN,
            type: WALRecordType.PageWrite,
            flags: 0,
            dataLen: pageData.length,
            pageId,
            checksum: 0,
            data: pageData,
        };
        await this.writeRecord(record);
        return this.currentLSN;
    }

    /**
     * Append a page allocation record
     */
    async appendAllocPage(pageId: number, pageType: PageType): Promise<bigint> {
        this.currentLSN++;
        const record: WALRecord = {
            lsn: this.currentLSN,
            type: WALRecordType.AllocPage,
            flags: 0,
            dataLen: 1,
            pageId,
            checksum: 0,
            data: Buffer.from([pageType]),
        };
        await this.writeRecord(record);
        return this.currentLSN;
    }

    /**
     * Append a page free record
     */
    async appendFreePage(pageId: number): Promise<bigint> {
        this.currentLSN++;
        const record: WALRecord = {
            lsn: this.currentLSN,
            type: WALRecordType.FreePage,
            flags: 0,
            dataLen: 0,
            pageId,
            checksum: 0,
            data: Buffer.alloc(0),
        };
        await this.writeRecord(record);
        return this.currentLSN;
    }

    /**
     * Append a metadata update record
     */
    async appendMetaUpdate(metaType: MetaUpdateType, oldValue: number, newValue: number): Promise<bigint> {
        this.currentLSN++;
        const data = Buffer.alloc(9);
        data[0] = metaType;
        DataEndian.writeUInt32LE(data, 1, oldValue);
        DataEndian.writeUInt32LE(data, 5, newValue);

        const record: WALRecord = {
            lsn: this.currentLSN,
            type: WALRecordType.MetaUpdate,
            flags: 0,
            dataLen: 9,
            pageId: 0,
            checksum: 0,
            data,
        };
        await this.writeRecord(record);
        return this.currentLSN;
    }

    /**
     * Append a commit record
     */
    async appendCommit(): Promise<bigint> {
        this.currentLSN++;
        const record: WALRecord = {
            lsn: this.currentLSN,
            type: WALRecordType.Commit,
            flags: 0,
            dataLen: 0,
            pageId: 0,
            checksum: 0,
            data: Buffer.alloc(0),
        };
        await this.writeRecord(record);
        await this.flush();
        return this.currentLSN;
    }

    /**
     * Append a checkpoint record
     */
    async appendCheckpoint(): Promise<bigint> {
        this.currentLSN++;
        const data = Buffer.alloc(8);
        DataEndian.writeUInt64LE(data, 0, this.currentLSN);

        const record: WALRecord = {
            lsn: this.currentLSN,
            type: WALRecordType.Checkpoint,
            flags: 0,
            dataLen: 8,
            pageId: 0,
            checksum: 0,
            data,
        };
        await this.writeRecord(record);
        await this.flush();

        // Update header checkpointLSN
        this.header.checkpointLSN = this.currentLSN;
        await this.writeHeader();

        return this.currentLSN;
    }

    /**
     * Write a record
     */
    private async writeRecord(record: WALRecord): Promise<void> {
        const buf = this.serializeRecord(record);
        const alignedSize = Math.ceil(buf.length / 8) * 8;
        const alignedBuf = Buffer.alloc(alignedSize);
        buf.copy(alignedBuf);

        // Flush if buffer is full
        if (this.writePos + alignedSize > WAL.BUFFER_SIZE) {
            await this.flush();
        }

        // Write large records directly
        if (alignedSize > WAL.BUFFER_SIZE) {
            fs.writeSync(this.fd, alignedBuf, 0, alignedSize, Number(this.writeOffset));
            this.writeOffset += BigInt(alignedSize);
            return;
        }

        // Write to buffer
        alignedBuf.copy(this.writeBuffer, this.writePos);
        this.writePos += alignedSize;
    }

    /**
     * Serialize a record
     */
    private serializeRecord(record: WALRecord): Buffer {
        const buf = Buffer.alloc(WAL_RECORD_HEADER_SIZE + record.data.length);

        // Header
        DataEndian.writeUInt64LE(buf, 0, record.lsn);
        buf[8] = record.type;
        buf[9] = record.flags;
        DataEndian.writeUInt16LE(buf, 10, record.dataLen);
        DataEndian.writeUInt32LE(buf, 12, record.pageId);
        // Checksum at offset 16, filled below

        // Data
        record.data.copy(buf, WAL_RECORD_HEADER_SIZE);

        // Calculate checksum
        DataEndian.writeUInt32LE(buf, 16, 0);
        const checksum = crc32(buf);
        DataEndian.writeUInt32LE(buf, 16, checksum);

        return buf;
    }

    /**
     * Flush write buffer to disk
     */
    async flush(): Promise<void> {
        if (this.writePos > 0) {
            fs.writeSync(this.fd, this.writeBuffer, 0, this.writePos, Number(this.writeOffset));
            this.writeOffset += BigInt(this.writePos);
            this.writePos = 0;
            fs.fsyncSync(this.fd);
        }
    }

    /**
     * Sync WAL to disk
     */
    async sync(): Promise<void> {
        await this.flush();
    }

    /**
     * Read all records from WAL (for recovery)
     */
    async readAll(): Promise<WALRecord[]> {
        const records: WALRecord[] = [];
        const stats = fs.fstatSync(this.fd);
        if (stats.size <= WAL_HEADER_SIZE) {
            return records;
        }

        let offset = WAL_HEADER_SIZE;
        const headerBuf = Buffer.alloc(WAL_RECORD_HEADER_SIZE);

        while (offset < stats.size) {
            try {
                const bytesRead = fs.readSync(this.fd, headerBuf, 0, WAL_RECORD_HEADER_SIZE, offset);
                if (bytesRead < WAL_RECORD_HEADER_SIZE) break;

                const lsn = DataEndian.readUInt64LE(headerBuf, 0);
                const type = headerBuf[8] as WALRecordType;
                const flags = headerBuf[9];
                const dataLen = DataEndian.readUInt16LE(headerBuf, 10);
                const pageId = DataEndian.readUInt32LE(headerBuf, 12);
                const checksum = DataEndian.readUInt32LE(headerBuf, 16);

                // Read data
                const dataBuf = Buffer.alloc(dataLen);
                if (dataLen > 0) {
                    fs.readSync(this.fd, dataBuf, 0, dataLen, offset + WAL_RECORD_HEADER_SIZE);
                }

                // Verify checksum
                const fullBuf = Buffer.alloc(WAL_RECORD_HEADER_SIZE + dataLen);
                headerBuf.copy(fullBuf, 0);
                dataBuf.copy(fullBuf, WAL_RECORD_HEADER_SIZE);
                DataEndian.writeUInt32LE(fullBuf, 16, 0);
                const calcChecksum = crc32(fullBuf);

                if (checksum !== calcChecksum) {
                    break;
                }

                records.push({
                    lsn,
                    type,
                    flags,
                    dataLen,
                    pageId,
                    checksum,
                    data: dataBuf,
                });

                // Calculate aligned record size
                const recordSize = WAL_RECORD_HEADER_SIZE + dataLen;
                const alignedSize = Math.ceil(recordSize / 8) * 8;
                offset += alignedSize;
            } catch {
                break;
            }
        }

        return records;
    }

    /**
     * Read records after a given LSN (for recovery)
     */
    async readAfter(afterLSN: bigint): Promise<WALRecord[]> {
        const allRecords = await this.readAll();
        return allRecords.filter(r => r.lsn > afterLSN);
    }

    /**
     * Truncate WAL (after checkpoint)
     */
    async truncate(): Promise<void> {
        await this.flush();
        fs.ftruncateSync(this.fd, WAL_HEADER_SIZE);
        this.writeOffset = BigInt(WAL_HEADER_SIZE);
        this.header.fileSize = BigInt(WAL_HEADER_SIZE);
        await this.writeHeader();
    }

    /**
     * Get WAL file size
     */
    getSize(): number {
        const stats = fs.fstatSync(this.fd);
        return stats.size + this.writePos;
    }
}
