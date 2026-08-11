import type { NewCapture, OutboxRecord, OutboxStore, SendResult } from "./types";

export interface OutboxOptions {
  store: OutboxStore;
  /** Injected, never read from the ambient clock — so backoff is testable. */
  now: () => number;
  /** Backoff base in milliseconds. Doubles per attempt, capped. */
  backoffBaseMs?: number;
  backoffCapMs?: number;
  newId?: () => string;
}

export type SendFn = (record: OutboxRecord) => Promise<SendResult>;

const DEFAULT_BACKOFF_BASE_MS = 60_000;
const DEFAULT_BACKOFF_CAP_MS = 30 * 60_000;

export class Outbox {
  private readonly store: OutboxStore;
  private readonly now: () => number;
  private readonly backoffBaseMs: number;
  private readonly backoffCapMs: number;
  private readonly newId: () => string;

  constructor(options: OutboxOptions) {
    this.store = options.store;
    this.now = options.now;
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.backoffCapMs = options.backoffCapMs ?? DEFAULT_BACKOFF_CAP_MS;
    this.newId = options.newId ?? defaultNewId;
  }

  /**
   * Adds a capture to the queue.
   *
   * A repeated idempotency key returns the existing record unchanged. It is a
   * duplicate, not an edit: the first capture is what the guard actually recorded, and
   * a second submission of the same key means a retry or a crash recovery, never a
   * correction. Corrections are separate captures.
   */
  async enqueue(capture: NewCapture): Promise<OutboxRecord> {
    const existing = await this.store.findByIdempotencyKey(capture.idempotencyKey);
    if (existing) return existing;

    const at = this.now();
    const record: OutboxRecord = {
      id: this.newId(),
      type: capture.type,
      idempotencyKey: capture.idempotencyKey,
      payload: capture.payload,
      status: "PENDING",
      attempts: 0,
      createdAt: at,
      nextAttemptAt: at,
    };
    await this.store.append(record);
    return record;
  }

  /**
   * Sends pending records, oldest first, and stops at the first retryable failure.
   *
   * Stopping matters. Gate entries carry leased sequential numbers written onto paper
   * challans; draining past a stuck record would let a later arrival reach the server
   * before an earlier one, and the server's log would then disagree with the paper.
   */
  async drain(send: SendFn): Promise<void> {
    const at = this.now();
    const records = await this.store.list();

    for (const record of records) {
      if (record.status !== "PENDING") continue;
      if (record.nextAttemptAt > at) continue;

      const result = await send(record);

      if (result.ok) {
        await this.store.remove(record.id);
        continue;
      }

      const attempts = record.attempts + 1;

      if (!result.retryable) {
        // Parked, not deleted. A guard recorded a real arrival; if it cannot be sent,
        // a human decides what happens to it.
        await this.store.update({
          ...record,
          attempts,
          status: "BLOCKED",
          lastError: result.reason,
        });
        continue;
      }

      await this.store.update({
        ...record,
        attempts,
        nextAttemptAt: at + this.backoffFor(attempts),
      });
      return;
    }
  }

  /** Exponential, capped. Deterministic — jitter belongs to the caller if wanted. */
  private backoffFor(attempts: number): number {
    const raw = this.backoffBaseMs * 2 ** (attempts - 1);
    return Math.min(raw, this.backoffCapMs);
  }

  async all(): Promise<OutboxRecord[]> {
    return this.store.list();
  }

  async pendingCount(): Promise<number> {
    return (await this.store.list()).filter((r) => r.status === "PENDING").length;
  }

  /** Needs a human. Surfaced in the app and reported to the operator console. */
  async blockedCount(): Promise<number> {
    return (await this.store.list()).filter((r) => r.status === "BLOCKED").length;
  }

  /**
   * Age of the oldest unsent capture, or null if the queue is clear.
   *
   * This is the number the operator console watches: a growing backlog means a device
   * is failing silently, and silent failure at the gate is precisely what the product
   * exists to prevent (ADR 0004).
   */
  async oldestPendingAgeMs(): Promise<number | null> {
    const pending = (await this.store.list()).filter((r) => r.status === "PENDING");
    if (pending.length === 0) return null;
    const oldest = pending.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
    return this.now() - oldest.createdAt;
  }
}

/**
 * Declared locally rather than by pulling in the DOM lib. This package runs on a
 * React Native runtime as well as in a browser, and it should not claim either.
 */
declare const crypto: { randomUUID?: () => string } | undefined;

function defaultNewId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  throw new Error("No crypto.randomUUID available; pass newId in OutboxOptions");
}
