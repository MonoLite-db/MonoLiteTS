// Created by Yanjunhui

import { DataEndian } from './dataEndian';

/**
 * BSON 类型排序顺序（MongoDB 规范）
 * // EN: BSON type order for comparison (MongoDB spec)
 */
export enum BSONTypeOrder {
    MinKey = 0,
    Undefined = 1,
    Null = 2,
    NumberDouble = 3,
    NumberInt = 3,
    NumberLong = 3,
    NumberDecimal = 3,
    String = 4,
    Symbol = 5,
    Object = 6,
    Array = 7,
    BinaryData = 8,
    ObjectId = 9,
    Boolean = 10,
    Date = 11,
    Timestamp = 12,
    RegExp = 13,
    MaxKey = 14,
}

/**
 * KeyString 编码器（与 Go/Swift 版本对齐）
 * // EN: KeyString encoder (aligned with Go/Swift versions)
 *
 * 将 BSON 值编码为保持排序顺序的二进制格式。
 * 这允许使用标准的字典序比较进行索引查找。
 * // EN: Encodes BSON values into a binary format that preserves sort order.
 * // EN: This allows using standard lexicographic comparison for index lookups.
 *
 * 格式 // EN: Format:
 * - 类型标识符（1 字节）// EN: Type discriminator (1 byte)
 * - 编码值（可变）// EN: Encoded value (variable)
 * - 方向标记（用于降序索引）// EN: Direction marker (for descending indexes)
 */
export class KeyString {
    /** 编码缓冲区 // EN: Encoding buffer */
    private buffer: number[] = [];
    /** 升序标志 // EN: Ascending flag */
    private ascending: boolean = true;

    constructor(ascending: boolean = true) {
        this.ascending = ascending;
    }

    /**
     * 编码值并追加到缓冲区
     * // EN: Encode a value and append to buffer
     */
    appendValue(value: any): KeyString {
        if (value === null || value === undefined) {
            this.appendNull();
        } else if (typeof value === 'boolean') {
            this.appendBoolean(value);
        } else if (typeof value === 'number') {
            this.appendNumber(value);
        } else if (typeof value === 'bigint') {
            this.appendBigInt(value);
        } else if (typeof value === 'string') {
            this.appendString(value);
        } else if (Buffer.isBuffer(value)) {
            this.appendBinary(value);
        } else if (value instanceof Date) {
            this.appendDate(value);
        } else if (Array.isArray(value)) {
            this.appendArray(value);
        } else if (typeof value === 'object') {
            if (value._bsontype === 'ObjectId' || value.$oid) {
                this.appendObjectId(value);
            } else if (value._bsontype === 'MinKey') {
                this.appendMinKey();
            } else if (value._bsontype === 'MaxKey') {
                this.appendMaxKey();
            } else if (value._bsontype === 'Timestamp') {
                this.appendTimestamp(value);
            } else if (value._bsontype === 'Decimal128') {
                this.appendDecimal128(value);
            } else if (value.$regex !== undefined) {
                this.appendRegex(value);
            } else {
                this.appendObject(value);
            }
        }
        return this;
    }

    /**
     * 获取编码后的缓冲区
     * // EN: Get encoded buffer
     */
    toBuffer(): Buffer {
        if (this.ascending) {
            return Buffer.from(this.buffer);
        }
        // 降序时，反转所有字节 // EN: For descending, invert all bytes
        const inverted = this.buffer.map(b => 0xFF - b);
        return Buffer.from(inverted);
    }

    /**
     * 追加类型标识符
     * // EN: Append type discriminator
     */
    private appendType(type: BSONTypeOrder): void {
        this.buffer.push(type);
    }

    /**
     * 追加空值
     * // EN: Append null value
     */
    private appendNull(): void {
        this.appendType(BSONTypeOrder.Null);
    }

    /**
     * 追加 MinKey
     * // EN: Append MinKey
     */
    private appendMinKey(): void {
        this.appendType(BSONTypeOrder.MinKey);
    }

    /**
     * 追加 MaxKey
     * // EN: Append MaxKey
     */
    private appendMaxKey(): void {
        this.appendType(BSONTypeOrder.MaxKey);
    }

