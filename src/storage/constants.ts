// Created by Yanjunhui

/**
 * Storage layer constants (aligned with Go version)
 */

// File magic number: "MONO" in little-endian (aligned with Go: 0x4D4F4E4F)
export const FILE_MAGIC = 0x4d4f4e4f;

// Current file format version
export const FILE_VERSION = 1;

// Page size in bytes (4KB)
export const PAGE_SIZE = 4096;

// File header size (64 bytes, aligned with Go)
export const FILE_HEADER_SIZE = 64;

// Invalid page ID (sentinel value, aligned with Go: 0 means nil)
export const INVALID_PAGE_ID = 0;

// Maximum document size (16MB, MongoDB limit)
export const MAX_DOCUMENT_SIZE = 16 * 1024 * 1024;

// Maximum message size (48MB)
export const MAX_MESSAGE_SIZE = 48 * 1024 * 1024;

// Maximum BSON nesting depth
export const MAX_BSON_DEPTH = 100;

// Page types (aligned with Go version)
export enum PageType {
    Free = 0x00,        // PageTypeFree
    Meta = 0x01,        // PageTypeMeta
    Catalog = 0x02,     // PageTypeCatalog
    Data = 0x03,        // PageTypeData
    Index = 0x04,       // PageTypeIndex
    Overflow = 0x05,    // PageTypeOverflow
    FreeList = 0x06,    // PageTypeFreeList
    // BTree aliases for backward compatibility with btree.ts
    BTreeLeaf = 0x07,       // BTree leaf node
    BTreeInternal = 0x08,   // BTree internal node
}

// Page header size (24 bytes, aligned with Go)
// Layout: PageId(4) + Type(1) + Flags(1) + ItemCount(2) + FreeSpace(2) + NextPageId(4) + PrevPageId(4) + Checksum(4) + Reserved(2)
export const PAGE_HEADER_SIZE = 24;

// Maximum page data size
export const MAX_PAGE_DATA = PAGE_SIZE - PAGE_HEADER_SIZE;

// SlottedPage slot size (6 bytes, aligned with Go: offset(2) + length(2) + flags(2))
export const SLOT_SIZE = 6;

// Slot flags
export const SLOT_FLAG_DELETED = 0x01;

// BTree constants
export const BTREE_ORDER = 50; // Aligned with Go/Swift
export const BTREE_MIN_KEYS = Math.floor((BTREE_ORDER - 1) / 2);
export const BTREE_NODE_HEADER_SIZE = 11;
export const BTREE_NODE_MAX_BYTES = MAX_PAGE_DATA - 64;
export const BTREE_NODE_SPLIT_THRESHOLD = Math.floor(BTREE_NODE_MAX_BYTES * 3 / 4);

// WAL constants (aligned with Go)
export const WAL_MAGIC = 0x57414c4d; // "WALM" in little-endian
export const WAL_HEADER_SIZE = 32;
export const WAL_RECORD_HEADER_SIZE = 20; // LSN(8) + Type(1) + Flags(1) + DataLen(2) + PageId(4) + Checksum(4)
export const WAL_RECORD_ALIGN = 8;
export const WAL_TRUNCATE_THRESHOLD = 64 * 1024 * 1024; // 64MB
export const WAL_MIN_RETAIN_SIZE = 4 * 1024 * 1024; // 4MB

// Cache constants
export const DEFAULT_CACHE_SIZE = 1000; // Default page cache size

// Timeout constants (in milliseconds)
export const DEFAULT_LOCK_TIMEOUT = 30000; // 30 seconds
export const DEFAULT_SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
export const DEFAULT_CURSOR_TIMEOUT = 10 * 60 * 1000; // 10 minutes
export const DEFAULT_READ_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Legacy exports for backward compatibility
export const HEADER_SIZE = FILE_HEADER_SIZE;
export const SLOTTED_PAGE_HEADER_SIZE = PAGE_HEADER_SIZE;
