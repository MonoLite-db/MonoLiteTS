// Created by Yanjunhui

/**
 * 数据字节序工具类，用于读写二进制数据（小端序，与 Go 对齐）
 * EN: Data endian utilities for reading/writing binary data (little-endian, aligned with Go)
 */

export class DataEndian {
    /**
     * 从缓冲区读取 uint8
     * EN: Read uint8 from buffer
     */
    static readUInt8(buf: Buffer, offset: number): number {
        return buf.readUInt8(offset);
    }

    /**
     * 向缓冲区写入 uint8
     * EN: Write uint8 to buffer
     */
    static writeUInt8(buf: Buffer, offset: number, value: number): void {
        buf.writeUInt8(value, offset);
    }

    /**
     * 从缓冲区读取 int8
     * EN: Read int8 from buffer
     */
    static readInt8(buf: Buffer, offset: number): number {
        return buf.readInt8(offset);
    }

    /**
     * 向缓冲区写入 int8
     * EN: Write int8 to buffer
     */
    static writeInt8(buf: Buffer, offset: number, value: number): void {
        buf.writeInt8(value, offset);
    }

    /**
     * 从缓冲区读取小端序 uint16
     * EN: Read uint16 little-endian from buffer
     */
    static readUInt16LE(buf: Buffer, offset: number): number {
        return buf.readUInt16LE(offset);
    }

    /**
     * 向缓冲区写入小端序 uint16
     * EN: Write uint16 little-endian to buffer
     */
    static writeUInt16LE(buf: Buffer, offset: number, value: number): void {
        buf.writeUInt16LE(value, offset);
    }

    /**
     * 从缓冲区读取小端序 int16
     * EN: Read int16 little-endian from buffer
     */
    static readInt16LE(buf: Buffer, offset: number): number {
        return buf.readInt16LE(offset);
    }

    /**
     * 向缓冲区写入小端序 int16
     * EN: Write int16 little-endian to buffer
     */
    static writeInt16LE(buf: Buffer, offset: number, value: number): void {
        buf.writeInt16LE(value, offset);
    }

    /**
     * 从缓冲区读取小端序 uint32
     * EN: Read uint32 little-endian from buffer
     */
    static readUInt32LE(buf: Buffer, offset: number): number {
        return buf.readUInt32LE(offset);
    }

    /**
     * 向缓冲区写入小端序 uint32
     * EN: Write uint32 little-endian to buffer
     */
    static writeUInt32LE(buf: Buffer, offset: number, value: number): void {
        buf.writeUInt32LE(value, offset);
    }

    /**
     * 从缓冲区读取小端序 int32
     * EN: Read int32 little-endian from buffer
     */
    static readInt32LE(buf: Buffer, offset: number): number {
        return buf.readInt32LE(offset);
    }

    /**
     * 向缓冲区写入小端序 int32
     * EN: Write int32 little-endian to buffer
     */
    static writeInt32LE(buf: Buffer, offset: number, value: number): void {
        buf.writeInt32LE(value, offset);
    }

    /**
     * 从缓冲区读取小端序 uint64（返回 bigint）
     * EN: Read uint64 little-endian from buffer (as bigint)
     */
    static readUInt64LE(buf: Buffer, offset: number): bigint {
        return buf.readBigUInt64LE(offset);
    }

    /**
     * 向缓冲区写入小端序 uint64
     * EN: Write uint64 little-endian to buffer
     */
    static writeUInt64LE(buf: Buffer, offset: number, value: bigint): void {
        buf.writeBigUInt64LE(value, offset);
    }

    /**
     * 从缓冲区读取小端序 int64（返回 bigint）
     * EN: Read int64 little-endian from buffer (as bigint)
     */
    static readInt64LE(buf: Buffer, offset: number): bigint {
        return buf.readBigInt64LE(offset);
    }

    /**
     * 向缓冲区写入小端序 int64
     * EN: Write int64 little-endian to buffer
     */
    static writeInt64LE(buf: Buffer, offset: number, value: bigint): void {
        buf.writeBigInt64LE(value, offset);
    }

    /**
     * 从缓冲区读取小端序 double
     * EN: Read double little-endian from buffer
     */
    static readDoubleLE(buf: Buffer, offset: number): number {
        return buf.readDoubleLE(offset);
    }

    /**
     * 向缓冲区写入小端序 double
     * EN: Write double little-endian to buffer
     */
    static writeDoubleLE(buf: Buffer, offset: number, value: number): void {
        buf.writeDoubleLE(value, offset);
    }

    /**
     * 从缓冲区读取 C 字符串（以 null 结尾）
     * EN: Read C-string (null-terminated) from buffer
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
     * 向缓冲区写入 C 字符串（以 null 结尾）
     * EN: Write C-string (null-terminated) to buffer
     */
    static writeCString(buf: Buffer, offset: number, value: string): number {
        const written = buf.write(value, offset, 'utf8');
        buf[offset + written] = 0;
        return written + 1;
    }
}
