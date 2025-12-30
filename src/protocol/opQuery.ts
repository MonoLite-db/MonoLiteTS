// Created by Yanjunhui

import { DataEndian } from '../storage/dataEndian';
import { BSONDocument, BSONEncoder, BSONDecoder } from '../bson';
import { MonoError } from '../core';
import { WireMessage, MessageHeader, OpCode, nextRequestId } from './wireMessage';

/**
 * Parsed OP_QUERY message
 */
export interface OpQueryMessage {
    flags: number;
    fullCollectionName: string;
    numberToSkip: number;
    numberToReturn: number;
    query: BSONDocument;
    returnFieldsSelector?: BSONDocument;
}

/**
 * OP_QUERY parser and OP_REPLY builder (aligned with Go version)
 */
export class OpQueryParser {
    private static encoder = new BSONEncoder();
    private static decoder = new BSONDecoder();

    /**
     * Parse OP_QUERY body
     */
    static parse(body: Buffer): OpQueryMessage {
        if (body.length < 12) {
            throw MonoError.protocolError(`OP_QUERY body too short: ${body.length}`);
        }

        const flags = DataEndian.readInt32LE(body, 0);
        let pos = 4;

        // Read fullCollectionName (cstring)
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

        // Read query document
        if (pos + 4 > body.length) {
            throw MonoError.protocolError('OP_QUERY missing query document');
        }
        const docLen = DataEndian.readInt32LE(body, pos);
        if (docLen < 5 || pos + docLen > body.length) {
            throw MonoError.protocolError('OP_QUERY query document extends beyond message');
        }
        const query = this.decoder.decode(body.subarray(pos, pos + docLen));
        pos += docLen;

        // Optional returnFieldsSelector
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
 * OP_REPLY builder
 */
export class OpReplyBuilder {
    private static encoder = new BSONEncoder();

    /**
     * Build OP_REPLY message
     */
    static buildReply(requestId: number, documents: BSONDocument[]): WireMessage {
        // Encode all documents
        const docsBytes: Buffer[] = [];
        let totalDocsLen = 0;
        for (const doc of documents) {
            const encoded = this.encoder.encode(doc);
            docsBytes.push(encoded);
            totalDocsLen += encoded.length;
        }

        // Build body: responseFlags(4) + cursorId(8) + startingFrom(4) + numberReturned(4) + documents
        const bodyLen = 4 + 8 + 4 + 4 + totalDocsLen;
        const body = Buffer.alloc(bodyLen);

        let pos = 0;

        // responseFlags = 0
        DataEndian.writeUInt32LE(body, pos, 0);
        pos += 4;

        // cursorId = 0
        DataEndian.writeUInt64LE(body, pos, BigInt(0));
        pos += 8;

        // startingFrom = 0
        DataEndian.writeUInt32LE(body, pos, 0);
        pos += 4;

        // numberReturned
        DataEndian.writeUInt32LE(body, pos, documents.length);
        pos += 4;

        // documents
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
