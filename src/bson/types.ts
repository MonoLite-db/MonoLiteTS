// Created by Yanjunhui
// Re-export types from official MongoDB bson library

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

// Re-export official types with aliases for compatibility
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

// BSON type markers (aligned with MongoDB spec)
export enum BSONType {
    Double = 0x01,
    String = 0x02,
    Document = 0x03,
    Array = 0x04,
    Binary = 0x05,
    Undefined = 0x06, // Deprecated
    ObjectId = 0x07,
    Boolean = 0x08,
    DateTime = 0x09,
    Null = 0x0A,
    Regex = 0x0B,
    DBPointer = 0x0C, // Deprecated
    JavaScript = 0x0D,
    Symbol = 0x0E, // Deprecated
    JavaScriptWithScope = 0x0F, // Deprecated
    Int32 = 0x10,
    Timestamp = 0x11,
    Int64 = 0x12,
    Decimal128 = 0x13,
    MinKey = 0xFF,
    MaxKey = 0x7F,
}

// Binary subtypes (re-export from official library constants)
export enum BinarySubtype {
    Generic = 0x00,
    Function = 0x01,
    BinaryOld = 0x02,
    UuidOld = 0x03,
    Uuid = 0x04,
    Md5 = 0x05,
    Encrypted = 0x06,
    Column = 0x07,
    UserDefined = 0x80,
}

// BSON value union type
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

// BSON document type
export interface BSONDocument {
    [key: string]: BSONValue;
}

// BSON array type
export type BSONArray = BSONValue[];
