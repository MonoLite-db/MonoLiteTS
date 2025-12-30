// Created by Yanjunhui

import { PAGE_SIZE, PageType, PAGE_HEADER_SIZE, MAX_PAGE_DATA, SLOT_SIZE, SLOT_FLAG_DELETED, INVALID_PAGE_ID } from './constants';
import { DataEndian } from './dataEndian';

/**
 * Slot entry in SlottedPage (aligned with Go version)
 */
export interface Slot {
    offset: number;  // Offset from page data start
    length: number;  // Data length
    flags: number;   // Flags (e.g., deleted)
}

/**
 * SlottedPage implementation (aligned with Go version)
 *
 * Page layout:
 * +------------------+
 * | Header (24 bytes)|
 * +------------------+
 * | Slot directory   |
 * | (grows down)     |
 * +------------------+
 * |   Free space     |
 * +------------------+
 * | Data area        |
 * | (grows up)       |
 * +------------------+
 *
 * Header layout (24 bytes, aligned with Go):
 * - pageId: 4 bytes (offset 0)
 * - pageType: 1 byte (offset 4)
 * - flags: 1 byte (offset 5)
 * - itemCount: 2 bytes (offset 6)
 * - freeSpace: 2 bytes (offset 8)
 * - nextPageId: 4 bytes (offset 10)
 * - prevPageId: 4 bytes (offset 14)
 * - checksum: 4 bytes (offset 18)
 * - reserved: 2 bytes (offset 22)
 */
export class SlottedPage {
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
     * Initialize a new empty page
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
     * Parse page from buffer
     */
    static fromBuffer(buf: Buffer): SlottedPage {
        const page = new SlottedPage(Buffer.from(buf));
        // Verify checksum
        if (!page.verifyChecksum()) {
            throw new Error(`Page ${page.getPageId()} checksum mismatch`);
        }
        return page;
    }

    /**
     * Get raw buffer
     */
    toBuffer(): Buffer {
        this.updateChecksum();
        return this.data;
    }

    /**
     * Get a copy of raw buffer
     */
    toBufferCopy(): Buffer {
        this.updateChecksum();
        return Buffer.from(this.data);
    }

