// Created by Yanjunhui

/**
 * 存储层常量（与 Go 版本对齐）
 * EN: Storage layer constants (aligned with Go version)
 */

// 文件魔数："MONO" 小端序（与 Go 对齐：0x4D4F4E4F）
// EN: File magic number: "MONO" in little-endian (aligned with Go: 0x4D4F4E4F)
export const FILE_MAGIC = 0x4d4f4e4f;

// 当前文件格式版本
// EN: Current file format version
export const FILE_VERSION = 1;

// 页面大小（4KB）
// EN: Page size in bytes (4KB)
export const PAGE_SIZE = 4096;

// 文件头大小（64 字节，与 Go 对齐）
// EN: File header size (64 bytes, aligned with Go)
export const FILE_HEADER_SIZE = 64;

// 无效页面 ID（哨兵值，与 Go 对齐：0 表示 nil）
// EN: Invalid page ID (sentinel value, aligned with Go: 0 means nil)
export const INVALID_PAGE_ID = 0;

// 最大文档大小（16MB，MongoDB 限制）
// EN: Maximum document size (16MB, MongoDB limit)
export const MAX_DOCUMENT_SIZE = 16 * 1024 * 1024;

// 最大消息大小（48MB）
// EN: Maximum message size (48MB)
export const MAX_MESSAGE_SIZE = 48 * 1024 * 1024;

// 最大 BSON 嵌套深度
// EN: Maximum BSON nesting depth
export const MAX_BSON_DEPTH = 100;

/**
 * 页面类型（与 Go 版本对齐）
 * EN: Page types (aligned with Go version)
 */
export enum PageType {
    /** 空闲页 EN: Free page */
    Free = 0x00,
    /** 元数据页 EN: Meta page */
    Meta = 0x01,
    /** 目录页 EN: Catalog page */
    Catalog = 0x02,
    /** 数据页 EN: Data page */
    Data = 0x03,
    /** 索引页 EN: Index page */
    Index = 0x04,
    /** 溢出页 EN: Overflow page */
    Overflow = 0x05,
    /** 空闲列表页 EN: Free list page */
    FreeList = 0x06,
    /** B树叶节点（向后兼容 btree.ts）EN: BTree leaf node */
    BTreeLeaf = 0x07,
    /** B树内部节点 EN: BTree internal node */
    BTreeInternal = 0x08,
}

// 页面头大小（24 字节，与 Go 对齐）
// EN: Page header size (24 bytes, aligned with Go)
// 布局：PageId(4) + Type(1) + Flags(1) + ItemCount(2) + FreeSpace(2) + NextPageId(4) + PrevPageId(4) + Checksum(4) + Reserved(2)
// EN: Layout: PageId(4) + Type(1) + Flags(1) + ItemCount(2) + FreeSpace(2) + NextPageId(4) + PrevPageId(4) + Checksum(4) + Reserved(2)
export const PAGE_HEADER_SIZE = 24;

// 最大页面数据大小
// EN: Maximum page data size
export const MAX_PAGE_DATA = PAGE_SIZE - PAGE_HEADER_SIZE;

// SlottedPage 槽大小（6 字节，与 Go 对齐：offset(2) + length(2) + flags(2)）
// EN: SlottedPage slot size (6 bytes, aligned with Go: offset(2) + length(2) + flags(2))
export const SLOT_SIZE = 6;

// 槽标志
// EN: Slot flags
export const SLOT_FLAG_DELETED = 0x01;

// B树常量
// EN: BTree constants
/** B树阶数（与 Go/Swift 对齐）EN: BTree order (aligned with Go/Swift) */
export const BTREE_ORDER = 50;
/** B树最小键数 EN: BTree minimum keys */
export const BTREE_MIN_KEYS = Math.floor((BTREE_ORDER - 1) / 2);
/** B树节点头大小 EN: BTree node header size */
export const BTREE_NODE_HEADER_SIZE = 11;
/** B树节点最大字节数 EN: BTree node max bytes */
export const BTREE_NODE_MAX_BYTES = MAX_PAGE_DATA - 64;
/** B树节点分裂阈值 EN: BTree node split threshold */
export const BTREE_NODE_SPLIT_THRESHOLD = Math.floor(BTREE_NODE_MAX_BYTES * 3 / 4);

// WAL 常量（与 Go 对齐）
// EN: WAL constants (aligned with Go)
/** WAL 魔数："WALM" 小端序 EN: WAL magic number: "WALM" in little-endian */
export const WAL_MAGIC = 0x57414c4d;
/** WAL 头大小 EN: WAL header size */
export const WAL_HEADER_SIZE = 32;
/** WAL 记录头大小：LSN(8) + Type(1) + Flags(1) + DataLen(2) + PageId(4) + Checksum(4) */
/** EN: WAL record header size */
export const WAL_RECORD_HEADER_SIZE = 20;
/** WAL 记录对齐 EN: WAL record alignment */
export const WAL_RECORD_ALIGN = 8;
/** WAL 截断阈值（64MB）EN: WAL truncate threshold (64MB) */
export const WAL_TRUNCATE_THRESHOLD = 64 * 1024 * 1024;
/** WAL 最小保留大小（4MB）EN: WAL minimum retain size (4MB) */
export const WAL_MIN_RETAIN_SIZE = 4 * 1024 * 1024;

// 缓存常量
// EN: Cache constants
/** 默认页面缓存大小 EN: Default page cache size */
export const DEFAULT_CACHE_SIZE = 1000;

// 超时常量（毫秒）
// EN: Timeout constants (in milliseconds)
/** 默认锁超时（30 秒）EN: Default lock timeout (30 seconds) */
export const DEFAULT_LOCK_TIMEOUT = 30000;
/** 默认会话超时（30 分钟）EN: Default session timeout (30 minutes) */
export const DEFAULT_SESSION_TIMEOUT = 30 * 60 * 1000;
/** 默认游标超时（10 分钟）EN: Default cursor timeout (10 minutes) */
export const DEFAULT_CURSOR_TIMEOUT = 10 * 60 * 1000;
/** 默认读超时（5 分钟）EN: Default read timeout (5 minutes) */
export const DEFAULT_READ_TIMEOUT = 5 * 60 * 1000;

// 遗留导出（向后兼容）
// EN: Legacy exports for backward compatibility
export const HEADER_SIZE = FILE_HEADER_SIZE;
export const SLOTTED_PAGE_HEADER_SIZE = PAGE_HEADER_SIZE;
