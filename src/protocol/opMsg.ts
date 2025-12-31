// Created by Yanjunhui

import { DataEndian } from '../storage/dataEndian';
import { BSONDocument, BSONEncoder, BSONDecoder } from '../bson';
import { MonoError } from '../core';
import { WireMessage, MessageHeader, OpCode, nextRequestId } from './wireMessage';

/**
 * OP_MSG 标志位
 * // EN: OP_MSG flags
 */
export enum OpMsgFlags {
    /** 存在校验和 // EN: Checksum present */
    ChecksumPresent = 0x0001,
    /** 还有更多数据 // EN: More to come */
    MoreToCome = 0x0002,
    /** 允许 exhaust // EN: Exhaust allowed */
    ExhaustAllowed = 0x00010000,
}

/**
 * OP_MSG 节类型
 * // EN: OP_MSG section types
 */
export enum SectionKind {
    /** 消息体 // EN: Body */
    Body = 0,
    /** 文档序列 // EN: Document sequence */
    DocumentSequence = 1,
}

/**
 * 文档序列节
 * // EN: Document sequence section
 */
export interface DocumentSequence {
    /** 标识符 // EN: Identifier */
    identifier: string;
    /** 文档列表 // EN: Documents */
    documents: BSONDocument[];
}

/**
 * 解析后的 OP_MSG 消息
 * // EN: Parsed OP_MSG message
 */
export interface OpMsgMessage {
    /** 标志位 // EN: Flags */
    flags: number;
    /** 消息体 // EN: Body */
    body: BSONDocument | null;
    /** 文档序列 // EN: Sequences */
    sequences: DocumentSequence[];
    /** 校验和 // EN: Checksum */
    checksum?: number;
}

/**
 * OP_MSG 解析器和构建器（与 Go 版本对齐）
 * // EN: OP_MSG parser and builder (aligned with Go version)
 */
export class OpMsgParser {
    /** BSON 编码器 // EN: BSON encoder */
    private static encoder = new BSONEncoder();
    /** BSON 解码器 // EN: BSON decoder */
    private static decoder = new BSONDecoder();

