// Created by Yanjunhui

import { ErrorCode, getErrorCodeName } from './errorCodes';
import { BSONDocument } from '../bson';

/**
 * MonoLite 错误类（MongoDB 兼容）
 * EN: MonoLite error class (MongoDB-compatible)
 */
export class MonoError extends Error {
    /** 错误码 EN: Error code */
    readonly code: ErrorCode;
    /** 错误码名称 EN: Error code name */
    readonly codeName: string;

    constructor(code: ErrorCode, message: string) {
        super(message);
        this.name = 'MonoError';
        this.code = code;
        this.codeName = getErrorCodeName(code);
    }

    /**
     * 转换为 BSON 错误响应
     * EN: Convert to BSON error response
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
     * 转换为字符串
     * EN: Convert to string
     */
    toString(): string {
        return `${this.codeName} (${this.code}): ${this.message}`;
    }

    // 静态工厂方法
    // EN: Static factory methods

    /**
     * 从错误码创建 MonoError
     * EN: Create MonoError from error code
     */
    static fromCode(code: ErrorCode, message: string): MonoError {
        return new MonoError(code, message);
    }

    /**
     * 内部错误
     * EN: Internal error
     */
    static internalError(message: string): MonoError {
        return new MonoError(ErrorCode.InternalError, message);
    }

    /**
     * 无效值错误
     * EN: Bad value error
     */
    static badValue(message: string): MonoError {
        return new MonoError(ErrorCode.BadValue, message);
    }

    /**
     * 协议错误
     * EN: Protocol error
     */
    static protocolError(message: string): MonoError {
        return new MonoError(ErrorCode.ProtocolError, message);
    }

    /**
     * 类型不匹配
     * EN: Type mismatch
     */
    static typeMismatch(message: string): MonoError {
        return new MonoError(ErrorCode.TypeMismatch, message);
    }

    /**
     * 命名空间未找到
     * EN: Namespace not found
     */
    static namespaceNotFound(namespace: string): MonoError {
        return new MonoError(ErrorCode.NamespaceNotFound, `ns not found: ${namespace}`);
    }

    /**
     * 游标未找到
     * EN: Cursor not found
     */
    static cursorNotFound(cursorId: bigint): MonoError {
        return new MonoError(ErrorCode.CursorNotFound, `cursor id ${cursorId} not found`);
    }

    /**
     * 重复键错误
     * EN: Duplicate key error
     */
    static duplicateKey(keyPattern: string, keyValue: any): MonoError {
        return new MonoError(
            ErrorCode.DuplicateKey,
            `E11000 duplicate key error collection: ${keyPattern} dup key: ${JSON.stringify(keyValue)}`
        );
    }

    /**
     * 索引未找到
     * EN: Index not found
     */
    static indexNotFound(indexName: string): MonoError {
        return new MonoError(ErrorCode.IndexNotFound, `index not found with name [${indexName}]`);
    }

    /**
     * 命令未找到
     * EN: Command not found
     */
    static commandNotFound(cmdName: string): MonoError {
        return new MonoError(ErrorCode.CommandNotFound, `no such command: '${cmdName}'`);
    }

    /**
     * 无效命名空间
     * EN: Invalid namespace
     */
    static invalidNamespace(namespace: string): MonoError {
        return new MonoError(ErrorCode.InvalidNamespace, `Invalid namespace specified '${namespace}'`);
    }

    /**
     * 文档过大
     * EN: Document too large
     */
    static documentTooLarge(size: number, maxSize: number): MonoError {
        return new MonoError(
            ErrorCode.DocumentTooLarge,
            `document is too large: ${size} bytes, max size is ${maxSize} bytes`
        );
    }

    /**
     * 解析失败
     * EN: Failed to parse
     */
    static failedToParse(message: string): MonoError {
        return new MonoError(ErrorCode.FailedToParse, message);
    }

    /**
     * 无效选项
     * EN: Invalid options
     */
    static invalidOptions(message: string): MonoError {
        return new MonoError(ErrorCode.InvalidOptions, message);
    }

    /**
     * 写关注失败
     * EN: Write concern failed
     */
    static writeConcernFailed(message: string): MonoError {
        return new MonoError(ErrorCode.WriteConcernFailed, message);
    }

    /**
     * 操作失败
     * EN: Operation failed
     */
    static operationFailed(message: string): MonoError {
        return new MonoError(ErrorCode.OperationFailed, message);
    }

    /**
     * 非法操作
     * EN: Illegal operation
     */
    static illegalOperation(message: string): MonoError {
        return new MonoError(ErrorCode.IllegalOperation, message);
    }

    /**
     * 无效的 _id 字段
     * EN: Invalid _id field
     */
    static invalidIdField(message: string): MonoError {
        return new MonoError(ErrorCode.InvalidIdField, message);
    }

    /**
     * 无法创建索引
     * EN: Cannot create index
     */
    static cannotCreateIndex(message: string): MonoError {
        return new MonoError(ErrorCode.CannotCreateIndex, message);
    }

    /**
     * 空字段名
     * EN: Empty field name
     */
    static emptyFieldName(): MonoError {
        return new MonoError(ErrorCode.EmptyFieldName, 'field name cannot be empty');
    }

    /**
     * 字段名以 $ 开头
     * EN: Dollar prefixed field name
     */
    static dollarPrefixedFieldName(name: string): MonoError {
        return new MonoError(
            ErrorCode.DollarPrefixedFieldName,
            `field name '${name}' cannot start with '$' in stored documents`
        );
    }

    /**
     * 无效 BSON
     * EN: Invalid BSON
     */
    static invalidBSON(message: string): MonoError {
        return new MonoError(ErrorCode.InvalidBSON, message);
    }

    /**
     * 事务不存在
     * EN: No such transaction
     */
    static noSuchTransaction(): MonoError {
        return new MonoError(ErrorCode.NoSuchTransaction, 'no such transaction');
    }

    /**
     * 事务已提交
     * EN: Transaction committed
     */
    static transactionCommitted(): MonoError {
        return new MonoError(ErrorCode.TransactionCommitted, 'transaction already committed');
    }

    /**
     * 事务已中止
     * EN: Transaction aborted
     */
    static transactionAborted(): MonoError {
        return new MonoError(ErrorCode.TransactionAborted, 'transaction aborted');
    }

    /**
     * 会话不存在
     * EN: No such session
     */
    static noSuchSession(): MonoError {
        return new MonoError(ErrorCode.NoSuchSession, 'no such session');
    }

    /**
     * 事务过旧
     * EN: Transaction too old
     */
    static transactionTooOld(): MonoError {
        return new MonoError(ErrorCode.TransactionTooOld, 'txnNumber is too old');
    }
}

/**
 * 将任意错误转换为 MonoError
 * EN: Convert any error to MonoError
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
 * 构建错误响应 BSON
 * EN: Build error response BSON
 */
export function buildErrorResponse(err: unknown): BSONDocument {
    return asMonoError(err).toBSON();
}

/**
 * 构建成功响应 BSON
 * EN: Build success response BSON
 */
export function buildSuccessResponse(data: BSONDocument = {}): BSONDocument {
    if (!('ok' in data)) {
        return { ok: 1, ...data };
    }
    return data;
}
