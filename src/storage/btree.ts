// Created by Yanjunhui

import { PageType, INVALID_PAGE_ID, BTREE_ORDER, BTREE_MIN_KEYS } from './constants';
import { SlottedPage } from './page';
import { Pager } from './pager';
import { DataEndian } from './dataEndian';

/**
 * B+ 树节点元数据（存储在页面中）
 * // EN: BTree node metadata stored in page
 *
 * 布局（在第一个槽位的开头）：
 * // EN: Layout (at start of first slot):
 * - isLeaf: 1 字节 / 1 byte
 * - keyCount: 2 字节 / 2 bytes
 * - parent: 4 字节 / 4 bytes
 * - prev: 4 字节（仅叶节点，用于范围扫描）/ 4 bytes (leaf only, for range scan)
 * - next: 4 字节（仅叶节点，用于范围扫描）/ 4 bytes (leaf only, for range scan)
 */
const NODE_META_SIZE = 15;

/**
 * B+ 树节点结构（内存表示）
 * // EN: BTree node structure (in-memory representation)
 */
export interface BTreeNode {
    pageId: number;
    isLeaf: boolean;
    keyCount: number;
    /** 父节点 ID // EN: Parent node ID */
    parent: number;
    /** 前一个叶节点（用于范围扫描）// EN: Previous leaf (for range scan) */
    prev: number;
    /** 后一个叶节点（用于范围扫描）// EN: Next leaf (for range scan) */
    next: number;
    /** 键数组 // EN: Keys array */
    keys: Buffer[];
    /** 值数组（叶节点：实际值；内部节点：空）// EN: For leaf nodes: actual values; for internal: empty */
    values: Buffer[];
    /** 子节点 ID 数组（仅内部节点）// EN: For internal nodes: child page IDs */
    children: number[];
}

/**
 * B+ 树实现（与 Go 版本对齐）
 * // EN: B+Tree implementation (aligned with Go version)
 *
 * 功能：
 * - 支持可变长度的键和值
 * - 叶节点形成双向链表，用于范围扫描
 * - 自动分裂和合并
 * // EN: Features:
 * - Supports variable-length keys and values
 * - Leaf nodes form a doubly-linked list for range scans
 * - Automatic splitting and merging
 */
export class BTree {
    private pager: Pager;
    private rootPageId: number;
    private comparator: (a: Buffer, b: Buffer) => number;

    constructor(
        pager: Pager,
        rootPageId: number,
        comparator?: (a: Buffer, b: Buffer) => number
    ) {
        this.pager = pager;
        this.rootPageId = rootPageId;
        this.comparator = comparator ?? BTree.defaultComparator;
    }

    /**
     * 默认键比较器（字典序）
     * // EN: Default key comparator (lexicographic)
     */
    static defaultComparator(a: Buffer, b: Buffer): number {
        return Buffer.compare(a, b);
    }

    /**
     * 创建一个新的空 B+ 树
     * // EN: Create a new empty BTree
     */
    static async create(pager: Pager): Promise<BTree> {
        const rootPage = await pager.allocPage(PageType.BTreeLeaf);
        const rootNode: BTreeNode = {
            pageId: rootPage.getPageId(),
            isLeaf: true,
            keyCount: 0,
            parent: INVALID_PAGE_ID,
            prev: INVALID_PAGE_ID,
            next: INVALID_PAGE_ID,
            keys: [],
            values: [],
            children: [],
        };
        await BTree.writeNode(pager, rootPage, rootNode);
        return new BTree(pager, rootPage.getPageId());
    }

    /**
     * 获取根页面 ID
     * // EN: Get root page ID
     */
    getRootPageId(): number {
        return this.rootPageId;
    }

    /**
     * 搜索键
     * // EN: Search for a key
     */
    async search(key: Buffer): Promise<Buffer | null> {
        const node = await this.findLeaf(key);
        const idx = this.findKeyIndex(node, key);
        if (idx < node.keyCount && this.comparator(node.keys[idx], key) === 0) {
            return node.values[idx];
        }
        return null;
    }

