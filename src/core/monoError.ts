// Created by Yanjunhui

import { ErrorCode, getErrorCodeName } from './errorCodes';
import { BSONDocument } from '../bson';

/**
 * MonoLite error class (MongoDB-compatible)
 */
export class MonoError extends Error {
    readonly code: ErrorCode;
    readonly codeName: string;

    constructor(code: ErrorCode, message: string) {
        super(message);
        this.name = 'MonoError';
        this.code = code;
        this.codeName = getErrorCodeName(code);
    }

    /**
     * Convert to BSON error response
     */
    toBSON(): BSONDocument {
        return {
            ok: 0,
            errmsg: this.message,
            code: this.code,
            codeName: this.codeName,
        };
    }

    /**
     * Convert to string
     */
    toString(): string {
        return `${this.codeName} (${this.code}): ${this.message}`;
    }

    // Static factory methods

    /**
     * Create MonoError from error code
     */
    static fromCode(code: ErrorCode, message: string): MonoError {
        return new MonoError(code, message);
    }

    static internalError(message: string): MonoError {
        return new MonoError(ErrorCode.InternalError, message);
    }

    static badValue(message: string): MonoError {
        return new MonoError(ErrorCode.BadValue, message);
    }

    static protocolError(message: string): MonoError {
        return new MonoError(ErrorCode.ProtocolError, message);
    }

    static typeMismatch(message: string): MonoError {
        return new MonoError(ErrorCode.TypeMismatch, message);
    }

    static namespaceNotFound(namespace: string): MonoError {
        return new MonoError(ErrorCode.NamespaceNotFound, `ns not found: ${namespace}`);
    }

    static cursorNotFound(cursorId: bigint): MonoError {
        return new MonoError(ErrorCode.CursorNotFound, `cursor id ${cursorId} not found`);
    }

    static duplicateKey(keyPattern: string, keyValue: any): MonoError {
        return new MonoError(
            ErrorCode.DuplicateKey,
            `E11000 duplicate key error collection: ${keyPattern} dup key: ${JSON.stringify(keyValue)}`
        );
    }

    static indexNotFound(indexName: string): MonoError {
        return new MonoError(ErrorCode.IndexNotFound, `index not found with name [${indexName}]`);
    }

    static commandNotFound(cmdName: string): MonoError {
        return new MonoError(ErrorCode.CommandNotFound, `no such command: '${cmdName}'`);
    }

    static invalidNamespace(namespace: string): MonoError {
        return new MonoError(ErrorCode.InvalidNamespace, `Invalid namespace specified '${namespace}'`);
    }

    static documentTooLarge(size: number, maxSize: number): MonoError {
        return new MonoError(
            ErrorCode.DocumentTooLarge,
            `document is too large: ${size} bytes, max size is ${maxSize} bytes`
        );
    }

    static failedToParse(message: string): MonoError {
        return new MonoError(ErrorCode.FailedToParse, message);
    }

    static invalidOptions(message: string): MonoError {
        return new MonoError(ErrorCode.InvalidOptions, message);
    }

    static writeConcernFailed(message: string): MonoError {
        return new MonoError(ErrorCode.WriteConcernFailed, message);
    }

    static operationFailed(message: string): MonoError {
        return new MonoError(ErrorCode.OperationFailed, message);
    }

    static illegalOperation(message: string): MonoError {
        return new MonoError(ErrorCode.IllegalOperation, message);
    }

    static invalidIdField(message: string): MonoError {
        return new MonoError(ErrorCode.InvalidIdField, message);
    }

    static cannotCreateIndex(message: string): MonoError {
        return new MonoError(ErrorCode.CannotCreateIndex, message);
    }

    static emptyFieldName(): MonoError {
        return new MonoError(ErrorCode.EmptyFieldName, 'field name cannot be empty');
    }

    static dollarPrefixedFieldName(name: string): MonoError {
        return new MonoError(
            ErrorCode.DollarPrefixedFieldName,
            `field name '${name}' cannot start with '$' in stored documents`
        );
    }

    static invalidBSON(message: string): MonoError {
        return new MonoError(ErrorCode.InvalidBSON, message);
    }

    static noSuchTransaction(): MonoError {
        return new MonoError(ErrorCode.NoSuchTransaction, 'no such transaction');
    }

    static transactionCommitted(): MonoError {
        return new MonoError(ErrorCode.TransactionCommitted, 'transaction already committed');
    }

    static transactionAborted(): MonoError {
        return new MonoError(ErrorCode.TransactionAborted, 'transaction aborted');
    }

    static noSuchSession(): MonoError {
        return new MonoError(ErrorCode.NoSuchSession, 'no such session');
    }

    static transactionTooOld(): MonoError {
        return new MonoError(ErrorCode.TransactionTooOld, 'txnNumber is too old');
    }
}

/**
 * Convert any error to MonoError
 */
export function asMonoError(err: unknown): MonoError {
    if (err instanceof MonoError) {
        return err;
    }
    if (err instanceof Error) {
        return MonoError.internalError(err.message);
    }
    return MonoError.internalError(String(err));
}

/**
 * Build error response BSON
 */
export function buildErrorResponse(err: unknown): BSONDocument {
    return asMonoError(err).toBSON();
}

/**
 * Build success response BSON
 */
export function buildSuccessResponse(data: BSONDocument = {}): BSONDocument {
    if (!('ok' in data)) {
        return { ok: 1, ...data };
    }
    return data;
}
