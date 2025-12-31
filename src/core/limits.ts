// Created by Yanjunhui

/**
 * MonoLite 限制和约束（与 Go 版本对齐）
 * EN: MonoLite limits and constraints (aligned with Go version)
 */

// 文档限制
// EN: Document limits

/** 最大文档大小 16MB EN: Max document size 16MB */
export const MAX_DOCUMENT_SIZE = 16 * 1024 * 1024;
/** 最大 BSON 嵌套深度 EN: Max BSON nesting depth */
export const MAX_BSON_DEPTH = 100;

// 命名空间限制
// EN: Namespace limits

/** 最大命名空间长度 EN: Max namespace length */
export const MAX_NAMESPACE_LENGTH = 255;
/** 最大数据库名长度 EN: Max database name length */
export const MAX_DATABASE_NAME_LENGTH = 64;
/** 最大集合名长度 EN: Max collection name length */
export const MAX_COLLECTION_NAME_LENGTH = 255;
/** 最大索引名长度 EN: Max index name length */
export const MAX_INDEX_NAME_LENGTH = 128;

// 索引限制
// EN: Index limits

/** 最大索引键长度 EN: Max index key length */
export const MAX_INDEX_KEY_LENGTH = 1024;
/** 最大复合索引键数 EN: Max compound index keys */
export const MAX_COMPOUND_INDEX_KEYS = 32;
/** 每个集合最大索引数 EN: Max indexes per collection */
export const MAX_INDEXES_PER_COLLECTION = 64;

// 查询限制
// EN: Query limits

/** 默认批次大小 EN: Default batch size */
export const DEFAULT_BATCH_SIZE = 101;
/** 最大批次大小 EN: Max batch size */
export const MAX_BATCH_SIZE = 100000;
/** 默认游标超时时间 10分钟 EN: Default cursor timeout 10 minutes */
export const DEFAULT_CURSOR_TIMEOUT_MS = 10 * 60 * 1000;

// 事务限制
// EN: Transaction limits

/** 默认锁超时时间 30秒 EN: Default lock timeout 30 seconds */
export const DEFAULT_LOCK_TIMEOUT_MS = 30 * 1000;
/** 默认会话超时时间 30分钟 EN: Default session timeout 30 minutes */
export const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
/** 最大事务操作数 EN: Max transaction operations */
export const MAX_TRANSACTION_OPERATIONS = 100000;

// Wire 协议限制
// EN: Wire protocol limits

/** 最大消息大小 48MB EN: Max message size 48MB */
export const MAX_MESSAGE_SIZE = 48 * 1024 * 1024;
/** 最大写批次大小 EN: Max write batch size */
export const MAX_WRITE_BATCH_SIZE = 100000;

// 内部限制
// EN: Internal limits

/** 最大排序字节数 32MB EN: Max sort bytes 32MB */
export const MAX_SORT_BYTES = 32 * 1024 * 1024;
/** 最大聚合内存 100MB EN: Max aggregation memory 100MB */
export const MAX_AGGREGATION_MEMORY = 100 * 1024 * 1024;

/**
 * 验证命名空间格式
 * EN: Validate namespace format
 */
export function validateNamespace(namespace: string): { valid: boolean; error?: string } {
    if (!namespace || namespace.length === 0) {
        return { valid: false, error: 'namespace cannot be empty' };
    }

    if (namespace.length > MAX_NAMESPACE_LENGTH) {
        return { valid: false, error: `namespace too long: ${namespace.length} > ${MAX_NAMESPACE_LENGTH}` };
    }

    // 必须包含点
    // EN: Must contain a dot
    const dotIndex = namespace.indexOf('.');
    if (dotIndex === -1) {
        return { valid: false, error: 'namespace must contain a dot' };
    }

    const dbName = namespace.substring(0, dotIndex);
    const collName = namespace.substring(dotIndex + 1);

    // 验证数据库名
    // EN: Validate database name
    const dbValidation = validateDatabaseName(dbName);
    if (!dbValidation.valid) {
        return dbValidation;
    }

    // 验证集合名
    // EN: Validate collection name
    const collValidation = validateCollectionName(collName);
    if (!collValidation.valid) {
        return collValidation;
    }

    return { valid: true };
}

/**
 * 验证数据库名
 * EN: Validate database name
 */
export function validateDatabaseName(name: string): { valid: boolean; error?: string } {
    if (!name || name.length === 0) {
        return { valid: false, error: 'database name cannot be empty' };
    }

    if (name.length > MAX_DATABASE_NAME_LENGTH) {
        return { valid: false, error: `database name too long: ${name.length} > ${MAX_DATABASE_NAME_LENGTH}` };
    }

    // 检查无效字符
    // EN: Check for invalid characters
    const invalidChars = /[\/\\. "$*<>:|?]/;
    if (invalidChars.test(name)) {
        return { valid: false, error: 'database name contains invalid characters' };
    }

    return { valid: true };
}

/**
 * 验证集合名
 * EN: Validate collection name
 */
export function validateCollectionName(name: string): { valid: boolean; error?: string } {
    if (!name || name.length === 0) {
        return { valid: false, error: 'collection name cannot be empty' };
    }

    if (name.length > MAX_COLLECTION_NAME_LENGTH) {
        return { valid: false, error: `collection name too long: ${name.length} > ${MAX_COLLECTION_NAME_LENGTH}` };
    }

    // 不能以 system. 开头
    // EN: Cannot start with system.
    if (name.startsWith('system.')) {
        return { valid: false, error: 'collection names cannot start with "system."' };
    }

    // 不能包含 $
    // EN: Cannot contain $
    if (name.includes('$')) {
        return { valid: false, error: 'collection names cannot contain "$"' };
    }

    // 不能是空字符串
    // EN: Cannot be empty string
    if (name.trim().length === 0) {
        return { valid: false, error: 'collection name cannot be empty or whitespace' };
    }

    return { valid: true };
}

/**
 * 验证索引名
 * EN: Validate index name
 */
export function validateIndexName(name: string): { valid: boolean; error?: string } {
    if (!name || name.length === 0) {
        return { valid: false, error: 'index name cannot be empty' };
    }

    if (name.length > MAX_INDEX_NAME_LENGTH) {
        return { valid: false, error: `index name too long: ${name.length} > ${MAX_INDEX_NAME_LENGTH}` };
    }

    return { valid: true };
}
