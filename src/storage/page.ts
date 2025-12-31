// Created by Yanjunhui

import { PAGE_SIZE, PageType, PAGE_HEADER_SIZE, MAX_PAGE_DATA, SLOT_SIZE, SLOT_FLAG_DELETED, INVALID_PAGE_ID } from './constants';
import { DataEndian } from './dataEndian';

/**
 * SlottedPage 中的槽条目（与 Go 版本对齐）
 * // EN: Slot entry in SlottedPage (aligned with Go version)
 */
export interface Slot {
    /** 从页面数据起始位置的偏移量 // EN: Offset from page data start */
    offset: number;
    /** 数据长度 // EN: Data length */
    length: number;
    /** 标志位（如已删除）// EN: Flags (e.g., deleted) */
    flags: number;
}

/**
 * SlottedPage 实现（与 Go 版本对齐）
 * // EN: SlottedPage implementation (aligned with Go version)
 *
 * 页面布局 // EN: Page layout:
 * +------------------+
 * | 头部 (24 字节)    |  // EN: Header (24 bytes)
 * +------------------+
 * | 槽目录           |  // EN: Slot directory
 * | (向下增长)        |  // EN: (grows down)
 * +------------------+
 * |   空闲空间        |  // EN: Free space
 * +------------------+
 * | 数据区           |  // EN: Data area
 * | (向上增长)        |  // EN: (grows up)
 * +------------------+
 *
 * 头部布局（24 字节，与 Go 对齐）// EN: Header layout (24 bytes, aligned with Go):
 * - pageId: 4 字节 (偏移 0)
 * - pageType: 1 字节 (偏移 4)
 * - flags: 1 字节 (偏移 5)
 * - itemCount: 2 字节 (偏移 6)
 * - freeSpace: 2 字节 (偏移 8)
 * - nextPageId: 4 字节 (偏移 10)
 * - prevPageId: 4 字节 (偏移 14)
 * - checksum: 4 字节 (偏移 18)
 * - reserved: 2 字节 (偏移 22)
 */
export class SlottedPage {
    /** 页面数据 // EN: Page data */
    private data: Buffer;

    constructor(data?: Buffer) {
        if (data) {
            if (data.length !== PAGE_SIZE) {
                throw new Error(`Invalid page size: ${data.length}, expected ${PAGE_SIZE}`);
            }
            this.data = data;
        } else {
            this.data = Buffer.alloc(PAGE_SIZE);
        }
    }

    /**
     * 初始化新的空页面
     * // EN: Initialize a new empty page
     */
    static create(pageId: number, pageType: PageType): SlottedPage {
        const page = new SlottedPage();
        page.setPageId(pageId);
        page.setPageType(pageType);
        page.setFlags(0);
        page.setItemCount(0);
        page.setFreeSpace(MAX_PAGE_DATA);
        page.setNextPageId(INVALID_PAGE_ID);
        page.setPrevPageId(INVALID_PAGE_ID);
        page.setChecksum(0);
        return page;
    }

    /**
     * 从缓冲区解析页面
     * // EN: Parse page from buffer
     */
    static fromBuffer(buf: Buffer): SlottedPage {
        const page = new SlottedPage(Buffer.from(buf));
        // 验证校验和 // EN: Verify checksum
        if (!page.verifyChecksum()) {
            throw new Error(`Page ${page.getPageId()} checksum mismatch`);
        }
        return page;
    }

    /**
     * 获取原始缓冲区
     * // EN: Get raw buffer
     */
    toBuffer(): Buffer {
        this.updateChecksum();
        return this.data;
    }

    /**
     * 获取原始缓冲区的副本
     * // EN: Get a copy of raw buffer
     */
    toBufferCopy(): Buffer {
        this.updateChecksum();
        return Buffer.from(this.data);
    }

    // 头部访问器（与 Go 对齐：24 字节头）// EN: Header accessors (aligned with Go: 24-byte header)
    getPageId(): number {
        return DataEndian.readUInt32LE(this.data, 0);
    }

    setPageId(id: number): void {
        DataEndian.writeUInt32LE(this.data, 0, id);
    }

    getPageType(): PageType {
        return this.data[4] as PageType;
    }

    setPageType(type: PageType): void {
        this.data[4] = type;
    }

    getFlags(): number {
        return this.data[5];
    }

    setFlags(flags: number): void {
        this.data[5] = flags;
    }

    getItemCount(): number {
        return DataEndian.readUInt16LE(this.data, 6);
    }