    // Header accessors (aligned with Go: 24-byte header)
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
     * Calculate XOR checksum (aligned with Go)
     * Checksum is calculated over data area only (after header)
     */
    calculateChecksum(): number {
        let checksum = 0;
        // XOR all 4-byte words in data area (after header)
        for (let i = PAGE_HEADER_SIZE; i < PAGE_SIZE; i += 4) {
            if (i + 4 <= PAGE_SIZE) {
                checksum ^= DataEndian.readUInt32LE(this.data, i);
            } else {
                // Handle tail shorter than 4 bytes
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
     * Update checksum in header
     */
    updateChecksum(): void {
        this.setChecksum(this.calculateChecksum());
    }

    /**
     * Verify checksum
     */
    verifyChecksum(): boolean {
        return this.getChecksum() === this.calculateChecksum();
    }

    /**
     * Get page data area (after header)
     */
    getDataArea(): Buffer {
        return this.data.subarray(PAGE_HEADER_SIZE);
    }

    /**
     * Set page data area
     */
    setDataArea(data: Buffer): void {
        if (data.length > MAX_PAGE_DATA) {
            throw new Error(`Data too large: ${data.length} > ${MAX_PAGE_DATA}`);
        }
        data.copy(this.data, PAGE_HEADER_SIZE);
    }

    /**
     * Get slot at index (aligned with Go: 6-byte slots)
     */
    getSlot(index: number): Slot | null {
        if (index < 0 || index >= this.getItemCount()) {
            return null;
        }
        // Slots are stored at the beginning of data area
        const slotOffset = PAGE_HEADER_SIZE + index * SLOT_SIZE;
        return {
            offset: DataEndian.readUInt16LE(this.data, slotOffset),
            length: DataEndian.readUInt16LE(this.data, slotOffset + 2),
            flags: DataEndian.readUInt16LE(this.data, slotOffset + 4),
        };
    }

    /**
     * Set slot at index
     */
    private setSlot(index: number, slot: Slot): void {
        const slotOffset = PAGE_HEADER_SIZE + index * SLOT_SIZE;
        DataEndian.writeUInt16LE(this.data, slotOffset, slot.offset);
        DataEndian.writeUInt16LE(this.data, slotOffset + 2, slot.length);
        DataEndian.writeUInt16LE(this.data, slotOffset + 4, slot.flags);
    }

    /**
     * Check if slot is deleted
     */
    isSlotDeleted(index: number): boolean {
        const slot = this.getSlot(index);
        if (!slot) return true;
        return (slot.flags & SLOT_FLAG_DELETED) !== 0;
    }

    /**
     * Get data at slot index
     */
    getData(index: number): Buffer | null {
        const slot = this.getSlot(index);
        if (!slot || slot.length === 0 || (slot.flags & SLOT_FLAG_DELETED)) {
            return null;
        }
        // Offset is relative to data area start
        const dataStart = PAGE_HEADER_SIZE + slot.offset;
        return this.data.subarray(dataStart, dataStart + slot.length);
    }

    /**
     * Calculate available space for new data
     */
    getAvailableSpace(): number {
        const itemCount = this.getItemCount();
        const slotsEnd = itemCount * SLOT_SIZE;
        // Find minimum record offset
        let minRecordOffset = MAX_PAGE_DATA;
        for (let i = 0; i < itemCount; i++) {
            const slot = this.getSlot(i);
            if (slot && !(slot.flags & SLOT_FLAG_DELETED) && slot.offset < minRecordOffset) {
                minRecordOffset = slot.offset;
            }
        }
        // Available = min record offset - slots end - new slot size
        return minRecordOffset - slotsEnd - SLOT_SIZE;
    }

    /**
     * Insert data into page
     * Returns slot index or -1 if no space
     */
    insert(data: Buffer): number {
        const recordLen = data.length;
        const slotSpace = SLOT_SIZE;
        const totalNeeded = recordLen + slotSpace;

        const itemCount = this.getItemCount();
        const slotDirEnd = (itemCount + 1) * SLOT_SIZE;

        // Find minimum record offset
        let minRecordOffset = MAX_PAGE_DATA;
        for (let i = 0; i < itemCount; i++) {
            const slot = this.getSlot(i);
            if (slot && !(slot.flags & SLOT_FLAG_DELETED) && slot.offset < minRecordOffset) {
                minRecordOffset = slot.offset;
            }
        }

        // Check available space
        if (slotDirEnd + recordLen > minRecordOffset) {
            return -1;
        }

        // Calculate new record offset (growing backward from end of data area)
        const newOffset = minRecordOffset - recordLen;

        // Copy data to data area
        data.copy(this.data, PAGE_HEADER_SIZE + newOffset);

        // Add slot
        this.setSlot(itemCount, { offset: newOffset, length: recordLen, flags: 0 });

        // Update header
        this.setItemCount(itemCount + 1);
        this.setFreeSpace(minRecordOffset - slotDirEnd - recordLen);

        return itemCount;
    }

    /**
     * Update data at slot index
     * Returns true if successful
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
     * Delete data at slot index
     * Note: Only marks slot as deleted, does not decrement itemCount
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
     * Get live record count (excluding deleted slots)
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
     * Compact page to reclaim fragmented space
     * Returns mapping from old slot index to new slot index
     */
    compact(): Map<number, number> {
        const mapping = new Map<number, number>();
        const itemCount = this.getItemCount();

        // Collect all live records with their data
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

        // Clear data area
        this.data.fill(0, PAGE_HEADER_SIZE);

        // Rewrite records (growing backward from end)
        let offset = MAX_PAGE_DATA;
        for (let newIndex = 0; newIndex < records.length; newIndex++) {
            const record = records[newIndex];
            const recordLen = record.data.length;
            offset -= recordLen;

            // Copy data
            record.data.copy(this.data, PAGE_HEADER_SIZE + offset);

            // Set slot
            this.setSlot(newIndex, { offset, length: recordLen, flags: 0 });

            // Record mapping
            mapping.set(record.oldIndex, newIndex);
        }

        // Update header
        this.setItemCount(records.length);

        // Calculate new free space
        let usedSpace = 0;
        for (const record of records) {
            usedSpace += record.data.length;
        }
        const slotSpace = records.length * SLOT_SIZE;
        this.setFreeSpace(MAX_PAGE_DATA - usedSpace - slotSpace);

        return mapping;
    }

    /**
     * Get all items as array of buffers
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
     * Check if page is empty
     */
    isEmpty(): boolean {
        return this.getLiveCount() === 0;
    }

    // Legacy methods for backward compatibility
    getFreeStart(): number {
        // Find minimum record offset
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
        // No-op for backward compatibility (computed from slots)
    }
}
