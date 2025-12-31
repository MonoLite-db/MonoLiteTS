// Created by Yanjunhui

/**
 * 使用官方 MongoDB bson 库的 BSON 解码器
 * EN: BSON Decoder using official MongoDB bson library
 */

import { deserialize } from 'bson';
import { BSONDocument } from './types';

/**
 * BSON 解码器（官方库的包装器）
 * EN: BSON Decoder (wrapper around official library)
 */
export class BSONDecoder {
    /**
     * 将 BSON 字节解码为文档
     * EN: Decode BSON bytes to document
     */
    decode(data: Buffer): BSONDocument {
        return deserialize(data, {
            promoteValues: true,  // 将值提升为原生类型 EN: Promote values to native types
            promoteLongs: false,  // 不将 Long 提升为 number EN: Don't promote Long to number
            promoteBuffers: false,  // 不将 Binary 提升为 Buffer EN: Don't promote Binary to Buffer
        }) as BSONDocument;
    }
}
