// Created by Yanjunhui

/**
 * MonoLite - 兼容 MongoDB Wire 协议的单文件嵌入式文档数据库
 * EN: MonoLite - A single-file embeddable document database compatible with MongoDB Wire Protocol
 */

// 存储层
// EN: Storage layer
export {
    PAGE_SIZE,
    INVALID_PAGE_ID,
    BTREE_ORDER,
    DataEndian,
    SlottedPage,
    Pager,
    WAL,
    BTree,
    KeyString,
    FileHeader,
} from './storage';

// BSON 层
// EN: BSON layer
export * from './bson';

// 核心层
// EN: Core layer
export {
    ErrorCode,
    ErrorCodes,
    getErrorCodeName,
    MonoError,
    asMonoError,
    buildErrorResponse,
    buildSuccessResponse,
    MAX_DOCUMENT_SIZE,
    MAX_BSON_DEPTH,
    MAX_MESSAGE_SIZE,
    LogLevel,
    Logger,
    logger,
} from './core';

// 引擎层
// EN: Engine layer
export * from './engine';

// 协议层
// EN: Protocol layer
export * from './protocol';
