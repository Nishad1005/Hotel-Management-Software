import type { OutboxRecord, OutboxStore } from "@golai/outbox";

/**
 * IndexedDB driver — the web half of the storage port (ADR 0014).
 *
 * IndexedDB rather than localStorage because captures include base64 photo references
 * and a full shift's queue exceeds localStorage's ~5 MB ceiling; and because
 * localStorage is synchronous and would block the UI thread on a dock device.
 *
 * Ordering is by an autoincrementing sequence, not by createdAt. Two captures inside
 * the same millisecond are possible, and the queue's ordering guarantee has to survive
 * that.
 */

const DB_NAME = "golai-outbox";
const DB_VERSION = 1;
const STORE = "records";

interface StoredRecord extends OutboxRecord {
  seq?: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "seq", autoIncrement: true });
        store.createIndex("id", "id", { unique: true });
        store.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export class IndexedDbOutboxStore implements OutboxStore {
  async append(record: OutboxRecord): Promise<void> {
    await run("readwrite", (store) => store.add({ ...record } as StoredRecord));
  }

  async update(record: OutboxRecord): Promise<void> {
    const existing = await this.findStoredById(record.id);
    if (!existing) return;
    await run("readwrite", (store) => store.put({ ...record, seq: existing.seq } as StoredRecord));
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findStoredById(id);
    if (existing?.seq === undefined) return;
    await run("readwrite", (store) => store.delete(existing.seq as number));
  }

  async list(): Promise<OutboxRecord[]> {
    // getAll on an autoincrement keyPath returns insertion order.
    const rows = await run<StoredRecord[]>("readonly", (store) => store.getAll());
    return rows.map(({ seq: _seq, ...record }) => record);
  }

  async findByIdempotencyKey(key: string): Promise<OutboxRecord | undefined> {
    const row = await run<StoredRecord | undefined>("readonly", (store) =>
      store.index("idempotencyKey").get(key),
    );
    if (!row) return undefined;
    const { seq: _seq, ...record } = row;
    return record;
  }

  private async findStoredById(id: string): Promise<StoredRecord | undefined> {
    return run<StoredRecord | undefined>("readonly", (store) => store.index("id").get(id));
  }
}

/** Metro resolves this file on web. See ./outbox-store.ts for why the split exists. */
export function createOutboxStore(): OutboxStore {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable");
  return new IndexedDbOutboxStore();
}