    setItemCount(count: number): void {
        DataEndian.writeUInt16LE(this.data, 6, count);
    }

    getFreeSpace(): number {
        return DataEndian.readUInt16LE(this.data, 8);
    }

    setFreeSpace(space: number): void {
        DataEndian.writeUInt16LE(this.data, 8, space);
    }

    getNextPageId(): number {
        return DataEndian.readUInt32LE(this.data, 10);
    }

    setNextPageId(pageId: number): void {
        DataEndian.writeUInt32LE(this.data, 10, pageId);
    }

    getPrevPageId(): number {
        return DataEndian.readUInt32LE(this.data, 14);
    }

    setPrevPageId(pageId: number): void {
        DataEndian.writeUInt32LE(this.data, 14, pageId);
    }

    getChecksum(): number {
        return DataEndian.readUInt32LE(this.data, 18);
    }

    setChecksum(checksum: number): void {
        DataEndian.writeUInt32LE(this.data, 18, checksum);
    }

    /**
     * 计算 XOR 校验和（与 Go 对齐）
     * 校验和仅对数据区（头之后）计算
     * // EN: Calculate XOR checksum (aligned with Go)
     * // EN: Checksum is calculated over data area only (after header)
     */
    calculateChecksum(): number {
        let checksum = 0;
        // 对数据区中所有 4 字节字进行 XOR
        // EN: XOR all 4-byte words in data area (after header)
        for (let i = PAGE_HEADER_SIZE; i < PAGE_SIZE; i += 4) {
            if (i + 4 <= PAGE_SIZE) {
                checksum ^= DataEndian.readUInt32LE(this.data, i);
            } else {
                // 处理小于 4 字节的尾部 // EN: Handle tail shorter than 4 bytes
                let last = 0;
                for (let j = i; j < PAGE_SIZE; j++) {
                    last |= this.data[j] << (8 * (j - i));
                }
                checksum ^= last;
            }
        }
        return checksum >>> 0; // Ensure unsigned
    }

    /**
     * 更新头中的校验和
     * // EN: Update checksum in header
     */
    updateChecksum(): void {
        this.setChecksum(this.calculateChecksum());
    }

    /**
     * 验证校验和
     * // EN: Verify checksum
     */
    verifyChecksum(): boolean {
        return this.getChecksum() === this.calculateChecksum();
    }

    /**
     * 获取页面数据区（头之后）
     * // EN: Get page data area (after header)
     */
    getDataArea(): Buffer {
        return this.data.subarray(PAGE_HEADER_SIZE);
    }

    /**
     * 设置页面数据区
     * // EN: Set page data area
     */
    setDataArea(data: Buffer): void {
        if (data.length > MAX_PAGE_DATA) {
            throw new Error(`Data too large: ${data.length} > ${MAX_PAGE_DATA}`);
        }
        data.copy(this.data, PAGE_HEADER_SIZE);
    }

    /**
     * 获取指定索引的槽（与 Go 对齐：6 字节槽）
     * // EN: Get slot at index (aligned with Go: 6-byte slots)
     */
    getSlot(index: number): Slot | null {
        if (index < 0 || index >= this.getItemCount()) {
            return null;
        }
        // 槽存储在数据区开头 // EN: Slots are stored at the beginning of data area
        const slotOffset = PAGE_HEADER_SIZE + index * SLOT_SIZE;
        return {
            offset: DataEndian.readUInt16LE(this.data, slotOffset),
            length: DataEndian.readUInt16LE(this.data, slotOffset + 2),
            flags: DataEndian.readUInt16LE(this.data, slotOffset + 4),
        };
    }

    /**
     * 设置指定索引的槽
     * // EN: Set slot at index
     */
    private setSlot(index: number, slot: Slot): void {
        const slotOffset = PAGE_HEADER_SIZE + index * SLOT_SIZE;
        DataEndian.writeUInt16LE(this.data, slotOffset, slot.offset);
        DataEndian.writeUInt16LE(this.data, slotOffset + 2, slot.length);
        DataEndian.writeUInt16LE(this.data, slotOffset + 4, slot.flags);
    }

    /**
     * 检查槽是否已删除
     * // EN: Check if slot is deleted
     */
    isSlotDeleted(index: number): boolean {
        const slot = this.getSlot(index);
        if (!slot) return true;
        return (slot.flags & SLOT_FLAG_DELETED) !== 0;
    }

