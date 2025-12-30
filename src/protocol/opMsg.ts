// Created by Yanjunhui

import { DataEndian } from '../storage/dataEndian';
import { BSONDocument, BSONEncoder, BSONDecoder } from '../bson';
import { MonoError } from '../core';
import { WireMessage, MessageHeader, OpCode, nextRequestId } from './wireMessage';

/**
 * OP_MSG flags
 */
export enum OpMsgFlags {
    ChecksumPresent = 0x0001,
    MoreToCome = 0x0002,
    ExhaustAllowed = 0x00010000,
}

/**
 * OP_MSG section types
 */
export enum SectionKind {
    Body = 0,
    DocumentSequence = 1,
}

/**
 * Document sequence section
 */
export interface DocumentSequence {
    identifier: string;
    documents: BSONDocument[];
}

/**
 * Parsed OP_MSG message
 */
export interface OpMsgMessage {
    flags: number;
    body: BSONDocument | null;
    sequences: DocumentSequence[];
    checksum?: number;
}

/**
 * OP_MSG parser and builder (aligned with Go version)
 */
export class OpMsgParser {
    private static encoder = new BSONEncoder();
    private static decoder = new BSONDecoder();

    /**
     * Parse OP_MSG body
     */
    static parse(body: Buffer, fullMessage?: Buffer): OpMsgMessage {
        if (body.length < 5) {
            throw MonoError.protocolError(`OP_MSG body too short: ${body.length}`);
        }

        const flags = DataEndian.readUInt32LE(body, 0);

        // Check for unknown required flags (bits 0-15)
        const requiredBitsMask = 0xFFFF;
        const knownRequiredBits = OpMsgFlags.ChecksumPresent | OpMsgFlags.MoreToCome;
        const unknownRequired = (flags & requiredBitsMask) & ~knownRequiredBits;
        if (unknownRequired !== 0) {
            throw MonoError.protocolError(`OP_MSG contains unknown required flag bits: 0x${unknownRequired.toString(16)}`);
        }

        let endPos = body.length;
        let checksum: number | undefined;

        // Check for checksum
        const hasChecksum = (flags & OpMsgFlags.ChecksumPresent) !== 0;
        if (hasChecksum) {
            if (body.length < 9) {
                throw MonoError.protocolError('OP_MSG with checksum too short');
            }
            checksum = DataEndian.readUInt32LE(body, body.length - 4);
            endPos -= 4;

            // Verify checksum if full message provided
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

                    // Read identifier (cstring)
                    let identEnd = pos;
                    while (identEnd < seqEnd && body[identEnd] !== 0) {
                        identEnd++;
                    }
                    if (identEnd >= seqEnd) {
                        throw MonoError.protocolError('OP_MSG document sequence identifier not terminated');
                    }
                    const identifier = body.toString('utf8', pos, identEnd);
                    pos = identEnd + 1;

                    // Read documents
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
     * Build OP_MSG reply
     */
    static buildReply(requestId: number, responseDoc: BSONDocument): WireMessage {
        const bsonData = this.encoder.encode(responseDoc);

        // Build body: flags (4) + section kind (1) + bson
        const bodyLen = 4 + 1 + bsonData.length;
        const body = Buffer.alloc(bodyLen);

        // flags = 0
        DataEndian.writeUInt32LE(body, 0, 0);
        // section kind = body
        body[4] = SectionKind.Body;
        // bson document
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
     * CRC32C checksum (simplified implementation)
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
