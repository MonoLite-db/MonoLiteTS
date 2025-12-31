// Created by Yanjunhui

/**
 * 从官方 MongoDB bson 库重新导出类型
 * EN: Re-export types from official MongoDB bson library
 */

import {
    ObjectId as OfficialObjectId,
    Timestamp as OfficialTimestamp,
    Decimal128 as OfficialDecimal128,
    MinKey as OfficialMinKey,
    MaxKey as OfficialMaxKey,
    Binary as OfficialBinary,
    BSONRegExp as OfficialBSONRegExp,
    Code as OfficialCode,
    DBRef as OfficialDBRef,
    Long as OfficialLong,
    Document,
    BSONType as OfficialBSONType,
} from 'bson';

// 重新导出官方类型并使用别名以保持兼容性
// EN: Re-export official types with aliases for compatibility
export const ObjectId = OfficialObjectId;
export type ObjectId = OfficialObjectId;

export const Timestamp = OfficialTimestamp;
export type Timestamp = OfficialTimestamp;

export const Decimal128 = OfficialDecimal128;
export type Decimal128 = OfficialDecimal128;

export const MinKey = OfficialMinKey;
export type MinKey = OfficialMinKey;

export const MaxKey = OfficialMaxKey;
export type MaxKey = OfficialMaxKey;

export const Binary = OfficialBinary;
export type Binary = OfficialBinary;

export const BSONRegExp = OfficialBSONRegExp;
export type BSONRegExp = OfficialBSONRegExp;

export const Code = OfficialCode;
export type Code = OfficialCode;

export const DBRef = OfficialDBRef;
export type DBRef = OfficialDBRef;

export const Long = OfficialLong;
export type Long = OfficialLong;

/**
 * BSON 类型标记（与 MongoDB 规范对齐）
 * EN: BSON type markers (aligned with MongoDB spec)
 */
export enum BSONType {
    /** 双精度浮点数 EN: Double precision float */
    Double = 0x01,
    /** 字符串 EN: String */
    String = 0x02,
    /** 文档 EN: Document */
    Document = 0x03,
    /** 数组 EN: Array */
    Array = 0x04,
    /** 二进制数据 EN: Binary data */
    Binary = 0x05,
    /** 未定义（已废弃）EN: Undefined (Deprecated) */
    Undefined = 0x06,
    /** 对象ID EN: Object ID */
    ObjectId = 0x07,
    /** 布尔值 EN: Boolean */
    Boolean = 0x08,
    /** 日期时间 EN: DateTime */
    DateTime = 0x09,
    /** 空值 EN: Null */
    Null = 0x0A,
    /** 正则表达式 EN: Regular expression */
    Regex = 0x0B,
    /** 数据库指针（已废弃）EN: DB Pointer (Deprecated) */
    DBPointer = 0x0C,
    /** JavaScript 代码 EN: JavaScript code */
    JavaScript = 0x0D,
    /** 符号（已废弃）EN: Symbol (Deprecated) */
    Symbol = 0x0E,
    /** 带作用域的 JavaScript（已废弃）EN: JavaScript with scope (Deprecated) */
    JavaScriptWithScope = 0x0F,
    /** 32位整数 EN: 32-bit integer */
    Int32 = 0x10,
    /** 时间戳 EN: Timestamp */
    Timestamp = 0x11,
    /** 64位整数 EN: 64-bit integer */
    Int64 = 0x12,
    /** 128位十进制数 EN: 128-bit decimal */
    Decimal128 = 0x13,
    /** 最小键 EN: Min key */
    MinKey = 0xFF,
    /** 最大键 EN: Max key */
    MaxKey = 0x7F,
}

/**
 * 二进制子类型（从官方库常量重新导出）
 * EN: Binary subtypes (re-export from official library constants)
 */
export enum BinarySubtype {
    /** 通用二进制 EN: Generic binary */
    Generic = 0x00,
    /** 函数 EN: Function */
    Function = 0x01,
    /** 旧版二进制 EN: Binary (old) */
    BinaryOld = 0x02,
    /** 旧版 UUID EN: UUID (old) */
    UuidOld = 0x03,
    /** UUID EN: UUID */
    Uuid = 0x04,
    /** MD5 哈希 EN: MD5 hash */
    Md5 = 0x05,
    /** 加密数据 EN: Encrypted data */
    Encrypted = 0x06,
    /** 列数据 EN: Column data */
    Column = 0x07,
    /** 用户自定义 EN: User defined */
    UserDefined = 0x80,
}

/**
 * BSON 值联合类型
 * EN: BSON value union type
 */
export type BSONValue =
    | null
    | undefined
    | boolean
    | number
    | bigint
    | string
    | Date
    | Buffer
    | OfficialObjectId
    | OfficialTimestamp
    | OfficialDecimal128
    | OfficialMinKey
    | OfficialMaxKey
    | OfficialBinary
    | OfficialBSONRegExp
    | OfficialCode
    | OfficialDBRef
    | OfficialLong
    | BSONValue[]
    | BSONDocument;

/**
 * BSON 文档类型
 * EN: BSON document type
 */
export interface BSONDocument {
    [key: string]: BSONValue;
}

/**
 * BSON 数组类型
 * EN: BSON array type
 */
export type BSONArray = BSONValue[];
