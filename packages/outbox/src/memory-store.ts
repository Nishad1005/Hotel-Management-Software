import type { OutboxRecord, OutboxStore } from "./types";

/**
 * In-memory store. Used by the test suite, and by the app before a persistent driver
 * is selected for the platform.
 *
 * Insertion order is preserved because the queue's ordering guarantee is meaningless
 * if the store does not keep it.
 */
export class MemoryOutboxStore implements OutboxStore {
  private records: OutboxRecord[] = [];

  async append(record: OutboxRecord): Promise<void> {
    this.records.push({ ...record });
  }

  async update(record: OutboxRecord): Promise<void> {
    const index = this.records.findIndex((r) => r.id === record.id);
    if (index >= 0) this.records[index] = { ...record };
  }

  async remove(id: string): Promise<void> {
    this.records = this.records.filter((r) => r.id !== id);
  }

  async list(): Promise<OutboxRecord[]> {
    return this.records.map((r) => ({ ...r }));
  }

  async findByIdempotencyKey(key: string): Promise<OutboxRecord | undefined> {
    const found = this.records.find((r) => r.idempotencyKey === key);
    return found ? { ...found } : undefined;
  }
}
