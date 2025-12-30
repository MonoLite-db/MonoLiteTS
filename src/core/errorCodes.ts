// Created by Yanjunhui

/**
 * MongoDB-compatible error codes (aligned with Go version)
 * Reference: https://github.com/mongodb/mongo/blob/master/src/mongo/base/error_codes.yml
 */
export enum ErrorCode {
    // General errors (1-99)
    OK = 0,
    InternalError = 1,
    BadValue = 2,
    NoSuchKey = 4,
    GraphContainsCycle = 5,
    HostUnreachable = 6,
    HostNotFound = 7,
    UnknownError = 8,
    FailedToParse = 9,
    CannotMutateObject = 10,
    UserNotFound = 11,
    UnsupportedFormat = 12,
    Unauthorized = 13,
    TypeMismatch = 14,
    Overflow = 15,
    InvalidLength = 16,
    ProtocolError = 17,
    AuthenticationFailed = 18,
    CannotReuseObject = 19,
    IllegalOperation = 20,
    EmptyArrayOperation = 21,
    InvalidBSON = 22,

    // Command errors (26-50)
    NamespaceNotFound = 26,
    IndexNotFound = 27,
    PathNotViable = 28,
    NonExistentPath = 29,
    InvalidPath = 30,
    RoleNotFound = 31,
    RolesNotRelated = 32,
    PrivilegeNotFound = 33,
    CannotBackfillArray = 34,
    UserModificationFailed = 35,
    RemoteChangeDetected = 36,
    FileRenameFailed = 37,
    FileNotOpen = 38,
    FileStreamFailed = 39,
    ConflictingUpdateOperators = 40,
    FileAlreadyOpen = 41,
    LogWriteFailed = 42,
    CursorNotFound = 43,

    // Query and operation errors (52-70)
    DollarPrefixedFieldName = 52,
    InvalidIdField = 53,
    NotSingleValueField = 54,
    InvalidDBRef = 55,
    EmptyFieldName = 56,
    DottedFieldName = 57,
    RoleDataInconsistent = 58,
    CommandNotFound = 59,
    NoProgressMade = 60,
    RemoteResultsUnavailable = 61,
    WriteConcernFailed = 64,
    MultipleErrorsOccurred = 65,
    CannotCreateIndex = 67,
    IndexBuildAborted = 71,
    InvalidOptions = 72,
    InvalidNamespace = 73,
    IndexOptionsConflict = 85,
    IndexKeySpecsConflict = 86,
    NetworkTimeout = 89,
    OperationFailed = 96,

    // Transaction/MVCC errors
    NoSuchSession = 206,
    TransactionTooOld = 225,
    NoSuchTransaction = 251,
    TransactionCommitted = 256,
    TransactionAborted = 263,

    // Write errors
    DuplicateKey = 11000,
    NotWritablePrimary = 10107,

    // Document related
    DocumentTooLarge = 17419,
    DocumentValidationFailure = 121,
}

/**
 * Error code name mapping
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
 * Get error code name
 */
export function getErrorCodeName(code: ErrorCode): string {
    return errorCodeNames.get(code) ?? 'UnknownError';
}

/**
 * Alias for ErrorCode enum (for compatibility)
 */
export const ErrorCodes = ErrorCode;

/**
 * Add CommandNotSupported alias
 */
// @ts-ignore - Adding extra property to enum
ErrorCode['CommandNotSupported'] = ErrorCode.CommandNotFound;
