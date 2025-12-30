// Created by Yanjunhui

import { DataEndian } from '../storage/dataEndian';
import { MAX_MESSAGE_SIZE } from '../storage/constants';
import { MonoError } from '../core';

/**
 * MongoDB Wire Protocol opcodes
 */
export enum OpCode {
    Reply = 1,
    Update = 2001, // Deprecated
    Insert = 2002, // Deprecated
    Query = 2004,
    GetMore = 2005, // Deprecated
    Delete = 2006, // Deprecated
    KillCursors = 2007, // Deprecated
    Compressed = 2012,
    Msg = 2013,
}

/**
 * Wire message header (16 bytes)
 */
export interface MessageHeader {
    messageLength: number;
    requestId: number;
    responseTo: number;
    opCode: OpCode;
}

/**
 * Wire message structure
 */
export class WireMessage {
    header: MessageHeader;
    body: Buffer;

    constructor(header: MessageHeader, body: Buffer) {
        this.header = header;
        this.body = body;
    }

    /**
     * Parse message from buffer
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
     * Convert message to buffer
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
     * Get full message bytes including header
     */
    getBytes(): Buffer {
        return this.toBuffer();
    }
}

/**
 * Request ID generator
 */
let requestIdCounter = 0;

export function nextRequestId(): number {
    requestIdCounter++;
    if (requestIdCounter > 0x7FFFFFFF) {
        requestIdCounter = 1;
    }
    return requestIdCounter;
}
