// Created by Yanjunhui

/**
 * 使用官方 MongoDB bson 库的 BSON 比较工具
 * EN: BSON comparison utilities using official MongoDB bson library
 */

import {
    ObjectId,
    Timestamp,
    Decimal128,
    MinKey,
    MaxKey,
    Binary,
    BSONRegExp,
    Code,
    Long,
} from 'bson';
import { BSONValue, BSONDocument } from './types';

/**
 * BSON 类型比较顺序（MongoDB 规范）
 * EN: BSON type order for comparison (MongoDB spec)
 * https://www.mongodb.com/docs/manual/reference/bson-type-comparison-order/
 */
const TYPE_ORDER: Map<string, number> = new Map([
    ['MinKey', 0],      // 最小键 EN: Min key
    ['undefined', 1],   // 未定义 EN: Undefined
    ['null', 2],        // 空值 EN: Null
    ['number', 3],      // 数字 EN: Number
    ['bigint', 3],      // 大整数 EN: BigInt
    ['Long', 3],        // 长整数 EN: Long
    ['Decimal128', 3],  // 128位十进制 EN: Decimal128
    ['string', 4],      // 字符串 EN: String
    ['symbol', 5],      // 符号 EN: Symbol
    ['object', 6],      // 对象 EN: Object
    ['array', 7],       // 数组 EN: Array
    ['Binary', 8],      // 二进制 EN: Binary
    ['ObjectId', 9],    // 对象ID EN: ObjectId
    ['boolean', 10],    // 布尔值 EN: Boolean
    ['Date', 11],       // 日期 EN: Date
    ['Timestamp', 12],  // 时间戳 EN: Timestamp
    ['RegExp', 13],     // 正则表达式 EN: RegExp
    ['MaxKey', 14],     // 最大键 EN: Max key
]);

/**
 * 获取值的类型顺序
 * EN: Get type order for a value
 */
function getTypeOrder(value: BSONValue): number {
    if (value === null) return TYPE_ORDER.get('null')!;
    if (value === undefined) return TYPE_ORDER.get('undefined')!;
    if (value instanceof MinKey) return TYPE_ORDER.get('MinKey')!;
    if (value instanceof MaxKey) return TYPE_ORDER.get('MaxKey')!;
    if (typeof value === 'boolean') return TYPE_ORDER.get('boolean')!;
    if (typeof value === 'number') return TYPE_ORDER.get('number')!;
    if (typeof value === 'bigint') return TYPE_ORDER.get('bigint')!;
    if (Long.isLong(value)) return TYPE_ORDER.get('Long')!;
    if (typeof value === 'string') return TYPE_ORDER.get('string')!;
    if (value instanceof Date) return TYPE_ORDER.get('Date')!;
    if (value instanceof Timestamp) return TYPE_ORDER.get('Timestamp')!;
    if (value instanceof ObjectId) return TYPE_ORDER.get('ObjectId')!;
    if (value instanceof Binary) return TYPE_ORDER.get('Binary')!;
    if (value instanceof BSONRegExp) return TYPE_ORDER.get('RegExp')!;
    if (value instanceof Decimal128) return TYPE_ORDER.get('Decimal128')!;
    if (Array.isArray(value)) return TYPE_ORDER.get('array')!;
    if (typeof value === 'object') return TYPE_ORDER.get('object')!;
    return TYPE_ORDER.get('null')!;
}

/**
 * 将数值类型转换为 number 用于比较
 * EN: Convert numeric value to number for comparison
 */
function toNumber(value: any): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (Long.isLong(value)) return value.toNumber();
    if (value instanceof Decimal128) return parseFloat(value.toString());
    return 0;
}

/**
 * 比较两个 BSON 值（与 Go/Swift 版本对齐）
 * EN: Compare two BSON values (aligned with Go/Swift versions)
 * @returns 负数表示 a < b，0 表示相等，正数表示 a > b
 * EN: Returns negative if a < b, 0 if a == b, positive if a > b
 */
