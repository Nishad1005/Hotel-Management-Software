import type { OutboxRecord, SendResult } from "@golai/outbox";
import type { GolaiClient } from "./client";

/**
 * The outbox's send implementation — the thing that turns "waiting to sync" into
 * synced.
 *
 * The distinction that matters is retryable versus not. It decides whether a capture
 * waits for the network or gets parked for a human, and getting it wrong in either
 * direction is bad: retrying a permanently rejected record forever hides a real
 * problem, while parking a transient network failure loses a shift's work to a
 * flapping connection.
 */

/** Postgres and PostgREST codes that mean "this will never succeed as written". */
const PERMANENT_CODES = new Set([
  "23502", // not_null_violation
  "23503", // foreign_key_violation — references something that does not exist
  "23514", // check_violation — breaks a domain rule, e.g. a perishable with no shelf life
  "42501", // insufficient_privilege — RLS or grant refused it
  "42P01", // undefined_table — the client is newer than the database
  "PGRST204", // column not found in schema cache
]);

/**
 * Unique violation is deliberately treated as SUCCESS, not as an error.
 *
 * Every capture carries an idempotency key written into the row. If the server already
 * holds it, a previous attempt landed and the acknowledgement was what got lost. The
 * record is done. Treating this as a failure is how a retry turns into a phantom
 * duplicate — the exact thing the idempotency key exists to prevent.
 */
const ALREADY_APPLIED = "23505";

export interface SyncOptions {
  client: GolaiClient;
  /**
   * Maps a queued capture onto the table and row to insert. Kept out of this module so
   * the queue stays ignorant of what it is transporting.
   */
  route: (record: OutboxRecord) => { table: string; row: Record<string, unknown> } | null;
}

export function createSender({ client, route }: SyncOptions) {
  return async function send(record: OutboxRecord): Promise<SendResult> {
    const target = route(record);

    if (!target) {
      // A capture type this build does not understand. Parking it is right: a newer
      // app version may have queued it, and discarding it would lose a real record.
      return { ok: false, retryable: false, reason: `UNKNOWN_CAPTURE_TYPE:${record.type}` };
    }

    const { error } = await client
      .from(target.table as never)
      .insert(target.row as never)
      .select();

    if (!error) return { ok: true };

    if (error.code === ALREADY_APPLIED) return { ok: true };

    if (error.code && PERMANENT_CODES.has(error.code)) {
      return { ok: false, retryable: false, reason: `${error.code}:${error.message}` };
    }

    // Anything unrecognised is assumed transient. Offline, DNS failure, a gateway
    // hiccup and a server restart all land here, and waiting is the safe default:
    // a record that waits can still be sent, a record that is parked needs a human.
    return { ok: false, retryable: true };
  };
}
