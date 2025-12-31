// Created by Yanjunhui

/**
 * MongoDB 兼容的错误码（与 Go 版本对齐）
 * EN: MongoDB-compatible error codes (aligned with Go version)
 * 参考: https://github.com/mongodb/mongo/blob/master/src/mongo/base/error_codes.yml
 * EN: Reference: https://github.com/mongodb/mongo/blob/master/src/mongo/base/error_codes.yml
 */
export enum ErrorCode {
    // 通用错误 (1-99)
    // EN: General errors (1-99)
    /** 成功 EN: OK */
    OK = 0,
    /** 内部错误 EN: Internal error */
    InternalError = 1,
    /** 无效值 EN: Bad value */
    BadValue = 2,
    /** 键不存在 EN: No such key */
    NoSuchKey = 4,
    /** 图包含循环 EN: Graph contains cycle */
    GraphContainsCycle = 5,
    /** 主机不可达 EN: Host unreachable */
    HostUnreachable = 6,
    /** 主机未找到 EN: Host not found */
    HostNotFound = 7,
    /** 未知错误 EN: Unknown error */
    UnknownError = 8,
    /** 解析失败 EN: Failed to parse */
    FailedToParse = 9,
    /** 无法修改对象 EN: Cannot mutate object */
    CannotMutateObject = 10,
    /** 用户未找到 EN: User not found */
    UserNotFound = 11,
    /** 不支持的格式 EN: Unsupported format */
    UnsupportedFormat = 12,
    /** 未授权 EN: Unauthorized */
    Unauthorized = 13,
    /** 类型不匹配 EN: Type mismatch */
    TypeMismatch = 14,
    /** 溢出 EN: Overflow */
    Overflow = 15,
    /** 无效长度 EN: Invalid length */
    InvalidLength = 16,
    /** 协议错误 EN: Protocol error */
    ProtocolError = 17,
    /** 认证失败 EN: Authentication failed */
    AuthenticationFailed = 18,
    /** 无法重用对象 EN: Cannot reuse object */
    CannotReuseObject = 19,
    /** 非法操作 EN: Illegal operation */
    IllegalOperation = 20,
    /** 空数组操作 EN: Empty array operation */
    EmptyArrayOperation = 21,
    /** 无效BSON EN: Invalid BSON */
    InvalidBSON = 22,

    // 命令错误 (26-50)
    // EN: Command errors (26-50)
    /** 命名空间未找到 EN: Namespace not found */
    NamespaceNotFound = 26,
    /** 索引未找到 EN: Index not found */
    IndexNotFound = 27,
    /** 路径不可行 EN: Path not viable */
    PathNotViable = 28,
    /** 路径不存在 EN: Non-existent path */
    NonExistentPath = 29,
    /** 无效路径 EN: Invalid path */
    InvalidPath = 30,
    /** 角色未找到 EN: Role not found */
    RoleNotFound = 31,
    /** 角色无关联 EN: Roles not related */
    RolesNotRelated = 32,
    /** 权限未找到 EN: Privilege not found */
    PrivilegeNotFound = 33,
    /** 无法回填数组 EN: Cannot backfill array */
    CannotBackfillArray = 34,
    /** 用户修改失败 EN: User modification failed */
    UserModificationFailed = 35,
    /** 检测到远程更改 EN: Remote change detected */
    RemoteChangeDetected = 36,
    /** 文件重命名失败 EN: File rename failed */
    FileRenameFailed = 37,
    /** 文件未打开 EN: File not open */
    FileNotOpen = 38,
    /** 文件流失败 EN: File stream failed */
    FileStreamFailed = 39,
    /** 更新操作符冲突 EN: Conflicting update operators */
    ConflictingUpdateOperators = 40,
    /** 文件已打开 EN: File already open */
    FileAlreadyOpen = 41,
    /** 日志写入失败 EN: Log write failed */
    LogWriteFailed = 42,
    /** 游标未找到 EN: Cursor not found */
    CursorNotFound = 43,