export function compareBSONValues(a: BSONValue, b: BSONValue): number {
    const typeOrderA = getTypeOrder(a);
    const typeOrderB = getTypeOrder(b);

    // 不同类型：按类型顺序比较
    // EN: Different types: compare by type order
    if (typeOrderA !== typeOrderB) {
        return typeOrderA - typeOrderB;
    }

    // 相同类型：比较值
    // EN: Same type: compare values
    if (a === null || a === undefined) {
        return 0;
    }

    if (a instanceof MinKey || a instanceof MaxKey) {
        return 0;
    }

    if (typeof a === 'boolean' && typeof b === 'boolean') {
        return (a ? 1 : 0) - (b ? 1 : 0);
    }

    // 数值类型（number、bigint、Long、Decimal128）
    // EN: Numeric types (number, bigint, Long, Decimal128)
    if ((typeof a === 'number' || typeof a === 'bigint' || Long.isLong(a) || a instanceof Decimal128) &&
        (typeof b === 'number' || typeof b === 'bigint' || Long.isLong(b) || b instanceof Decimal128)) {
        const numA = toNumber(a);
        const numB = toNumber(b);
        if (numA < numB) return -1;
        if (numA > numB) return 1;
        return 0;
    }

    if (typeof a === 'string' && typeof b === 'string') {
        return a.localeCompare(b);
    }

    if (a instanceof Date && b instanceof Date) {
        return a.getTime() - b.getTime();
    }

    if (a instanceof Timestamp && b instanceof Timestamp) {
        const tA = a.toNumber ? a.toNumber() : Number(a.t);
        const tB = b.toNumber ? b.toNumber() : Number(b.t);
        if (tA !== tB) return tA - tB;
        // 比较递增值
        // EN: Compare increment
        const iA = typeof (a as any).i === 'number' ? (a as any).i : 0;
        const iB = typeof (b as any).i === 'number' ? (b as any).i : 0;
        return iA - iB;
    }

    if (a instanceof ObjectId && b instanceof ObjectId) {
        return a.toHexString().localeCompare(b.toHexString());
    }

    if (a instanceof Binary && b instanceof Binary) {
        // 先比较子类型
        // EN: Compare subtype first
        if (a.sub_type !== b.sub_type) {
            return a.sub_type - b.sub_type;
        }
        // 逐字节比较缓冲区
        // EN: Compare buffers byte by byte
        const minLen = Math.min(a.buffer.length, b.buffer.length);
        for (let i = 0; i < minLen; i++) {
            if (a.buffer[i] !== b.buffer[i]) {
                return a.buffer[i] - b.buffer[i];
            }
        }
        return a.buffer.length - b.buffer.length;
    }

    if (a instanceof BSONRegExp && b instanceof BSONRegExp) {
        const patternCmp = a.pattern.localeCompare(b.pattern);
        if (patternCmp !== 0) return patternCmp;
        return a.options.localeCompare(b.options);
    }

    if (a instanceof Decimal128 && b instanceof Decimal128) {
        const numA = parseFloat(a.toString());
        const numB = parseFloat(b.toString());
        if (numA < numB) return -1;
        if (numA > numB) return 1;
        return 0;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
        const minLen = Math.min(a.length, b.length);
        for (let i = 0; i < minLen; i++) {
            const cmp = compareBSONValues(a[i], b[i]);
            if (cmp !== 0) return cmp;
        }
        return a.length - b.length;
    }

    if (typeof a === 'object' && typeof b === 'object' &&
        !Array.isArray(a) && !Array.isArray(b)) {
        return compareDocuments(a as BSONDocument, b as BSONDocument);
    }

    return 0;
}

/**
 * 比较两个文档
 * EN: Compare two documents
 */
function compareDocuments(a: BSONDocument, b: BSONDocument): number {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    // 按顺序逐键比较
    // EN: Compare key by key in order
    const minLen = Math.min(keysA.length, keysB.length);
    for (let i = 0; i < minLen; i++) {
        // 比较键名
        // EN: Compare key names
        const keyCmp = keysA[i].localeCompare(keysB[i]);
        if (keyCmp !== 0) return keyCmp;

        // 比较值
        // EN: Compare values
        const valueCmp = compareBSONValues(a[keysA[i]], b[keysB[i]]);
        if (valueCmp !== 0) return valueCmp;
    }

    return keysA.length - keysB.length;
}

