// Created by Yanjunhui

/**
 * Data endian utilities for reading/writing binary data (little-endian, aligned with Go)
 */

export class DataEndian {
    /**
     * Read uint8 from buffer
     */
    static readUInt8(buf: Buffer, offset: number): number {
        return buf.readUInt8(offset);
    }

    /**
     * Write uint8 to buffer
     */
    static writeUInt8(buf: Buffer, offset: number, value: number): void {
        buf.writeUInt8(value, offset);
    }

    /**
     * Read int8 from buffer
     */
    static readInt8(buf: Buffer, offset: number): number {
        return buf.readInt8(offset);
    }

    /**
     * Write int8 to buffer
     */
    static writeInt8(buf: Buffer, offset: number, value: number): void {
        buf.writeInt8(value, offset);
    }

    /**
     * Read uint16 little-endian from buffer
     */
    static readUInt16LE(buf: Buffer, offset: number): number {
        return buf.readUInt16LE(offset);
    }

    /**
     * Write uint16 little-endian to buffer
     */
    static writeUInt16LE(buf: Buffer, offset: number, value: number): void {
        buf.writeUInt16LE(value, offset);
    }

    /**
     * Read int16 little-endian from buffer
     */
    static readInt16LE(buf: Buffer, offset: number): number {
        return buf.readInt16LE(offset);
    }

    /**
     * Write int16 little-endian to buffer
     */
    static writeInt16LE(buf: Buffer, offset: number, value: number): void {
        buf.writeInt16LE(value, offset);
    }

    /**
     * Read uint32 little-endian from buffer
     */
    static readUInt32LE(buf: Buffer, offset: number): number {
        return buf.readUInt32LE(offset);
    }

    /**
     * Write uint32 little-endian to buffer
     */
    static writeUInt32LE(buf: Buffer, offset: number, value: number): void {
        buf.writeUInt32LE(value, offset);
    }

    /**
     * Read int32 little-endian from buffer
     */
    static readInt32LE(buf: Buffer, offset: number): number {
        return buf.readInt32LE(offset);
    }

    /**
     * Write int32 little-endian to buffer
     */
    static writeInt32LE(buf: Buffer, offset: number, value: number): void {
        buf.writeInt32LE(value, offset);
    }

    /**
     * Read uint64 little-endian from buffer (as bigint)
     */
    static readUInt64LE(buf: Buffer, offset: number): bigint {
        return buf.readBigUInt64LE(offset);
    }

    /**
     * Write uint64 little-endian to buffer
     */
    static writeUInt64LE(buf: Buffer, offset: number, value: bigint): void {
        buf.writeBigUInt64LE(value, offset);
    }

    /**
     * Read int64 little-endian from buffer (as bigint)
     */
    static readInt64LE(buf: Buffer, offset: number): bigint {
        return buf.readBigInt64LE(offset);
    }

    /**
     * Write int64 little-endian to buffer
     */
    static writeInt64LE(buf: Buffer, offset: number, value: bigint): void {
        buf.writeBigInt64LE(value, offset);
    }

    /**
     * Read double little-endian from buffer
     */
    static readDoubleLE(buf: Buffer, offset: number): number {
        return buf.readDoubleLE(offset);
    }

    /**
     * Write double little-endian to buffer
     */
    static writeDoubleLE(buf: Buffer, offset: number, value: number): void {
        buf.writeDoubleLE(value, offset);
    }

    /**
     * Read C-string (null-terminated) from buffer
     */
    static readCString(buf: Buffer, offset: number): { value: string; bytesRead: number } {
        let end = offset;
        while (end < buf.length && buf[end] !== 0) {
            end++;
        }
        const value = buf.toString('utf8', offset, end);
        return { value, bytesRead: end - offset + 1 };
    }

    /**
     * Write C-string (null-terminated) to buffer
     */
    static writeCString(buf: Buffer, offset: number, value: string): number {
        const written = buf.write(value, offset, 'utf8');
        buf[offset + written] = 0;
        return written + 1;
    }
}