    // 查询和操作错误 (52-70)
    // EN: Query and operation errors (52-70)
    /** 字段名以$开头 EN: Dollar prefixed field name */
    DollarPrefixedFieldName = 52,
    /** 无效的_id字段 EN: Invalid _id field */
    InvalidIdField = 53,
    /** 非单值字段 EN: Not single value field */
    NotSingleValueField = 54,
    /** 无效的DBRef EN: Invalid DBRef */
    InvalidDBRef = 55,
    /** 空字段名 EN: Empty field name */
    EmptyFieldName = 56,
    /** 带点的字段名 EN: Dotted field name */
    DottedFieldName = 57,
    /** 角色数据不一致 EN: Role data inconsistent */
    RoleDataInconsistent = 58,
    /** 命令未找到 EN: Command not found */
    CommandNotFound = 59,
    /** 无进展 EN: No progress made */
    NoProgressMade = 60,
    /** 远程结果不可用 EN: Remote results unavailable */
    RemoteResultsUnavailable = 61,
    /** 写关注失败 EN: Write concern failed */
    WriteConcernFailed = 64,
    /** 发生多个错误 EN: Multiple errors occurred */
    MultipleErrorsOccurred = 65,
    /** 无法创建索引 EN: Cannot create index */
    CannotCreateIndex = 67,
    /** 索引构建中止 EN: Index build aborted */
    IndexBuildAborted = 71,
    /** 无效选项 EN: Invalid options */
    InvalidOptions = 72,
    /** 无效命名空间 EN: Invalid namespace */
    InvalidNamespace = 73,
    /** 索引选项冲突 EN: Index options conflict */
    IndexOptionsConflict = 85,
    /** 索引键规范冲突 EN: Index key specs conflict */
    IndexKeySpecsConflict = 86,
    /** 网络超时 EN: Network timeout */
    NetworkTimeout = 89,
    /** 操作失败 EN: Operation failed */
    OperationFailed = 96,

    // 事务/MVCC 错误
    // EN: Transaction/MVCC errors
    /** 会话不存在 EN: No such session */
    NoSuchSession = 206,
    /** 事务过旧 EN: Transaction too old */
    TransactionTooOld = 225,
    /** 事务不存在 EN: No such transaction */
    NoSuchTransaction = 251,
    /** 事务已提交 EN: Transaction committed */
    TransactionCommitted = 256,
    /** 事务已中止 EN: Transaction aborted */
    TransactionAborted = 263,

    // 写错误
    // EN: Write errors
    /** 重复键 EN: Duplicate key */
    DuplicateKey = 11000,
    /** 非主节点 EN: Not writable primary */
    NotWritablePrimary = 10107,

    // 文档相关
    // EN: Document related
    /** 文档过大 EN: Document too large */
    DocumentTooLarge = 17419,
    /** 文档验证失败 EN: Document validation failure */
    DocumentValidationFailure = 121,
}

/**
 * 错误码名称映射
 * EN: Error code name mapping
 */
