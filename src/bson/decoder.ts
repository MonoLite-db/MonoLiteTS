// Created by Yanjunhui
// BSON Decoder using official MongoDB bson library

import { deserialize } from 'bson';
import { BSONDocument } from './types';

/**
 * BSON Decoder (wrapper around official library)
 */
export class BSONDecoder {
    /**
     * Decode BSON bytes to document
     */
    decode(data: Buffer): BSONDocument {
        return deserialize(data, {
            promoteValues: true,
            promoteLongs: false,
            promoteBuffers: false,
        }) as BSONDocument;
    }
}