    /**
     * 插入键值对
     * // EN: Insert a key-value pair
     */
    async insert(key: Buffer, value: Buffer): Promise<void> {
        let node = await this.findLeaf(key);
        const idx = this.findKeyIndex(node, key);

        // 检查重复 // EN: Check for duplicate
        if (idx < node.keyCount && this.comparator(node.keys[idx], key) === 0) {
            // 更新现有值 // EN: Update existing
            node.values[idx] = value;
            await this.writeNodeToPage(node);
            return;
        }

        // 在位置插入 // EN: Insert at position
        node.keys.splice(idx, 0, key);
        node.values.splice(idx, 0, value);
        node.keyCount++;

        // 检查是否需要分裂 // EN: Check if split needed
        if (node.keyCount >= BTREE_ORDER) {
            await this.splitNode(node);
        } else {
            await this.writeNodeToPage(node);
        }
    }

    /**
     * 删除键
     * // EN: Delete a key
     */
    async delete(key: Buffer): Promise<boolean> {
        const node = await this.findLeaf(key);
        const idx = this.findKeyIndex(node, key);

        if (idx >= node.keyCount || this.comparator(node.keys[idx], key) !== 0) {
            return false; // 未找到键 // EN: Key not found
        }

        // 移除键值对 // EN: Remove key-value
        node.keys.splice(idx, 1);
        node.values.splice(idx, 1);
        node.keyCount--;

        // 处理下溢 // EN: Handle underflow
        if (node.pageId !== this.rootPageId && node.keyCount < BTREE_MIN_KEYS) {
            await this.handleUnderflow(node);
        } else {
            await this.writeNodeToPage(node);
        }

        return true;
    }

    /**
     * 范围搜索 [startKey, endKey)
     * // EN: Range search [startKey, endKey)
     */
    async searchRange(startKey: Buffer | null, endKey: Buffer | null): Promise<Buffer[]> {
        const results: Buffer[] = [];

        let node: BTreeNode;
        if (startKey) {
            node = await this.findLeaf(startKey);
        } else {
            // 从最左边的叶子节点开始 // EN: Start from leftmost leaf
            node = await this.findLeftmostLeaf();
        }

        // 遍历叶子节点 // EN: Traverse leaves
        outer: while (true) {
            for (let i = 0; i < node.keyCount; i++) {
                if (startKey && this.comparator(node.keys[i], startKey) < 0) {
                    continue;
                }
                if (endKey && this.comparator(node.keys[i], endKey) >= 0) {
                    break outer;
                }
                results.push(node.values[i]);
            }

            if (node.next === INVALID_PAGE_ID) {
                break;
            }
            node = await this.readNode(node.next);
        }

        return results;
    }

    /**
     * 获取所有值
     * // EN: Get all values
     */
    async getAll(): Promise<Buffer[]> {
        return this.searchRange(null, null);
    }

    /**
     * 计算所有键的数量
     * // EN: Count all keys
     */
    async count(): Promise<number> {
        let count = 0;
        let node = await this.findLeftmostLeaf();

        while (true) {
            count += node.keyCount;
            if (node.next === INVALID_PAGE_ID) {
                break;
            }
            node = await this.readNode(node.next);
        }

        return count;
    }

    /**
     * 查找应该包含该键的叶子节点
     * // EN: Find the leaf node that should contain the key
     */
    private async findLeaf(key: Buffer): Promise<BTreeNode> {
        let node = await this.readNode(this.rootPageId);

        while (!node.isLeaf) {
            const idx = this.findKeyIndex(node, key);
            const childIdx = Math.min(idx, node.children.length - 1);
            node = await this.readNode(node.children[childIdx]);
        }

        return node;
    }

    /**
     * 查找最左边的叶子节点
     * // EN: Find leftmost leaf node
     */
    private async findLeftmostLeaf(): Promise<BTreeNode> {
        let node = await this.readNode(this.rootPageId);

        while (!node.isLeaf) {
            node = await this.readNode(node.children[0]);
        }

        return node;
    }

