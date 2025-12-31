// Created by Yanjunhui

import { DataEndian } from '../storage/dataEndian';
import { BSONDocument, BSONEncoder, BSONDecoder } from '../bson';
import { MonoError } from '../core';
import { WireMessage, MessageHeader, OpCode, nextRequestId } from './wireMessage';

/**
 * 解析后的 OP_QUERY 消息
 * // EN: Parsed OP_QUERY message
 */
export interface OpQueryMessage {
    /** 标志位 // EN: Flags */
    flags: number;
    /** 完整集合名 // EN: Full collection name */
    fullCollectionName: string;
    /** 跳过数量 // EN: Number to skip */
    numberToSkip: number;
    /** 返回数量 // EN: Number to return */
    numberToReturn: number;
    /** 查询文档 // EN: Query document */
    query: BSONDocument;
    /** 返回字段选择器 // EN: Return fields selector */
    returnFieldsSelector?: BSONDocument;
}

/**
 * OP_QUERY 解析器（与 Go 版本对齐）
 * // EN: OP_QUERY parser (aligned with Go version)
 */
export class OpQueryParser {
    /** BSON 编码器 // EN: BSON encoder */
    private static encoder = new BSONEncoder();
    /** BSON 解码器 // EN: BSON decoder */
    private static decoder = new BSONDecoder();

    /**
     * 解析 OP_QUERY 消息体
     * // EN: Parse OP_QUERY body
     */
    static parse(body: Buffer): OpQueryMessage {
        if (body.length < 12) {
            throw MonoError.protocolError(`OP_QUERY body too short: ${body.length}`);
        }

        const flags = DataEndian.readInt32LE(body, 0);
        let pos = 4;

        // 读取完整集合名（C 字符串）// EN: Read fullCollectionName (cstring)
        let nameEnd = pos;
        while (nameEnd < body.length && body[nameEnd] !== 0) {
            nameEnd++;
        }
        if (nameEnd >= body.length) {
            throw MonoError.protocolError('OP_QUERY collection name not terminated');
        }
        const fullCollectionName = body.toString('utf8', pos, nameEnd);
        pos = nameEnd + 1;

        if (pos + 8 > body.length) {
            throw MonoError.protocolError('OP_QUERY missing skip/return fields');
        }
        const numberToSkip = DataEndian.readInt32LE(body, pos);
        pos += 4;
        const numberToReturn = DataEndian.readInt32LE(body, pos);
        pos += 4;

        // 读取查询文档 // EN: Read query document
        if (pos + 4 > body.length) {
            throw MonoError.protocolError('OP_QUERY missing query document');
        }
        const docLen = DataEndian.readInt32LE(body, pos);
        if (docLen < 5 || pos + docLen > body.length) {
            throw MonoError.protocolError('OP_QUERY query document extends beyond message');
        }
        const query = this.decoder.decode(body.subarray(pos, pos + docLen));
        pos += docLen;

        // 可选的返回字段选择器 // EN: Optional returnFieldsSelector
        let returnFieldsSelector: BSONDocument | undefined;
        if (pos + 4 <= body.length) {
            const selLen = DataEndian.readInt32LE(body, pos);
            if (selLen >= 5 && pos + selLen <= body.length) {
                returnFieldsSelector = this.decoder.decode(body.subarray(pos, pos + selLen));
            }
        }

        return {
            flags,
            fullCollectionName,
            numberToSkip,
            numberToReturn,
            query,
            returnFieldsSelector,
        };
    }
}

/**
 * OP_REPLY 构建器
 * // EN: OP_REPLY builder
 */
export class OpReplyBuilder {
    /** BSON 编码器 // EN: BSON encoder */
    private static encoder = new BSONEncoder();

    /**
     * 构建 OP_REPLY 消息
     * // EN: Build OP_REPLY message
     */
    static buildReply(requestId: number, documents: BSONDocument[]): WireMessage {
        // 编码所有文档 // EN: Encode all documents
        const docsBytes: Buffer[] = [];
        let totalDocsLen = 0;
        for (const doc of documents) {
            const encoded = this.encoder.encode(doc);
            docsBytes.push(encoded);
            totalDocsLen += encoded.length;
        }

        // 构建消息体: 响应标志(4) + 游标ID(8) + 起始位置(4) + 返回数量(4) + 文档
        // EN: Build body: responseFlags(4) + cursorId(8) + startingFrom(4) + numberReturned(4) + documents
        const bodyLen = 4 + 8 + 4 + 4 + totalDocsLen;
        const body = Buffer.alloc(bodyLen);

        let pos = 0;

        // 响应标志 = 0 // EN: responseFlags = 0
        DataEndian.writeUInt32LE(body, pos, 0);
        pos += 4;

        // 游标 ID = 0 // EN: cursorId = 0
        DataEndian.writeUInt64LE(body, pos, BigInt(0));
        pos += 8;

        // 起始位置 = 0 // EN: startingFrom = 0
        DataEndian.writeUInt32LE(body, pos, 0);
        pos += 4;

        // 返回数量 // EN: numberReturned
        DataEndian.writeUInt32LE(body, pos, documents.length);
        pos += 4;

        // 文档列表 // EN: documents
        for (const docBytes of docsBytes) {
            docBytes.copy(body, pos);
            pos += docBytes.length;
        }

        const header: MessageHeader = {
            messageLength: 16 + bodyLen,
            requestId: nextRequestId(),
            responseTo: requestId,
            opCode: OpCode.Reply,
        };

        return new WireMessage(header, body);
    }
}
