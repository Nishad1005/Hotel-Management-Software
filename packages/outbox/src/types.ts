/**
 * The offline capture queue. See docs/decisions/0004-outbox-over-sync-engine.md.
 *
 * Nearly every write in this system is an append — a gate entry, a GRN line, an
 * inspection result — so there is nothing to merge and no conflict resolution layer.
 * What there is instead is ordering, idempotency, and a rule that nothing captured is
 * ever silently lost.
 */

export type OutboxStatus = "PENDING" | "BLOCKED";

export interface OutboxRecord {
  id: string;
  type: string;
  /**
   * Supplied by the caller and stable for the life of the capture. The drain will
   * retry, and a device may resubmit after a crash; the server treats a repeated key
   * as a no-op returning the original result.
   */
  idempotencyKey: string;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  createdAt: number;
  /** Earliest time the record may be sent again. Set by backoff after a failure. */
  nextAttemptAt: number;
  lastError?: string;
}

export interface NewCapture {
  type: string;
  idempotencyKey: string;
  payload: unknown;
}

/**
 * What a send attempt reports back.
 *
 * `retryable` is the important distinction. A network failure is retryable and the
 * record waits. A rejection — bad schema, unknown property — is not, and the record is
 * parked for a human rather than retried forever or thrown away.
 */
export type SendResult =
  | { ok: true }
  | { ok: false; retryable: true }
  | { ok: false; retryable: false; reason: string };

/**
 * The storage port.
 *
 * Deliberately small, because it is implemented twice: SQLite on native, IndexedDB on
 * web (ADR 0014). Everything above this line is platform-independent and tested
 * against an in-memory implementation.
 */
export interface OutboxStore {
  append(record: OutboxRecord): Promise<void>;
  update(record: OutboxRecord): Promise<void>;
  remove(id: string): Promise<void>;
  /** All records, oldest first. Order is a guarantee, not an accident. */
  list(): Promise<OutboxRecord[]>;
  findByIdempotencyKey(key: string): Promise<OutboxRecord | undefined>;
}
