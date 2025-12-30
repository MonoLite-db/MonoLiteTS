// Created by Yanjunhui

/**
 * MonoLite limits and constraints (aligned with Go version)
 */

// Document limits
export const MAX_DOCUMENT_SIZE = 16 * 1024 * 1024; // 16MB
export const MAX_BSON_DEPTH = 100;

// Namespace limits
export const MAX_NAMESPACE_LENGTH = 255;
export const MAX_DATABASE_NAME_LENGTH = 64;
export const MAX_COLLECTION_NAME_LENGTH = 255;
export const MAX_INDEX_NAME_LENGTH = 128;

// Index limits
export const MAX_INDEX_KEY_LENGTH = 1024;
export const MAX_COMPOUND_INDEX_KEYS = 32;
export const MAX_INDEXES_PER_COLLECTION = 64;

// Query limits
export const DEFAULT_BATCH_SIZE = 101;
export const MAX_BATCH_SIZE = 100000;
export const DEFAULT_CURSOR_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Transaction limits
export const DEFAULT_LOCK_TIMEOUT_MS = 30 * 1000; // 30 seconds
export const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const MAX_TRANSACTION_OPERATIONS = 100000;

// Wire protocol limits
export const MAX_MESSAGE_SIZE = 48 * 1024 * 1024; // 48MB
export const MAX_WRITE_BATCH_SIZE = 100000;

// Internal limits
export const MAX_SORT_BYTES = 32 * 1024 * 1024; // 32MB
export const MAX_AGGREGATION_MEMORY = 100 * 1024 * 1024; // 100MB

/**
 * Validate namespace format
 */
export function validateNamespace(namespace: string): { valid: boolean; error?: string } {
    if (!namespace || namespace.length === 0) {
        return { valid: false, error: 'namespace cannot be empty' };
    }

    if (namespace.length > MAX_NAMESPACE_LENGTH) {
        return { valid: false, error: `namespace too long: ${namespace.length} > ${MAX_NAMESPACE_LENGTH}` };
    }

    // Must contain a dot
    const dotIndex = namespace.indexOf('.');
    if (dotIndex === -1) {
        return { valid: false, error: 'namespace must contain a dot' };
    }

    const dbName = namespace.substring(0, dotIndex);
    const collName = namespace.substring(dotIndex + 1);

    // Validate database name
    const dbValidation = validateDatabaseName(dbName);
    if (!dbValidation.valid) {
        return dbValidation;
    }

    // Validate collection name
    const collValidation = validateCollectionName(collName);
    if (!collValidation.valid) {
        return collValidation;
    }

    return { valid: true };
}

/**
 * Validate database name
 */
export function validateDatabaseName(name: string): { valid: boolean; error?: string } {
    if (!name || name.length === 0) {
        return { valid: false, error: 'database name cannot be empty' };
    }

    if (name.length > MAX_DATABASE_NAME_LENGTH) {
        return { valid: false, error: `database name too long: ${name.length} > ${MAX_DATABASE_NAME_LENGTH}` };
    }

    // Check for invalid characters
    const invalidChars = /[\/\\. "$*<>:|?]/;
    if (invalidChars.test(name)) {
        return { valid: false, error: 'database name contains invalid characters' };
    }

    return { valid: true };
}

/**
 * Validate collection name
 */
export function validateCollectionName(name: string): { valid: boolean; error?: string } {
    if (!name || name.length === 0) {
        return { valid: false, error: 'collection name cannot be empty' };
    }

    if (name.length > MAX_COLLECTION_NAME_LENGTH) {
        return { valid: false, error: `collection name too long: ${name.length} > ${MAX_COLLECTION_NAME_LENGTH}` };
    }

    // Cannot start with system.
    if (name.startsWith('system.')) {
        return { valid: false, error: 'collection names cannot start with "system."' };
    }

    // Cannot contain $
    if (name.includes('$')) {
        return { valid: false, error: 'collection names cannot contain "$"' };
    }

    // Cannot be empty string
    if (name.trim().length === 0) {
        return { valid: false, error: 'collection name cannot be empty or whitespace' };
    }

    return { valid: true };
}

/**
 * Validate index name
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
