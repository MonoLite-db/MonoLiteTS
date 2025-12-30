// Created by Yanjunhui
// BSON comparison utilities using official MongoDB bson library

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
 * BSON type order for comparison (MongoDB spec)
 * https://www.mongodb.com/docs/manual/reference/bson-type-comparison-order/
 */
const TYPE_ORDER: Map<string, number> = new Map([
    ['MinKey', 0],
    ['undefined', 1],
    ['null', 2],
    ['number', 3],
    ['bigint', 3],
    ['Long', 3],
    ['Decimal128', 3],
    ['string', 4],
    ['symbol', 5],
    ['object', 6],
    ['array', 7],
    ['Binary', 8],
    ['ObjectId', 9],
    ['boolean', 10],
    ['Date', 11],
    ['Timestamp', 12],
    ['RegExp', 13],
    ['MaxKey', 14],
]);

/**
 * Get type order for a value
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
 * Convert numeric value to number for comparison
 */
function toNumber(value: any): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (Long.isLong(value)) return value.toNumber();
    if (value instanceof Decimal128) return parseFloat(value.toString());
    return 0;
}

/**
 * Compare two BSON values (aligned with Go/Swift versions)
 * Returns: negative if a < b, 0 if a == b, positive if a > b
 */
export function compareBSONValues(a: BSONValue, b: BSONValue): number {
    const typeOrderA = getTypeOrder(a);
    const typeOrderB = getTypeOrder(b);

    // Different types: compare by type order
    if (typeOrderA !== typeOrderB) {
        return typeOrderA - typeOrderB;
    }

    // Same type: compare values
    if (a === null || a === undefined) {
        return 0;
    }

    if (a instanceof MinKey || a instanceof MaxKey) {
        return 0;
    }

    if (typeof a === 'boolean' && typeof b === 'boolean') {
        return (a ? 1 : 0) - (b ? 1 : 0);
    }

    // Numeric types (number, bigint, Long, Decimal128)
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
        // Compare increment
        const iA = typeof (a as any).i === 'number' ? (a as any).i : 0;
        const iB = typeof (b as any).i === 'number' ? (b as any).i : 0;
        return iA - iB;
    }

    if (a instanceof ObjectId && b instanceof ObjectId) {
        return a.toHexString().localeCompare(b.toHexString());
    }

    if (a instanceof Binary && b instanceof Binary) {
        // Compare subtype first
        if (a.sub_type !== b.sub_type) {
            return a.sub_type - b.sub_type;
        }
        // Compare buffers byte by byte
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
 * Compare two documents
 */
function compareDocuments(a: BSONDocument, b: BSONDocument): number {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    // Compare key by key in order
    const minLen = Math.min(keysA.length, keysB.length);
    for (let i = 0; i < minLen; i++) {
        // Compare key names
        const keyCmp = keysA[i].localeCompare(keysB[i]);
        if (keyCmp !== 0) return keyCmp;

        // Compare values
        const valueCmp = compareBSONValues(a[keysA[i]], b[keysB[i]]);
        if (valueCmp !== 0) return valueCmp;
    }

    return keysA.length - keysB.length;
}

/**
 * Check if two BSON values are equal
 */
export function bsonEquals(a: BSONValue, b: BSONValue): boolean {
    return compareBSONValues(a, b) === 0;
}

/**
 * Deep clone a BSON value
 */
export function cloneBSONValue(value: BSONValue): BSONValue {
    if (value === null || value === undefined) {
        return value;
    }

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

    if (Array.isArray(value)) {
        return value.map(v => cloneBSONValue(v));
    }

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
 * Get a value from a document by dot-notation path
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
 * Set a value in a document by dot-notation path
 */
export function setValueByPath(doc: BSONDocument, path: string, value: BSONValue): void {
    const parts = path.split('.');
    let current: any = doc;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const nextPart = parts[i + 1];
        const isNextIndex = !isNaN(parseInt(nextPart, 10));

        if (current[part] === undefined || current[part] === null) {
            current[part] = isNextIndex ? [] : {};
        }
        current = current[part];
    }

    current[parts[parts.length - 1]] = value;
}

/**
 * Delete a value from a document by dot-notation path
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
 * Alias for compareBSONValues (for compatibility)
 */
export const compareBSON = compareBSONValues;