    /**
     * 追加布尔值
     * // EN: Append boolean value
     */
    private appendBoolean(value: boolean): void {
        this.appendType(BSONTypeOrder.Boolean);
        this.buffer.push(value ? 1 : 0);
    }

    /**
     * 追加数字值（IEEE 754 双精度）
     * // EN: Append number value (IEEE 754 double)
     */
    private appendNumber(value: number): void {
        this.appendType(BSONTypeOrder.NumberDouble);

        // 以可排序的方式编码 double // EN: Encode double in a sortable way
        const buf = Buffer.alloc(8);
        buf.writeDoubleBE(value, 0);

        // 排序变换: // EN: Transform for sorting:
        // - 如果是正数（MSB = 0）：翻转 MSB 为 1
        //   EN: If positive (MSB = 0): flip MSB to 1
        // - 如果是负数（MSB = 1）：翻转所有位
        //   EN: If negative (MSB = 1): flip all bits
        if (buf[0] & 0x80) {
            // 负数：翻转所有位 // EN: Negative: flip all bits
            for (let i = 0; i < 8; i++) {
                buf[i] = ~buf[i] & 0xFF;
            }
        } else {
            // 正数或零：翻转 MSB // EN: Positive or zero: flip MSB
            buf[0] ^= 0x80;
        }

        for (const b of buf) {
            this.buffer.push(b);
        }
    }

    /**
     * 追加 bigint 值
     * // EN: Append bigint value
     */
    private appendBigInt(value: bigint): void {
        this.appendType(BSONTypeOrder.NumberLong);

        // 转换为可排序的表示 // EN: Convert to sortable representation
        const buf = Buffer.alloc(8);
        buf.writeBigInt64BE(value, 0);

        // 翻转符号位以便排序 // EN: Flip sign bit for sorting
        buf[0] ^= 0x80;

        for (const b of buf) {
            this.buffer.push(b);
        }
    }

    /**
     * 追加字符串值
     * // EN: Append string value
     */
    private appendString(value: string): void {
        this.appendType(BSONTypeOrder.String);

        // 编码 UTF-8 并处理空字节 // EN: Encode UTF-8 with null byte handling
        const encoded = Buffer.from(value, 'utf8');
        for (const b of encoded) {
            if (b === 0) {
                // 转义空字节: 0x00 -> 0x00 0xFF
                // EN: Escape null bytes: 0x00 -> 0x00 0xFF
                this.buffer.push(0x00, 0xFF);
            } else {
                this.buffer.push(b);
            }
        }
        // 以 0x00 0x00 结尾 // EN: Terminate with 0x00 0x00
        this.buffer.push(0x00, 0x00);
    }

    /**
     * 追加二进制数据
     * // EN: Append binary data
     */
    private appendBinary(value: Buffer): void {
        this.appendType(BSONTypeOrder.BinaryData);

        // 长度前缀（4 字节大端序）// EN: Length prefix (4 bytes big-endian)
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(value.length, 0);
        for (const b of lenBuf) {
            this.buffer.push(b);
        }

        // 子类型（默认通用）// EN: Subtype (default generic)
        this.buffer.push(0);

        // 数据 // EN: Data
        for (const b of value) {
            this.buffer.push(b);
        }
    }

    /**
     * 追加 ObjectId
     * // EN: Append ObjectId
     */
    private appendObjectId(value: any): void {
        this.appendType(BSONTypeOrder.ObjectId);

        let bytes: Buffer;
        if (typeof value.toHexString === 'function') {
            bytes = Buffer.from(value.toHexString(), 'hex');
        } else if (value.$oid) {
            bytes = Buffer.from(value.$oid, 'hex');
        } else if (typeof value.id === 'string') {
            bytes = Buffer.from(value.id, 'hex');
        } else {
            bytes = Buffer.alloc(12);
        }

        for (const b of bytes) {
            this.buffer.push(b);
        }
    }

    /**
     * 追加日期
     * // EN: Append Date
     */
    private appendDate(value: Date): void {
        this.appendType(BSONTypeOrder.Date);

        const ms = BigInt(value.getTime());
        const buf = Buffer.alloc(8);
        buf.writeBigInt64BE(ms, 0);
        buf[0] ^= 0x80; // 翻转符号位 // EN: Flip sign bit

        for (const b of buf) {
            this.buffer.push(b);
        }
    }

