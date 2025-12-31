// Created by Yanjunhui

/**
 * 使用官方 MongoDB bson 库的 BSON 编码器
 * EN: BSON Encoder using official MongoDB bson library
 */

import { serialize } from 'bson';
import { BSONDocument } from './types';

/**
 * BSON 编码器（官方库的包装器）
 * EN: BSON Encoder (wrapper around official library)
 */
export class BSONEncoder {
    /**
     * 将文档编码为 BSON 字节
     * EN: Encode a document to BSON bytes
     */
    encode(doc: BSONDocument): Buffer {
        return Buffer.from(serialize(doc as any));
    }
}
