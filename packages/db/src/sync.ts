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

const UNIQUE_VIOLATION = "23505";

export interface SyncTarget {
  table: string;
  row: Record<string, unknown>;
  /**
   * The unique constraint that means "this exact capture already landed".
   *
   * Naming it is what makes a unique violation safe to treat as success. Without it a
   * `23505` is ambiguous, and the ambiguity is not academic: a gate entry's uniqueness
   * is on the entry NUMBER, and two devices can mint the same number in the same
   * second. Treating that as success deletes the record — and the second vehicle's
   * arrival is gone with no error anywhere, which is precisely the failure the
   * reconciliation control exists to catch.
   *
   * So: omit it unless the constraint identifies the capture itself rather than
   * something the capture happens to contain.
   */
  idempotentOn?: string;
}

export interface SyncOptions {
  client: GolaiClient;
  /**
   * Maps a queued capture onto the table and row to insert. Kept out of this module so
   * the queue stays ignorant of what it is transporting.
   */
  route: (record: OutboxRecord) => SyncTarget | null;
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

    if (error.code === UNIQUE_VIOLATION) {
      // Only when the route has named the constraint AND the server says that is the
      // one that fired. Postgres puts the constraint name in the message; on the rare
      // driver that does not, `details` carries the key.
      const named = target.idempotentOn;
      const blamed = `${error.message} ${error.details ?? ""}`;

      if (named && blamed.includes(named)) return { ok: true };

      // Otherwise something genuinely clashed. Park it: a record that needs a human
      // has lost nothing, and a record that was deleted on a guess has lost an arrival.
      return {
        ok: false,
        retryable: false,
        reason: `${UNIQUE_VIOLATION}:${error.message}`,
      };
    }

    if (error.code && PERMANENT_CODES.has(error.code)) {
      return { ok: false, retryable: false, reason: `${error.code}:${error.message}` };
    }

    // Anything unrecognised is assumed transient. Offline, DNS failure, a gateway
    // hiccup and a server restart all land here, and waiting is the safe default:
    // a record that waits can still be sent, a record that is parked needs a human.
    return { ok: false, retryable: true };
  };
}