    /**
     * 查找键应该插入的索引位置
     * // EN: Find index where key should be inserted
     */
    private findKeyIndex(node: BTreeNode, key: Buffer): number {
        let lo = 0;
        let hi = node.keyCount;

        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.comparator(node.keys[mid], key) < 0) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }

        return lo;
    }

    /**
     * 计算节点的字节大小（与 Go 版本对齐）
     * 用于基于字节的分裂点计算
     * // EN: Calculate the byte size of a node (aligned with Go version)
     * // EN: Used for byte-driven split point calculation
     */
    private calculateNodeByteSize(node: BTreeNode): number {
        // 头部：isLeaf(1) + keyCount(2) + parent(4) + prev(4) + next(4) = 15
        // EN: Header: isLeaf(1) + keyCount(2) + parent(4) + prev(4) + next(4) = 15
        const headerSize = 15;
        let size = headerSize;

        for (let i = 0; i < node.keyCount; i++) {
            // Key: 2 bytes length + key data
            size += 2 + node.keys[i].length;

            if (node.isLeaf) {
                // Value: 2 bytes length + value data
                size += 2 + node.values[i].length;
            }
        }

        if (!node.isLeaf) {
            // Children: 4 bytes each
            size += node.children.length * 4;
        }

        return size;
    }

    /**
     * 查找基于字节的分裂点（与 Go 版本对齐）
     * 返回平衡左右字节大小的分裂索引
     * // EN: Find byte-driven split point (aligned with Go version)
     * // EN: Returns split index that balances left/right byte sizes
     */
    private findByteDrivenSplitPoint(node: BTreeNode): number {
        if (node.keyCount <= 1) {
            return 0;
        }

        // 计算总大小 // EN: Calculate total size
        const totalSize = this.calculateNodeByteSize(node);
        const targetSize = Math.floor(totalSize / 2);

        // 从开始累积，找到最接近目标的分裂点
        // EN: Accumulate from start to find split point closest to target
        const headerSize = 15;
        let leftSize = headerSize;
        let bestMid = Math.floor(node.keyCount / 2); // 默认为中点 // EN: Default to midpoint

        for (let i = 0; i < node.keyCount; i++) {
            leftSize += 2 + node.keys[i].length;
            if (node.isLeaf) {
                leftSize += 2 + node.values[i].length;
            } else if (i < node.children.length) {
                leftSize += 4;
            }

            // 检查是否达到/接近目标 // EN: Check if we've reached/approached the target
            if (leftSize >= targetSize) {
                // 确保分裂点在 1 和 keyCount-1 之间
                // EN: Ensure split point is between 1 and keyCount-1
                if (i < 1) {
                    bestMid = 1;
                } else if (i >= node.keyCount - 1) {
                    bestMid = node.keyCount - 1;
                } else {
                    bestMid = i;
                }
                break;
            }
        }

        // 确保分裂点有效 // EN: Ensure split point is valid
        if (bestMid < 1) {
            bestMid = 1;
        }
        if (bestMid >= node.keyCount) {
            bestMid = node.keyCount - 1;
        }

        return bestMid;
    }

    /**
     * 当节点溢出时分裂节点
     * 使用基于字节的分裂点计算（与 Go 版本对齐）
     * // EN: Split a node when it overflows
     * // EN: Uses byte-driven split point calculation (aligned with Go version)
     */
    private async splitNode(node: BTreeNode): Promise<void> {
        // 使用基于字节的分裂点而不是简单的中点
        // EN: Use byte-driven split point instead of simple midpoint
        const midIdx = this.findByteDrivenSplitPoint(node);

        // 创建新的右节点 // EN: Create new right node
        const rightPage = await this.pager.allocPage(
            node.isLeaf ? PageType.BTreeLeaf : PageType.BTreeInternal
        );

        const rightNode: BTreeNode = {
            pageId: rightPage.getPageId(),
            isLeaf: node.isLeaf,
            keyCount: node.keyCount - midIdx - (node.isLeaf ? 0 : 1),
            parent: node.parent,
            prev: node.isLeaf ? node.pageId : INVALID_PAGE_ID,
            next: node.isLeaf ? node.next : INVALID_PAGE_ID,
            keys: node.isLeaf ? node.keys.slice(midIdx) : node.keys.slice(midIdx + 1),
            values: node.isLeaf ? node.values.slice(midIdx) : [],
            children: node.isLeaf ? [] : node.children.slice(midIdx + 1),
        };

        // Update left node
        const promoteKey = node.keys[midIdx];
        node.keyCount = midIdx;
        node.keys = node.keys.slice(0, midIdx);
        if (node.isLeaf) {
            node.values = node.values.slice(0, midIdx);
            node.next = rightNode.pageId;
        } else {
            node.children = node.children.slice(0, midIdx + 1);
        }

        // Update next leaf's prev pointer
        if (node.isLeaf && rightNode.next !== INVALID_PAGE_ID) {
            const nextNode = await this.readNode(rightNode.next);
            nextNode.prev = rightNode.pageId;
            await this.writeNodeToPage(nextNode);
        }

        // Update children's parent pointers
        if (!rightNode.isLeaf) {
            for (const childId of rightNode.children) {
                const child = await this.readNode(childId);
                child.parent = rightNode.pageId;
                await this.writeNodeToPage(child);
            }
        }

        await this.writeNodeToPage(node);
        await this.writeNodeToPage(rightNode);

        // Insert into parent
        if (node.parent === INVALID_PAGE_ID) {
            // Create new root
            await this.createNewRoot(node.pageId, promoteKey, rightNode.pageId);
        } else {
            await this.insertIntoParent(node.parent, promoteKey, rightNode.pageId);
        }
    }

    /**
     * Create new root after split
     */
    private async createNewRoot(leftId: number, key: Buffer, rightId: number): Promise<void> {
        const rootPage = await this.pager.allocPage(PageType.BTreeInternal);

        const rootNode: BTreeNode = {
            pageId: rootPage.getPageId(),
            isLeaf: false,
            keyCount: 1,
            parent: INVALID_PAGE_ID,
            prev: INVALID_PAGE_ID,
            next: INVALID_PAGE_ID,
            keys: [key],
            values: [],
            children: [leftId, rightId],
        };

        // Update children's parent
        const leftNode = await this.readNode(leftId);
        leftNode.parent = rootNode.pageId;
        await this.writeNodeToPage(leftNode);

        const rightNode = await this.readNode(rightId);
        rightNode.parent = rootNode.pageId;
        await this.writeNodeToPage(rightNode);

        await this.writeNodeToPage(rootNode);
        this.rootPageId = rootNode.pageId;
    }

    /**
     * Insert into parent node
     */
    private async insertIntoParent(parentId: number, key: Buffer, rightChildId: number): Promise<void> {
        const parent = await this.readNode(parentId);
        const idx = this.findKeyIndex(parent, key);

        parent.keys.splice(idx, 0, key);
        parent.children.splice(idx + 1, 0, rightChildId);
        parent.keyCount++;

        if (parent.keyCount >= BTREE_ORDER) {
            await this.splitNode(parent);
        } else {
            await this.writeNodeToPage(parent);
        }
    }

    /**
     * Handle underflow after deletion
     */
    private async handleUnderflow(node: BTreeNode): Promise<void> {
        // Try to borrow from siblings or merge
        const parent = await this.readNode(node.parent);
        const childIdx = parent.children.indexOf(node.pageId);

        // Try left sibling
        if (childIdx > 0) {
            const leftSibling = await this.readNode(parent.children[childIdx - 1]);
            if (leftSibling.keyCount > BTREE_MIN_KEYS) {
                await this.borrowFromLeft(node, leftSibling, parent, childIdx - 1);
                return;
            }
        }

        // Try right sibling
        if (childIdx < parent.children.length - 1) {
            const rightSibling = await this.readNode(parent.children[childIdx + 1]);
            if (rightSibling.keyCount > BTREE_MIN_KEYS) {
                await this.borrowFromRight(node, rightSibling, parent, childIdx);
                return;
            }
        }

        // Merge with sibling
        if (childIdx > 0) {
            const leftSibling = await this.readNode(parent.children[childIdx - 1]);
            await this.mergeNodes(leftSibling, node, parent, childIdx - 1);
        } else {
            const rightSibling = await this.readNode(parent.children[childIdx + 1]);
            await this.mergeNodes(node, rightSibling, parent, childIdx);
        }
    }

    /**
     * Borrow from left sibling
     */
    private async borrowFromLeft(
        node: BTreeNode,
        leftSibling: BTreeNode,
        parent: BTreeNode,
        parentKeyIdx: number
    ): Promise<void> {
        if (node.isLeaf) {
            // Move last key-value from left to node
            const borrowedKey = leftSibling.keys.pop()!;
            const borrowedValue = leftSibling.values.pop()!;
            node.keys.unshift(borrowedKey);
            node.values.unshift(borrowedValue);
            parent.keys[parentKeyIdx] = node.keys[0];
        } else {
            // Move parent key down, last child of left up
            node.keys.unshift(parent.keys[parentKeyIdx]);
            parent.keys[parentKeyIdx] = leftSibling.keys.pop()!;
            const borrowedChild = leftSibling.children.pop()!;
            node.children.unshift(borrowedChild);

            // Update borrowed child's parent
            const child = await this.readNode(borrowedChild);
            child.parent = node.pageId;
            await this.writeNodeToPage(child);
        }

        leftSibling.keyCount--;
        node.keyCount++;

        await this.writeNodeToPage(leftSibling);
        await this.writeNodeToPage(node);
        await this.writeNodeToPage(parent);
    }

    /**
     * Borrow from right sibling
     */
    private async borrowFromRight(
        node: BTreeNode,
        rightSibling: BTreeNode,
        parent: BTreeNode,
        parentKeyIdx: number
    ): Promise<void> {
        if (node.isLeaf) {
            // Move first key-value from right to node
            const borrowedKey = rightSibling.keys.shift()!;
            const borrowedValue = rightSibling.values.shift()!;
            node.keys.push(borrowedKey);
            node.values.push(borrowedValue);
            parent.keys[parentKeyIdx] = rightSibling.keys[0];
        } else {
            // Move parent key down, first child of right up
            node.keys.push(parent.keys[parentKeyIdx]);
            parent.keys[parentKeyIdx] = rightSibling.keys.shift()!;
            const borrowedChild = rightSibling.children.shift()!;
            node.children.push(borrowedChild);

            // Update borrowed child's parent
            const child = await this.readNode(borrowedChild);
            child.parent = node.pageId;
            await this.writeNodeToPage(child);
        }

        rightSibling.keyCount--;
        node.keyCount++;

        await this.writeNodeToPage(rightSibling);
        await this.writeNodeToPage(node);
        await this.writeNodeToPage(parent);
    }

    /**
     * Merge two sibling nodes
     */
    private async mergeNodes(
        left: BTreeNode,
        right: BTreeNode,
        parent: BTreeNode,
        parentKeyIdx: number
    ): Promise<void> {
        if (left.isLeaf) {
            // Merge leaf nodes
            left.keys.push(...right.keys);
            left.values.push(...right.values);
            left.next = right.next;

            // Update next leaf's prev pointer
            if (right.next !== INVALID_PAGE_ID) {
                const nextNode = await this.readNode(right.next);
                nextNode.prev = left.pageId;
                await this.writeNodeToPage(nextNode);
            }
        } else {
            // Merge internal nodes
            left.keys.push(parent.keys[parentKeyIdx]);
            left.keys.push(...right.keys);
            left.children.push(...right.children);

            // Update children's parent pointers
            for (const childId of right.children) {
                const child = await this.readNode(childId);
                child.parent = left.pageId;
                await this.writeNodeToPage(child);
            }
        }

        left.keyCount = left.keys.length;

        // Remove from parent
        parent.keys.splice(parentKeyIdx, 1);
        parent.children.splice(parentKeyIdx + 1, 1);
        parent.keyCount--;

        // Free right node
        await this.pager.freePage(right.pageId);
        await this.writeNodeToPage(left);

        // Handle parent underflow
        if (parent.pageId === this.rootPageId) {
            if (parent.keyCount === 0) {
                // Root is empty, make left the new root
                this.rootPageId = left.pageId;
                left.parent = INVALID_PAGE_ID;
                await this.writeNodeToPage(left);
                await this.pager.freePage(parent.pageId);
            } else {
                await this.writeNodeToPage(parent);
            }
        } else if (parent.keyCount < BTREE_MIN_KEYS) {
            await this.handleUnderflow(parent);
        } else {
            await this.writeNodeToPage(parent);
        }
    }

    /**
     * Read node from page
     */
    private async readNode(pageId: number): Promise<BTreeNode> {
        const page = await this.pager.readPage(pageId);
        return BTree.parseNode(page);
    }

    /**
     * Write node to its page
     */
    private async writeNodeToPage(node: BTreeNode): Promise<void> {
        const page = SlottedPage.create(node.pageId, node.isLeaf ? PageType.BTreeLeaf : PageType.BTreeInternal);
        await BTree.writeNode(this.pager, page, node);
    }

    /**
     * Parse node from page
     * 
     * BUG-012 FIX: Added consistency checks to detect corrupted nodes
     */
    private static parseNode(page: SlottedPage): BTreeNode {
        const node: BTreeNode = {
            pageId: page.getPageId(),
            isLeaf: page.getPageType() === PageType.BTreeLeaf,
            keyCount: 0,
            parent: INVALID_PAGE_ID,
            prev: INVALID_PAGE_ID,
            next: INVALID_PAGE_ID,
            keys: [],
            values: [],
            children: [],
        };

        const itemCount = page.getItemCount();
        if (itemCount === 0) {
            return node;
        }

        // First slot contains metadata
        const metaData = page.getData(0);
        if (!metaData || metaData.length < NODE_META_SIZE) {
            return node;
        }

        node.isLeaf = metaData[0] === 1;
        node.keyCount = DataEndian.readUInt16LE(metaData, 1);
        node.parent = DataEndian.readUInt32LE(metaData, 3);
        node.prev = DataEndian.readUInt32LE(metaData, 7);
        node.next = DataEndian.readUInt32LE(metaData, 11);

        // Read keys and values/children
        let slotIdx = 1;
        for (let i = 0; i < node.keyCount; i++) {
            const keyData = page.getData(slotIdx++);
            if (keyData) {
                node.keys.push(Buffer.from(keyData));
            }

            if (node.isLeaf) {
                const valueData = page.getData(slotIdx++);
                if (valueData) {
                    node.values.push(Buffer.from(valueData));
                }
            }
        }

        // Read children for internal nodes
        if (!node.isLeaf) {
            const childrenData = page.getData(slotIdx);
            if (childrenData) {
                const numChildren = childrenData.length / 4;
                for (let i = 0; i < numChildren; i++) {
                    node.children.push(DataEndian.readUInt32LE(childrenData, i * 4));
                }
            }
        }

        // BUG-012 FIX: Consistency checks
        if (node.keys.length !== node.keyCount) {
            throw new Error(`BTree node corrupted: keyCount mismatch at page ${page.getPageId()}, expected ${node.keyCount}, got ${node.keys.length}`);
        }
        if (node.isLeaf && node.values.length !== node.keyCount) {
            throw new Error(`BTree leaf node corrupted: values count mismatch at page ${page.getPageId()}, expected ${node.keyCount}, got ${node.values.length}`);
        }
        if (!node.isLeaf && node.keyCount > 0 && node.children.length !== node.keyCount + 1) {
            throw new Error(`BTree internal node corrupted: children count mismatch at page ${page.getPageId()}, expected ${node.keyCount + 1}, got ${node.children.length}`);
        }

        return node;
    }

    /**
     * Write node to page
     */
    private static async writeNode(pager: Pager, page: SlottedPage, node: BTreeNode): Promise<void> {
        // Clear page
        const newPage = SlottedPage.create(node.pageId, node.isLeaf ? PageType.BTreeLeaf : PageType.BTreeInternal);

        // Write metadata
        const metaData = Buffer.alloc(NODE_META_SIZE);
        metaData[0] = node.isLeaf ? 1 : 0;
        DataEndian.writeUInt16LE(metaData, 1, node.keyCount);
        DataEndian.writeUInt32LE(metaData, 3, node.parent);
        DataEndian.writeUInt32LE(metaData, 7, node.prev);
        DataEndian.writeUInt32LE(metaData, 11, node.next);
        newPage.insert(metaData);

        // Write keys and values
        for (let i = 0; i < node.keyCount; i++) {
            newPage.insert(node.keys[i]);
            if (node.isLeaf) {
                newPage.insert(node.values[i]);
            }
        }

        // Write children for internal nodes
        if (!node.isLeaf && node.children.length > 0) {
            const childrenData = Buffer.alloc(node.children.length * 4);
            for (let i = 0; i < node.children.length; i++) {
                DataEndian.writeUInt32LE(childrenData, i * 4, node.children[i]);
            }
            newPage.insert(childrenData);
        }

        await pager.writePage(newPage);
    }

    // ==================== Integrity Verification ====================

    /**
     * Verify tree integrity
     * Returns array of error messages, empty if tree is valid
     */
    async verify(): Promise<string[]> {
        const errors: string[] = [];
        try {
            await this.verifyNode(this.rootPageId, null, null, errors);
            await this.verifyLeafChain(errors);
        } catch (err) {
            errors.push(`Verification failed: ${err}`);
        }
        return errors;
    }

    /**
     * Check tree integrity (throws on error)
     */
    async checkTreeIntegrity(): Promise<void> {
        const errors = await this.verify();
        if (errors.length > 0) {
            throw new Error(`BTree integrity check failed:\n${errors.join('\n')}`);
        }
    }

    /**
     * Verify a node and its subtree
     */
    private async verifyNode(
        pageId: number,
        minKey: Buffer | null,
        maxKey: Buffer | null,
        errors: string[]
    ): Promise<void> {
        const node = await this.readNode(pageId);

        // Check key ordering
        for (let i = 0; i < node.keyCount - 1; i++) {
            if (this.comparator(node.keys[i], node.keys[i + 1]) >= 0) {
                errors.push(`Node ${pageId}: keys not in ascending order at index ${i}`);
            }
        }

        // Check key bounds
        if (minKey !== null && node.keyCount > 0) {
            if (this.comparator(node.keys[0], minKey) < 0) {
                errors.push(`Node ${pageId}: first key less than minimum bound`);
            }
        }
        if (maxKey !== null && node.keyCount > 0) {
            if (this.comparator(node.keys[node.keyCount - 1], maxKey) >= 0) {
                errors.push(`Node ${pageId}: last key greater than or equal to maximum bound`);
            }
        }

        // Verify children for internal nodes
        if (!node.isLeaf) {
            if (node.children.length !== node.keyCount + 1) {
                errors.push(`Node ${pageId}: children count ${node.children.length} != keyCount + 1 (${node.keyCount + 1})`);
            }

            for (let i = 0; i < node.children.length; i++) {
                const childMin = i === 0 ? minKey : node.keys[i - 1];
                const childMax = i === node.keyCount ? maxKey : node.keys[i];
                await this.verifyNode(node.children[i], childMin, childMax, errors);

                // Verify child's parent pointer
                const child = await this.readNode(node.children[i]);
                if (child.parent !== pageId) {
                    errors.push(`Node ${node.children[i]}: parent pointer ${child.parent} != ${pageId}`);
                }
            }
        }
    }

    /**
     * Verify leaf chain integrity
     */
    private async verifyLeafChain(errors: string[]): Promise<void> {
        const leftmost = await this.findLeftmostLeaf();
        let current = leftmost;
        let prevPageId = INVALID_PAGE_ID;
        let count = 0;
        const maxIterations = 1000000; // Prevent infinite loops

        while (count < maxIterations) {
            // Verify prev pointer
            if (current.prev !== prevPageId) {
                errors.push(`Leaf ${current.pageId}: prev pointer ${current.prev} != expected ${prevPageId}`);
            }

            prevPageId = current.pageId;
            count++;

            if (current.next === INVALID_PAGE_ID) {
                break;
            }

            // Verify next node's prev points back
            const next = await this.readNode(current.next);
            if (next.prev !== current.pageId) {
                errors.push(`Leaf ${next.pageId}: prev pointer ${next.prev} != ${current.pageId}`);
            }

            // Verify key ordering across leaves
            if (current.keyCount > 0 && next.keyCount > 0) {
                if (this.comparator(current.keys[current.keyCount - 1], next.keys[0]) >= 0) {
                    errors.push(`Leaf chain: last key of ${current.pageId} >= first key of ${next.pageId}`);
                }
            }

            current = next;
        }

        if (count >= maxIterations) {
            errors.push('Leaf chain verification exceeded maximum iterations (possible cycle)');
        }
    }

    /**
     * Get tree height
     */
    async height(): Promise<number> {
        let h = 0;
        let node = await this.readNode(this.rootPageId);
        while (!node.isLeaf) {
            h++;
            node = await this.readNode(node.children[0]);
        }
        return h + 1;
    }
}