    /**
     * 获取指定槽索引的数据
     * // EN: Get data at slot index
     */
    getData(index: number): Buffer | null {
        const slot = this.getSlot(index);
        if (!slot || slot.length === 0 || (slot.flags & SLOT_FLAG_DELETED)) {
            return null;
        }
        // 偏移量相对于数据区起始位置 // EN: Offset is relative to data area start
        const dataStart = PAGE_HEADER_SIZE + slot.offset;
        return this.data.subarray(dataStart, dataStart + slot.length);
    }

    /**
     * 计算新数据的可用空间
     * // EN: Calculate available space for new data
     */
    getAvailableSpace(): number {
        const itemCount = this.getItemCount();
        const slotsEnd = itemCount * SLOT_SIZE;
        // 查找最小记录偏移量 // EN: Find minimum record offset
        let minRecordOffset = MAX_PAGE_DATA;
        for (let i = 0; i < itemCount; i++) {
            const slot = this.getSlot(i);
            if (slot && !(slot.flags & SLOT_FLAG_DELETED) && slot.offset < minRecordOffset) {
                minRecordOffset = slot.offset;
            }
        }
        // 可用 = 最小记录偏移 - 槽结束位置 - 新槽大小
        // EN: Available = min record offset - slots end - new slot size
        return minRecordOffset - slotsEnd - SLOT_SIZE;
    }

    /**
     * 向页面插入数据
     * 返回槽索引，如果没有空间则返回 -1
     * // EN: Insert data into page
     * // EN: Returns slot index or -1 if no space
     */
    insert(data: Buffer): number {
        const recordLen = data.length;
        const slotSpace = SLOT_SIZE;
        const totalNeeded = recordLen + slotSpace;

        const itemCount = this.getItemCount();
        const slotDirEnd = (itemCount + 1) * SLOT_SIZE;

        // 查找最小记录偏移量 // EN: Find minimum record offset
        let minRecordOffset = MAX_PAGE_DATA;
        for (let i = 0; i < itemCount; i++) {
            const slot = this.getSlot(i);
            if (slot && !(slot.flags & SLOT_FLAG_DELETED) && slot.offset < minRecordOffset) {
                minRecordOffset = slot.offset;
            }
        }

        // 检查可用空间 // EN: Check available space
        if (slotDirEnd + recordLen > minRecordOffset) {
            return -1;
        }

        // 计算新记录偏移量（从数据区末尾向后增长）
        // EN: Calculate new record offset (growing backward from end of data area)
        const newOffset = minRecordOffset - recordLen;

        // 复制数据到数据区 // EN: Copy data to data area
        data.copy(this.data, PAGE_HEADER_SIZE + newOffset);

        // 添加槽 // EN: Add slot
        this.setSlot(itemCount, { offset: newOffset, length: recordLen, flags: 0 });

        // 更新头 // EN: Update header
        this.setItemCount(itemCount + 1);
        this.setFreeSpace(minRecordOffset - slotDirEnd - recordLen);

        return itemCount;
    }

    /**
     * 更新指定槽索引的数据
     * 成功返回 true
     * // EN: Update data at slot index
     * // EN: Returns true if successful
     */
    update(index: number, data: Buffer): boolean {
        const slot = this.getSlot(index);
        if (!slot || (slot.flags & SLOT_FLAG_DELETED)) {
            return false;
        }

        const newLen = data.length;

        // If new data fits in existing slot, update in place
        if (newLen <= slot.length) {
            data.copy(this.data, PAGE_HEADER_SIZE + slot.offset);
            this.setSlot(index, { offset: slot.offset, length: newLen, flags: 0 });
            return true;
        }

        // Need more space - mark old slot deleted and allocate new
        const freeSpace = this.getFreeSpace();
        const extraSpace = newLen - slot.length;
        if (extraSpace > freeSpace) {
            return false;
        }

        // Mark old slot as deleted
        this.setSlot(index, { ...slot, flags: SLOT_FLAG_DELETED });

        // Find new location
        const itemCount = this.getItemCount();
        let minOffset = MAX_PAGE_DATA;
        for (let i = 0; i < itemCount; i++) {
            const s = this.getSlot(i);
            if (s && !(s.flags & SLOT_FLAG_DELETED) && s.offset < minOffset) {
                minOffset = s.offset;
            }
        }
        const newOffset = minOffset - newLen;

        // Copy data
        data.copy(this.data, PAGE_HEADER_SIZE + newOffset);

        // Update slot
        this.setSlot(index, { offset: newOffset, length: newLen, flags: 0 });
        this.setFreeSpace(freeSpace - extraSpace);

        return true;
    }

