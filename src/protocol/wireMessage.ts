// Created by Yanjunhui

/**
 * MongoDB Wire 协议消息处理
 * EN: MongoDB Wire Protocol message handling
 */

import { DataEndian } from '../storage/dataEndian';
import { MAX_MESSAGE_SIZE } from '../storage/constants';
import { MonoError } from '../core';

/**
 * MongoDB Wire 协议操作码
 * EN: MongoDB Wire Protocol opcodes
 */
export enum OpCode {
    /** 回复 EN: Reply */
    Reply = 1,
    /** 更新（已废弃）EN: Update (Deprecated) */
    Update = 2001,
    /** 插入（已废弃）EN: Insert (Deprecated) */
    Insert = 2002,
    /** 查询 EN: Query */
    Query = 2004,
    /** 获取更多（已废弃）EN: Get more (Deprecated) */
    GetMore = 2005,
    /** 删除（已废弃）EN: Delete (Deprecated) */
    Delete = 2006,
    /** 终止游标（已废弃）EN: Kill cursors (Deprecated) */
    KillCursors = 2007,
    /** 压缩 EN: Compressed */
    Compressed = 2012,
    /** 消息 EN: Message */
    Msg = 2013,
}

/**
 * Wire 消息头（16 字节）
 * EN: Wire message header (16 bytes)
 */
export interface MessageHeader {
    /** 消息长度 EN: Message length */
    messageLength: number;
    /** 请求 ID EN: Request ID */
    requestId: number;
    /** 响应目标 EN: Response to */
    responseTo: number;
    /** 操作码 EN: Operation code */
    opCode: OpCode;
}

/**
 * Wire 消息结构
 * EN: Wire message structure
 */
export class WireMessage {
    /** 消息头 EN: Message header */
    header: MessageHeader;
    /** 消息体 EN: Message body */
    body: Buffer;

    constructor(header: MessageHeader, body: Buffer) {
        this.header = header;
        this.body = body;
    }

    /**
     * 从缓冲区解析消息
     * EN: Parse message from buffer
     */
    static fromBuffer(buf: Buffer): WireMessage {
        if (buf.length < 16) {
            throw MonoError.protocolError('Message too short for header');
        }

        const messageLength = DataEndian.readInt32LE(buf, 0);
        if (messageLength < 16 || messageLength > MAX_MESSAGE_SIZE) {
            throw MonoError.protocolError(`Invalid message length: ${messageLength}`);
        }

        if (buf.length < messageLength) {
            throw MonoError.protocolError('Incomplete message');
        }

        const header: MessageHeader = {
            messageLength,
            requestId: DataEndian.readInt32LE(buf, 4),
            responseTo: DataEndian.readInt32LE(buf, 8),
            opCode: DataEndian.readInt32LE(buf, 12) as OpCode,
        };

        const body = buf.subarray(16, messageLength);

        return new WireMessage(header, body);
    }

    /**
     * 将消息转换为缓冲区
     * EN: Convert message to buffer
     */
    toBuffer(): Buffer {
        const totalLength = 16 + this.body.length;
        const buf = Buffer.alloc(totalLength);

        DataEndian.writeInt32LE(buf, 0, totalLength);
        DataEndian.writeInt32LE(buf, 4, this.header.requestId);
        DataEndian.writeInt32LE(buf, 8, this.header.responseTo);
        DataEndian.writeInt32LE(buf, 12, this.header.opCode);

        this.body.copy(buf, 16);

        return buf;
    }

    /**
     * 获取完整消息字节（包括头）
     * EN: Get full message bytes including header
     */
    getBytes(): Buffer {
        return this.toBuffer();
    }
}

// 请求 ID 生成器
// EN: Request ID generator
let requestIdCounter = 0;

/**
 * 生成下一个请求 ID
 * EN: Generate next request ID
 */
export function nextRequestId(): number {
    requestIdCounter++;
    if (requestIdCounter > 0x7FFFFFFF) {
        requestIdCounter = 1;
    }
    return requestIdCounter;
}
