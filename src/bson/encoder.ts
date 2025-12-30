// Created by Yanjunhui
// BSON Encoder using official MongoDB bson library

import { serialize } from 'bson';
import { BSONDocument } from './types';

/**
 * BSON Encoder (wrapper around official library)
 */
export class BSONEncoder {
    /**
     * Encode a document to BSON bytes
     */
    encode(doc: BSONDocument): Buffer {
        return Buffer.from(serialize(doc as any));
    }
}