    /**
     * 追加时间戳
     * // EN: Append Timestamp
     */
    private appendTimestamp(value: any): void {
        this.appendType(BSONTypeOrder.Timestamp);

        const t = value.t || value.timestamp || 0;
        const i = value.i || value.increment || 0;

        // 时间戳为 8 字节: t (4 字节) + i (4 字节)
        // EN: Timestamp is 8 bytes: t (4 bytes) + i (4 bytes)
        const buf = Buffer.alloc(8);
        buf.writeUInt32BE(t, 0);
        buf.writeUInt32BE(i, 4);

        for (const b of buf) {
            this.buffer.push(b);
        }
    }

    /**
     * 追加正则表达式
     * // EN: Append Regex
     */
    private appendRegex(value: any): void {
        this.appendType(BSONTypeOrder.RegExp);

        const pattern = value.$regex || value.pattern || '';
        const options = value.$options || value.options || '';

        // 模式作为 C 字符串 // EN: Pattern as cstring
        this.appendCString(pattern);
        // 选项作为 C 字符串 // EN: Options as cstring
        this.appendCString(options);
    }

    /**
     * 追加 C 字符串
     * // EN: Append C-string
     */
    private appendCString(value: string): void {
        const encoded = Buffer.from(value, 'utf8');
        for (const b of encoded) {
            this.buffer.push(b);
        }
        this.buffer.push(0);
    }

    /**
     * 追加数组
     * // EN: Append array
     */
    private appendArray(value: any[]): void {
        this.appendType(BSONTypeOrder.Array);

        for (const item of value) {
            this.appendValue(item);
        }
        // 结束数组 // EN: Terminate array
        this.buffer.push(0);
    }

    /**
     * 追加对象/文档
     * // EN: Append object/document
     */
    private appendObject(value: any): void {
        this.appendType(BSONTypeOrder.Object);

        const keys = Object.keys(value).sort();
        for (const key of keys) {
            this.appendCString(key);
            this.appendValue(value[key]);
        }
        // 结束对象 // EN: Terminate object
        this.buffer.push(0);
    }

    /**
     * 追加 Decimal128
     * // EN: Append Decimal128
     */
    private appendDecimal128(value: any): void {
        this.appendType(BSONTypeOrder.NumberDecimal);

        // 转换为字符串然后转为 double 进行简单比较
        // 完整的 Decimal128 支持需要更复杂的编码
        // EN: Convert to string and then to double for simple comparison
        // EN: Full Decimal128 support would require more complex encoding
        let numVal = 0;
        if (typeof value.toString === 'function') {
            numVal = parseFloat(value.toString());
        } else if (value.$numberDecimal) {
            numVal = parseFloat(value.$numberDecimal);
        }

        // 使用 double 编码 // EN: Use double encoding
        const buf = Buffer.alloc(8);
        buf.writeDoubleBE(numVal, 0);

        if (buf[0] & 0x80) {
            for (let i = 0; i < 8; i++) {
                buf[i] = ~buf[i] & 0xFF;
            }
        } else {
            buf[0] ^= 0x80;
        }

        for (const b of buf) {
            this.buffer.push(b);
        }
    }

    /**
     * 从多个值创建 KeyString（复合键）
     * // EN: Create KeyString from multiple values (compound key)
     */
    static fromValues(values: any[], directions?: boolean[]): Buffer {
        const ks = new KeyString(true);

        for (let i = 0; i < values.length; i++) {
            const ascending = directions ? directions[i] : true;
            if (!ascending) {
                // For descending, we need to handle each component separately
                const componentKs = new KeyString(false);
                componentKs.appendValue(values[i]);
                const componentBuf = componentKs.toBuffer();
                for (const b of componentBuf) {
                    ks.buffer.push(b);
                }
            } else {
                ks.appendValue(values[i]);
            }
        }

        return ks.toBuffer();
    }

    /**
     * 比较两个 KeyString 缓冲区
     * // EN: Compare two KeyString buffers
     */
    static compare(a: Buffer, b: Buffer): number {
        return Buffer.compare(a, b);
    }
}