export const errorCodeNames: Map<ErrorCode, string> = new Map([
    [ErrorCode.OK, 'OK'],
    [ErrorCode.InternalError, 'InternalError'],
    [ErrorCode.BadValue, 'BadValue'],
    [ErrorCode.NoSuchKey, 'NoSuchKey'],
    [ErrorCode.GraphContainsCycle, 'GraphContainsCycle'],
    [ErrorCode.HostUnreachable, 'HostUnreachable'],
    [ErrorCode.HostNotFound, 'HostNotFound'],
    [ErrorCode.UnknownError, 'UnknownError'],
    [ErrorCode.FailedToParse, 'FailedToParse'],
    [ErrorCode.CannotMutateObject, 'CannotMutateObject'],
    [ErrorCode.UserNotFound, 'UserNotFound'],
    [ErrorCode.UnsupportedFormat, 'UnsupportedFormat'],
    [ErrorCode.Unauthorized, 'Unauthorized'],
    [ErrorCode.TypeMismatch, 'TypeMismatch'],
    [ErrorCode.Overflow, 'Overflow'],
    [ErrorCode.InvalidLength, 'InvalidLength'],
    [ErrorCode.ProtocolError, 'ProtocolError'],
    [ErrorCode.AuthenticationFailed, 'AuthenticationFailed'],
    [ErrorCode.CannotReuseObject, 'CannotReuseObject'],
    [ErrorCode.IllegalOperation, 'IllegalOperation'],
    [ErrorCode.EmptyArrayOperation, 'EmptyArrayOperation'],
    [ErrorCode.InvalidBSON, 'InvalidBSON'],
    [ErrorCode.NamespaceNotFound, 'NamespaceNotFound'],
    [ErrorCode.IndexNotFound, 'IndexNotFound'],
    [ErrorCode.PathNotViable, 'PathNotViable'],
    [ErrorCode.NonExistentPath, 'NonExistentPath'],
    [ErrorCode.InvalidPath, 'InvalidPath'],
    [ErrorCode.RoleNotFound, 'RoleNotFound'],
    [ErrorCode.RolesNotRelated, 'RolesNotRelated'],
    [ErrorCode.PrivilegeNotFound, 'PrivilegeNotFound'],
    [ErrorCode.CannotBackfillArray, 'CannotBackfillArray'],
    [ErrorCode.UserModificationFailed, 'UserModificationFailed'],
    [ErrorCode.RemoteChangeDetected, 'RemoteChangeDetected'],
    [ErrorCode.FileRenameFailed, 'FileRenameFailed'],
    [ErrorCode.FileNotOpen, 'FileNotOpen'],
    [ErrorCode.FileStreamFailed, 'FileStreamFailed'],
    [ErrorCode.ConflictingUpdateOperators, 'ConflictingUpdateOperators'],
    [ErrorCode.FileAlreadyOpen, 'FileAlreadyOpen'],
    [ErrorCode.LogWriteFailed, 'LogWriteFailed'],
    [ErrorCode.CursorNotFound, 'CursorNotFound'],
    [ErrorCode.DollarPrefixedFieldName, 'DollarPrefixedFieldName'],
    [ErrorCode.InvalidIdField, 'InvalidIdField'],
    [ErrorCode.NotSingleValueField, 'NotSingleValueField'],
    [ErrorCode.InvalidDBRef, 'InvalidDBRef'],
    [ErrorCode.EmptyFieldName, 'EmptyFieldName'],
    [ErrorCode.DottedFieldName, 'DottedFieldName'],
    [ErrorCode.RoleDataInconsistent, 'RoleDataInconsistent'],
    [ErrorCode.CommandNotFound, 'CommandNotFound'],
    [ErrorCode.NoProgressMade, 'NoProgressMade'],
    [ErrorCode.RemoteResultsUnavailable, 'RemoteResultsUnavailable'],
    [ErrorCode.WriteConcernFailed, 'WriteConcernFailed'],
    [ErrorCode.MultipleErrorsOccurred, 'MultipleErrorsOccurred'],
    [ErrorCode.CannotCreateIndex, 'CannotCreateIndex'],
    [ErrorCode.IndexBuildAborted, 'IndexBuildAborted'],
    [ErrorCode.InvalidOptions, 'InvalidOptions'],
    [ErrorCode.InvalidNamespace, 'InvalidNamespace'],
    [ErrorCode.IndexOptionsConflict, 'IndexOptionsConflict'],
    [ErrorCode.IndexKeySpecsConflict, 'IndexKeySpecsConflict'],
    [ErrorCode.NetworkTimeout, 'NetworkTimeout'],
    [ErrorCode.OperationFailed, 'OperationFailed'],
    [ErrorCode.NoSuchSession, 'NoSuchSession'],
    [ErrorCode.TransactionTooOld, 'TransactionTooOld'],
    [ErrorCode.NoSuchTransaction, 'NoSuchTransaction'],
    [ErrorCode.TransactionCommitted, 'TransactionCommitted'],
    [ErrorCode.TransactionAborted, 'TransactionAborted'],
    [ErrorCode.DuplicateKey, 'DuplicateKey'],
    [ErrorCode.NotWritablePrimary, 'NotWritablePrimary'],
    [ErrorCode.DocumentTooLarge, 'DocumentTooLarge'],
    [ErrorCode.DocumentValidationFailure, 'DocumentValidationFailure'],
]);

/**
 * 获取错误码名称
 * EN: Get error code name
 */
export function getErrorCodeName(code: ErrorCode): string {
    return errorCodeNames.get(code) ?? 'UnknownError';
}

/**
 * ErrorCode 枚举的别名（用于兼容性）
 * EN: Alias for ErrorCode enum (for compatibility)
 */
export const ErrorCodes = ErrorCode;

/**
 * 添加 CommandNotSupported 别名
 * EN: Add CommandNotSupported alias
 */
// @ts-ignore - 向枚举添加额外属性 EN: Adding extra property to enum
ErrorCode['CommandNotSupported'] = ErrorCode.CommandNotFound;