/**
 * 检查两个 BSON 值是否相等
 * EN: Check if two BSON values are equal
 */
export function bsonEquals(a: BSONValue, b: BSONValue): boolean {
    return compareBSONValues(a, b) === 0;
}

/**
 * 深度克隆 BSON 值
 * EN: Deep clone a BSON value
 */
export function cloneBSONValue(value: BSONValue): BSONValue {
    if (value === null || value === undefined) {
        return value;
    }

    // 原始类型直接返回
    // EN: Primitive types return directly
    if (typeof value === 'boolean' || typeof value === 'number' ||
        typeof value === 'bigint' || typeof value === 'string') {
        return value;
    }

    if (Long.isLong(value)) {
        return Long.fromValue(value);
    }

    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    if (value instanceof ObjectId) {
        return new ObjectId(value.toHexString());
    }

    if (value instanceof Timestamp) {
        return new Timestamp(value);
    }

    if (value instanceof Decimal128) {
        return Decimal128.fromString(value.toString());
    }

    if (value instanceof MinKey) {
        return new MinKey();
    }

    if (value instanceof MaxKey) {
        return new MaxKey();
    }

    if (value instanceof Binary) {
        return new Binary(Buffer.from(value.buffer), value.sub_type);
    }

    if (value instanceof BSONRegExp) {
        return new BSONRegExp(value.pattern, value.options);
    }

    if (value instanceof Code) {
        return new Code(value.code, value.scope ? cloneBSONValue(value.scope) as BSONDocument : undefined);
    }

    // 数组递归克隆
    // EN: Array recursive clone
    if (Array.isArray(value)) {
        return value.map(v => cloneBSONValue(v));
    }

    // 对象递归克隆
    // EN: Object recursive clone
    if (typeof value === 'object') {
        const result: BSONDocument = {};
        for (const [key, val] of Object.entries(value)) {
            result[key] = cloneBSONValue(val);
        }
        return result;
    }

    return value;
}

/**
 * 通过点号路径从文档中获取值
 * EN: Get a value from a document by dot-notation path
 */
export function getValueByPath(doc: BSONDocument, path: string): BSONValue {
    const parts = path.split('.');
    let current: BSONValue = doc;

    for (const part of parts) {
        if (current === null || current === undefined) {
            return undefined;
        }

        if (Array.isArray(current)) {
            const index = parseInt(part, 10);
            if (!isNaN(index)) {
                current = current[index];
            } else {
                return undefined;
            }
        } else if (typeof current === 'object') {
            current = (current as BSONDocument)[part];
        } else {
            return undefined;
        }
    }

    return current;
}

/**
 * 通过点号路径在文档中设置值
 * EN: Set a value in a document by dot-notation path
 */
export function setValueByPath(doc: BSONDocument, path: string, value: BSONValue): void {
    const parts = path.split('.');
    let current: any = doc;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const nextPart = parts[i + 1];
        const isNextIndex = !isNaN(parseInt(nextPart, 10));

        if (current[part] === undefined || current[part] === null) {
            // 根据下一级是索引还是键决定创建数组还是对象
            // EN: Create array or object based on whether next level is index or key
            current[part] = isNextIndex ? [] : {};
        }
        current = current[part];
    }

    current[parts[parts.length - 1]] = value;
}

/**
 * 通过点号路径从文档中删除值
 * EN: Delete a value from a document by dot-notation path
 */
export function deleteValueByPath(doc: BSONDocument, path: string): boolean {
    const parts = path.split('.');
    let current: any = doc;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (current[part] === undefined || current[part] === null) {
            return false;
        }
        current = current[part];
    }

    const lastPart = parts[parts.length - 1];
    if (lastPart in current) {
        delete current[lastPart];
        return true;
    }
    return false;
}

/**
 * compareBSONValues 的别名（用于兼容性）
 * EN: Alias for compareBSONValues (for compatibility)
 */
export const compareBSON = compareBSONValues;
