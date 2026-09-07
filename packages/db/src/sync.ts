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

/**
 * Did the server actually answer, or did the request never arrive?
 *
 * This is the question a screen has to settle before it may queue a write. If the
 * server answered — with a refusal, a rule violation, anything — that answer is the
 * truth and must be shown to the person standing at the dock. Queueing it would
 * promise that a receipt the server has already rejected will post itself later.
 *
 * If nothing answered, the capture is safe to queue and the person can carry on.
 *
 * postgrest-js reports a transport failure as an error with an empty `code`, which is
 * how the two cases are told apart. It lives here rather than in the app so the screen
 * that decides to queue and the sender that decides to retry cannot drift apart.
 */
export function serverAnswered(error: { code?: string | null } | null | undefined): boolean {
  return typeof error?.code === "string" && error.code.length > 0;
}

export interface InsertTarget {
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

/**
 * A capture that is a transaction, not a row.
 *
 * Receiving and issuing are not appends. Posting a GRN writes the receipt, its lines,
 * a batch per line, a stock lot per accepted line and the movements behind them, takes
 * a document number, and must do all of it or none. That cannot be expressed as an
 * insert, which is why the outbox could only ever carry gate entries and temperature
 * readings — the two captures that happen to be single rows — while the dock, the
 * part of the property with the worst network, stayed online-only.
 *
 * There is no `idempotentOn` here, and that is the point rather than an omission. An
 * insert proves it already landed by colliding with a named constraint; these
 * functions take a submission key and return the first attempt's result, so a replay
 * is an ordinary success and never reaches the error path at all. Both `post_grn` and
 * `issue_stock` already refuse to run without that key.
 */
export interface RpcTarget {
  /** The function's name, as PostgREST exposes it. */
  fn: string;
  /** Named arguments. PostgREST matches an overload by argument name, not position. */
  args: Record<string, unknown>;
}

export type SyncTarget = InsertTarget | RpcTarget;

const isRpc = (target: SyncTarget): target is RpcTarget => "fn" in target;

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

    const { error } = isRpc(target)
      ? await client.rpc(target.fn as never, target.args as never)
      : await client
          .from(target.table as never)
          .insert(target.row as never)
          .select();

    if (!error) return { ok: true };

    if (error.code === UNIQUE_VIOLATION) {
      /*
        A function has no constraint to name, so it cannot claim a collision is its own
        replay — its replay already returned success above. A `23505` escaping one of
        these transactions is therefore a genuine clash, and parking it is right.
      */
      if (isRpc(target)) {
        return {
          ok: false,
          retryable: false,
          reason: `${UNIQUE_VIOLATION}:${error.message}`,
        };
      }

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