    /**
     * 解析 OP_MSG 消息体
     * // EN: Parse OP_MSG body
     */
    static parse(body: Buffer, fullMessage?: Buffer): OpMsgMessage {
        if (body.length < 5) {
            throw MonoError.protocolError(`OP_MSG body too short: ${body.length}`);
        }

        const flags = DataEndian.readUInt32LE(body, 0);

        // 检查未知的必需标志位（0-15 位）
        // EN: Check for unknown required flags (bits 0-15)
        const requiredBitsMask = 0xFFFF;
        const knownRequiredBits = OpMsgFlags.ChecksumPresent | OpMsgFlags.MoreToCome;
        const unknownRequired = (flags & requiredBitsMask) & ~knownRequiredBits;
        if (unknownRequired !== 0) {
            throw MonoError.protocolError(`OP_MSG contains unknown required flag bits: 0x${unknownRequired.toString(16)}`);
        }

        let endPos = body.length;
        let checksum: number | undefined;

        // 检查校验和 // EN: Check for checksum
        const hasChecksum = (flags & OpMsgFlags.ChecksumPresent) !== 0;
        if (hasChecksum) {
            if (body.length < 9) {
                throw MonoError.protocolError('OP_MSG with checksum too short');
            }
            checksum = DataEndian.readUInt32LE(body, body.length - 4);
            endPos -= 4;

            // 如果提供了完整消息，验证校验和 // EN: Verify checksum if full message provided
            if (fullMessage) {
                if (fullMessage.length < 20) {
                    throw MonoError.protocolError('full message too short for checksum verification');
                }
                const expected = DataEndian.readUInt32LE(fullMessage, fullMessage.length - 4);
                const actual = this.crc32c(fullMessage.subarray(0, fullMessage.length - 4));
                if (actual !== expected) {
                    throw MonoError.protocolError('OP_MSG checksum verification failed');
                }
            }
        }

        let pos = 4;
        let bodyDoc: BSONDocument | null = null;
        const sequences: DocumentSequence[] = [];

        while (pos < endPos) {
            const kind = body[pos] as SectionKind;
            pos++;

            switch (kind) {
                case SectionKind.Body: {
                    if (pos + 4 > endPos) {
                        throw MonoError.protocolError('OP_MSG body section too short');
                    }
                    const docLen = DataEndian.readInt32LE(body, pos);
                    if (docLen < 5 || pos + docLen > endPos) {
                        throw MonoError.protocolError('OP_MSG document extends beyond message');
                    }
                    const docBytes = body.subarray(pos, pos + docLen);
                    bodyDoc = this.decoder.decode(docBytes);
                    pos += docLen;
                    break;
                }

                case SectionKind.DocumentSequence: {
                    if (pos + 4 > endPos) {
                        throw MonoError.protocolError('OP_MSG document sequence too short');
                    }
                    const seqLen = DataEndian.readInt32LE(body, pos);
                    if (seqLen < 4 || pos + seqLen > endPos) {
                        throw MonoError.protocolError('OP_MSG document sequence extends beyond message');
                    }

                    const seqEnd = pos + seqLen;
                    pos += 4;

                    // 读取标识符（C 字符串）// EN: Read identifier (cstring)
                    let identEnd = pos;
                    while (identEnd < seqEnd && body[identEnd] !== 0) {
                        identEnd++;
                    }
                    if (identEnd >= seqEnd) {
                        throw MonoError.protocolError('OP_MSG document sequence identifier not terminated');
                    }
                    const identifier = body.toString('utf8', pos, identEnd);
                    pos = identEnd + 1;

                    // 读取文档列表 // EN: Read documents
                    const documents: BSONDocument[] = [];
                    while (pos < seqEnd) {
                        if (pos + 4 > seqEnd) {
                            throw MonoError.protocolError('OP_MSG document sequence truncated');
                        }
                        const docLen = DataEndian.readInt32LE(body, pos);
                        if (docLen < 5 || pos + docLen > seqEnd) {
                            throw MonoError.protocolError('OP_MSG document extends beyond sequence');
                        }
                        const docBytes = body.subarray(pos, pos + docLen);
                        documents.push(this.decoder.decode(docBytes));
                        pos += docLen;
                    }

                    sequences.push({ identifier, documents });
                    break;
                }

                default:
                    throw MonoError.protocolError('unknown OP_MSG section kind');
            }
        }

        return { flags, body: bodyDoc, sequences, checksum };
    }

    /**
     * 构建 OP_MSG 回复
     * // EN: Build OP_MSG reply
     */
    static buildReply(requestId: number, responseDoc: BSONDocument): WireMessage {
        const bsonData = this.encoder.encode(responseDoc);

        // 构建消息体: 标志位(4) + 节类型(1) + BSON
        // EN: Build body: flags (4) + section kind (1) + bson
        const bodyLen = 4 + 1 + bsonData.length;
        const body = Buffer.alloc(bodyLen);

        // 标志位 = 0 // EN: flags = 0
        DataEndian.writeUInt32LE(body, 0, 0);
        // 节类型 = 消息体 // EN: section kind = body
        body[4] = SectionKind.Body;
        // BSON 文档 // EN: bson document
        bsonData.copy(body, 5);

        const header: MessageHeader = {
            messageLength: 16 + bodyLen,
            requestId: nextRequestId(),
            responseTo: requestId,
            opCode: OpCode.Msg,
        };

        return new WireMessage(header, body);
    }

    /**
     * CRC32C 校验和（简化实现）
     * // EN: CRC32C checksum (simplified implementation)
     */
    private static crc32c(data: Buffer): number {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < data.length; i++) {
            crc ^= data[i];
            for (let j = 0; j < 8; j++) {
                if (crc & 1) {
                    crc = (crc >>> 1) ^ 0x82F63B78;
                } else {
                    crc = crc >>> 1;
                }
            }
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }
}
