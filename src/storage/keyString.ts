// Created by Yanjunhui

import { DataEndian } from './dataEndian';

/**
 * BSON type order for comparison (MongoDB spec)
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
 * KeyString encoder (aligned with Go/Swift versions)
 *
 * Encodes BSON values into a binary format that preserves sort order.
 * This allows using standard lexicographic comparison for index lookups.
 *
 * Format:
 * - Type discriminator (1 byte)
 * - Encoded value (variable)
 * - Direction marker (for descending indexes)
 */
export class KeyString {
    private buffer: number[] = [];
    private ascending: boolean = true;

    constructor(ascending: boolean = true) {
        this.ascending = ascending;
    }

    /**
     * Encode a value and append to buffer
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
     * Get encoded buffer
     */
    toBuffer(): Buffer {
        if (this.ascending) {
            return Buffer.from(this.buffer);
        }
        // For descending, invert all bytes
        const inverted = this.buffer.map(b => 0xFF - b);
        return Buffer.from(inverted);
    }

    /**
     * Append type discriminator
     */
    private appendType(type: BSONTypeOrder): void {
        this.buffer.push(type);
    }

    /**
     * Append null value
     */
    private appendNull(): void {
        this.appendType(BSONTypeOrder.Null);
    }

    /**
     * Append MinKey
     */
    private appendMinKey(): void {
        this.appendType(BSONTypeOrder.MinKey);
    }

    /**
     * Append MaxKey
     */
    private appendMaxKey(): void {
        this.appendType(BSONTypeOrder.MaxKey);
    }

    /**
     * Append boolean value
     */
    private appendBoolean(value: boolean): void {
        this.appendType(BSONTypeOrder.Boolean);
        this.buffer.push(value ? 1 : 0);
    }

    /**
     * Append number value (IEEE 754 double)
     */
    private appendNumber(value: number): void {
        this.appendType(BSONTypeOrder.NumberDouble);

        // Encode double in a sortable way
        const buf = Buffer.alloc(8);
        buf.writeDoubleBE(value, 0);

        // Transform for sorting:
        // - If positive (MSB = 0): flip MSB to 1
        // - If negative (MSB = 1): flip all bits
        if (buf[0] & 0x80) {
            // Negative: flip all bits
            for (let i = 0; i < 8; i++) {
                buf[i] = ~buf[i] & 0xFF;
            }
        } else {
            // Positive or zero: flip MSB
            buf[0] ^= 0x80;
        }

        for (const b of buf) {
            this.buffer.push(b);
        }
    }

    /**
     * Append bigint value
     */
    private appendBigInt(value: bigint): void {
        this.appendType(BSONTypeOrder.NumberLong);

        // Convert to sortable representation
        const buf = Buffer.alloc(8);
        buf.writeBigInt64BE(value, 0);

        // Flip sign bit for sorting
        buf[0] ^= 0x80;

        for (const b of buf) {
            this.buffer.push(b);
        }
    }

    /**
     * Append string value
     */
    private appendString(value: string): void {
        this.appendType(BSONTypeOrder.String);

        // Encode UTF-8 with null byte handling
        const encoded = Buffer.from(value, 'utf8');
        for (const b of encoded) {
            if (b === 0) {
                // Escape null bytes: 0x00 -> 0x00 0xFF
                this.buffer.push(0x00, 0xFF);
            } else {
                this.buffer.push(b);
            }
        }
        // Terminate with 0x00 0x00
        this.buffer.push(0x00, 0x00);
    }

    /**
     * Append binary data
     */
    private appendBinary(value: Buffer): void {
        this.appendType(BSONTypeOrder.BinaryData);

        // Length prefix (4 bytes big-endian)
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(value.length, 0);
        for (const b of lenBuf) {
            this.buffer.push(b);
        }

        // Subtype (default generic)
        this.buffer.push(0);

        // Data
        for (const b of value) {
            this.buffer.push(b);
        }
    }

    /**
     * Append ObjectId
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
     * Append Date
     */
    private appendDate(value: Date): void {
        this.appendType(BSONTypeOrder.Date);

        const ms = BigInt(value.getTime());
        const buf = Buffer.alloc(8);
        buf.writeBigInt64BE(ms, 0);
        buf[0] ^= 0x80; // Flip sign bit

        for (const b of buf) {
            this.buffer.push(b);
        }
    }

    /**
     * Append Timestamp
     */
    private appendTimestamp(value: any): void {
        this.appendType(BSONTypeOrder.Timestamp);

        const t = value.t || value.timestamp || 0;
        const i = value.i || value.increment || 0;

        // Timestamp is 8 bytes: t (4 bytes) + i (4 bytes)
        const buf = Buffer.alloc(8);
        buf.writeUInt32BE(t, 0);
        buf.writeUInt32BE(i, 4);

        for (const b of buf) {
            this.buffer.push(b);
        }
    }

    /**
     * Append Regex
     */
    private appendRegex(value: any): void {
        this.appendType(BSONTypeOrder.RegExp);

        const pattern = value.$regex || value.pattern || '';
        const options = value.$options || value.options || '';

        // Pattern as cstring
        this.appendCString(pattern);
        // Options as cstring
        this.appendCString(options);
    }

    /**
     * Append C-string
     */
    private appendCString(value: string): void {
        const encoded = Buffer.from(value, 'utf8');
        for (const b of encoded) {
            this.buffer.push(b);
        }
        this.buffer.push(0);
    }

    /**
     * Append array
     */
    private appendArray(value: any[]): void {
        this.appendType(BSONTypeOrder.Array);

        for (const item of value) {
            this.appendValue(item);
        }
        // Terminate array
        this.buffer.push(0);
    }

    /**
     * Append object/document
     */
    private appendObject(value: any): void {
        this.appendType(BSONTypeOrder.Object);

        const keys = Object.keys(value).sort();
        for (const key of keys) {
            this.appendCString(key);
            this.appendValue(value[key]);
        }
        // Terminate object
        this.buffer.push(0);
    }

    /**
     * Append Decimal128
     */
    private appendDecimal128(value: any): void {
        this.appendType(BSONTypeOrder.NumberDecimal);

        // Convert to string and then to double for simple comparison
        // Full Decimal128 support would require more complex encoding
        let numVal = 0;
        if (typeof value.toString === 'function') {
            numVal = parseFloat(value.toString());
        } else if (value.$numberDecimal) {
            numVal = parseFloat(value.$numberDecimal);
        }

        // Use double encoding
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
     * Create KeyString from multiple values (compound key)
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
     * Compare two KeyString buffers
     */
    static compare(a: Buffer, b: Buffer): number {
        return Buffer.compare(a, b);
    }
}
