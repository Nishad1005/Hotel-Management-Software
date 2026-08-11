import type { OutboxRecord, OutboxStore } from "@golai/outbox";
import * as SQLite from "expo-sqlite";

/**
 * SQLite driver — the native half of the storage port (ADR 0014).
 *
 * Ordering is by an INTEGER PRIMARY KEY rowid rather than by created_at, for the same
 * reason as the web driver: two captures can share a millisecond, and the ordering
 * guarantee has to survive that.
 *
 * The payload is stored as JSON text. It is opaque to this layer by design — the queue
 * transports captures, it does not understand them.
 */

const DB_NAME = "golai-outbox.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (database) => {
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS outbox (
          seq             INTEGER PRIMARY KEY AUTOINCREMENT,
          id              TEXT NOT NULL UNIQUE,
          type            TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          payload         TEXT NOT NULL,
          status          TEXT NOT NULL,
          attempts        INTEGER NOT NULL,
          created_at      INTEGER NOT NULL,
          next_attempt_at INTEGER NOT NULL,
          last_error      TEXT
        );
      `);
      return database;
    });
  }
  return dbPromise;
}

interface Row {
  id: string;
  type: string;
  idempotency_key: string;
  payload: string;
  status: string;
  attempts: number;
  created_at: number;
  next_attempt_at: number;
  last_error: string | null;
}

function toRecord(row: Row): OutboxRecord {
  return {
    id: row.id,
    type: row.type,
    idempotencyKey: row.idempotency_key,
    payload: JSON.parse(row.payload),
    status: row.status as OutboxRecord["status"],
    attempts: row.attempts,
    createdAt: row.created_at,
    nextAttemptAt: row.next_attempt_at,
    ...(row.last_error === null ? {} : { lastError: row.last_error }),
  };
}

export class SqliteOutboxStore implements OutboxStore {
  async append(record: OutboxRecord): Promise<void> {
    const database = await db();
    await database.runAsync(
      `INSERT INTO outbox (id, type, idempotency_key, payload, status, attempts, created_at, next_attempt_at, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.type,
      record.idempotencyKey,
      JSON.stringify(record.payload),
      record.status,
      record.attempts,
      record.createdAt,
      record.nextAttemptAt,
      record.lastError ?? null,
    );
  }

  async update(record: OutboxRecord): Promise<void> {
    const database = await db();
    await database.runAsync(
      `UPDATE outbox
          SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?
        WHERE id = ?`,
      record.status,
      record.attempts,
      record.nextAttemptAt,
      record.lastError ?? null,
      record.id,
    );
  }

  async remove(id: string): Promise<void> {
    const database = await db();
    await database.runAsync(`DELETE FROM outbox WHERE id = ?`, id);
  }

  async list(): Promise<OutboxRecord[]> {
    const database = await db();
    const rows = await database.getAllAsync<Row>(`SELECT * FROM outbox ORDER BY seq ASC`);
    return rows.map(toRecord);
  }

  async findByIdempotencyKey(key: string): Promise<OutboxRecord | undefined> {
    const database = await db();
    const row = await database.getFirstAsync<Row>(
      `SELECT * FROM outbox WHERE idempotency_key = ?`,
      key,
    );
    return row ? toRecord(row) : undefined;
  }
}

/** Metro resolves this file on iOS and Android. */
export function createOutboxStore(): OutboxStore {
  return new SqliteOutboxStore();
}