    /**
     * 删除指定槽索引的数据
     * 注意：仅将槽标记为已删除，不减少 itemCount
     * // EN: Delete data at slot index
     * // EN: Note: Only marks slot as deleted, does not decrement itemCount
     */
    delete(index: number): boolean {
        const slot = this.getSlot(index);
        if (!slot || (slot.flags & SLOT_FLAG_DELETED)) {
            return false;
        }

        // Mark slot as deleted
        this.setSlot(index, { ...slot, flags: SLOT_FLAG_DELETED });
        return true;
    }

    /**
     * 获取有效记录数（排除已删除的槽）
     * // EN: Get live record count (excluding deleted slots)
     */
    getLiveCount(): number {
        let count = 0;
        const itemCount = this.getItemCount();
        for (let i = 0; i < itemCount; i++) {
            const slot = this.getSlot(i);
            if (slot && !(slot.flags & SLOT_FLAG_DELETED)) {
                count++;
            }
        }
        return count;
    }

    /**
     * 压缩页面以回收碎片空间
     * 返回旧槽索引到新槽索引的映射
     * // EN: Compact page to reclaim fragmented space
     * // EN: Returns mapping from old slot index to new slot index
     */
    compact(): Map<number, number> {
        const mapping = new Map<number, number>();
        const itemCount = this.getItemCount();

        // 收集所有有效记录及其数据 // EN: Collect all live records with their data
        const records: { data: Buffer; oldIndex: number }[] = [];
        for (let i = 0; i < itemCount; i++) {
            const slot = this.getSlot(i);
            if (slot && !(slot.flags & SLOT_FLAG_DELETED) && slot.length > 0) {
                const recordData = Buffer.from(this.data.subarray(
                    PAGE_HEADER_SIZE + slot.offset,
                    PAGE_HEADER_SIZE + slot.offset + slot.length
                ));
                records.push({ data: recordData, oldIndex: i });
            }
        }

        // 清空数据区 // EN: Clear data area
        this.data.fill(0, PAGE_HEADER_SIZE);

        // 重写记录（从末尾向后增长）// EN: Rewrite records (growing backward from end)
        let offset = MAX_PAGE_DATA;
        for (let newIndex = 0; newIndex < records.length; newIndex++) {
            const record = records[newIndex];
            const recordLen = record.data.length;
            offset -= recordLen;

            // 复制数据 // EN: Copy data
            record.data.copy(this.data, PAGE_HEADER_SIZE + offset);

            // 设置槽 // EN: Set slot
            this.setSlot(newIndex, { offset, length: recordLen, flags: 0 });

            // 记录映射 // EN: Record mapping
            mapping.set(record.oldIndex, newIndex);
        }

        // 更新头 // EN: Update header
        this.setItemCount(records.length);

        // 计算新的空闲空间 // EN: Calculate new free space
        let usedSpace = 0;
        for (const record of records) {
            usedSpace += record.data.length;
        }
        const slotSpace = records.length * SLOT_SIZE;
        this.setFreeSpace(MAX_PAGE_DATA - usedSpace - slotSpace);

        return mapping;
    }

    /**
     * 获取所有项作为缓冲区数组
     * // EN: Get all items as array of buffers
     */
    getAllItems(): Buffer[] {
        const result: Buffer[] = [];
        const itemCount = this.getItemCount();
        for (let i = 0; i < itemCount; i++) {
            const data = this.getData(i);
            if (data && data.length > 0) {
                result.push(Buffer.from(data));
            }
        }
        return result;
    }

    /**
     * 检查页面是否为空
     * // EN: Check if page is empty
     */
    isEmpty(): boolean {
        return this.getLiveCount() === 0;
    }

    // 遗留方法（向后兼容）// EN: Legacy methods for backward compatibility
    getFreeStart(): number {
        // 查找最小记录偏移量 // EN: Find minimum record offset
        const itemCount = this.getItemCount();
        let minOffset = MAX_PAGE_DATA;
        for (let i = 0; i < itemCount; i++) {
            const slot = this.getSlot(i);
            if (slot && !(slot.flags & SLOT_FLAG_DELETED) && slot.offset < minOffset) {
                minOffset = slot.offset;
            }
        }
        return PAGE_HEADER_SIZE + minOffset;
    }

    setFreeStart(_start: number): void {
        // 空操作（向后兼容，从槽计算）// EN: No-op for backward compatibility (computed from slots)
    }
}
