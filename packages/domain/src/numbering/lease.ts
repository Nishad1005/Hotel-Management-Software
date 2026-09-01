import { formatDocumentNumber } from "../gate/gate-entry";

/**
 * The client half of number block leasing. ADR 0005, pure state, zero I/O.
 *
 * The server carves non-overlapping blocks from a per-property, per-type sequence; this
 * module spends them in order, says when the pool is running low, and — the rule the
 * whole design hangs on — throws rather than invent a number when the pool is empty. A
 * number minted outside a lease is exactly the collision that disabled the sync path's
 * idempotency for a month.
 *
 * Held as data rather than a class so the app can persist it as JSON on whatever
 * storage seam the platform has, and so these rules hold identically on an offline
 * device and in a test (CLAUDE.md rule 16).
 */

export interface LeasedRange {
  /** First unspent number in this block. Moves forward as numbers are spent. */
  start: number;
  /** Last number in this block, inclusive. */
  end: number;
}

export interface NumberLeaseState {
  propertyCode: string;
  /** Document prefix as the series prints it — "GE" for gate entries. */
  prefix: string;
  /** Unspent blocks, oldest first. The head is the one being spent. */
  ranges: LeasedRange[];
}

/**
 * How deep a device keeps its pool: at least a full busy shift of captures, per the
 * ADR's "holds at least 200 unspent numbers".
 */
export const LEASE_TARGET_DEPTH = 200;

/** Refill when the pool drops BELOW this — not at it, per the ADR's "below 50". */
export const LEASE_REFILL_BELOW = 50;

export function remainingNumbers(state: NumberLeaseState | null): number {
  if (!state) return 0;
  return state.ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0);
}

export function needsRefill(state: NumberLeaseState | null): boolean {
  return remainingNumbers(state) < LEASE_REFILL_BELOW;
}

/** How many to request so the pool returns to target depth. Never less than one. */
export function refillCount(state: NumberLeaseState | null): number {
  return Math.max(1, LEASE_TARGET_DEPTH - remainingNumbers(state));
}

/**
 * Accepts a freshly leased block from the server.
 *
 * The refusals matter more than the acceptance. A block that does not begin past every
 * number this state has ever held is a duplicate or a stale response — accepting it
 * would let the same number be spent twice, which is the exact failure leasing exists
 * to end. The server cannot send one (the sequence only moves forward), so arriving
 * here means the client is confused, and a loud stop beats a quiet collision.
 */
export function addRange(
  state: NumberLeaseState | null,
  range: LeasedRange,
  identity?: { propertyCode: string; prefix: string },
): NumberLeaseState {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
    throw new Error(`A leased range must be whole numbers, received ${range.start}–${range.end}`);
  }
  if (range.start < 1 || range.end < range.start) {
    throw new Error(`A leased range must run forward from 1, received ${range.start}–${range.end}`);
  }

  if (!state) {
    if (!identity) {
      throw new Error("The first leased range must say which property and series it belongs to");
    }
    return { ...identity, ranges: [range] };
  }

  if (identity && identity.propertyCode !== state.propertyCode) {
    throw new Error(
      `A lease for property ${identity.propertyCode} cannot join a pool for ${state.propertyCode}`,
    );
  }

  const highest = state.ranges.reduce((max, r) => Math.max(max, r.end), 0);
  if (range.start <= highest) {
    throw new Error(
      `A new lease must move forward: received ${range.start}–${range.end} against a pool already holding up to ${highest}`,
    );
  }

  return { ...state, ranges: [...state.ranges, range] };
}

/**
 * Spends the next number and returns it formatted exactly as the server-side allocator
 * would print it — same prefix map, same six-digit padding — so a leased number and an
 * allocated one are indistinguishable on a challan.
 */
export function spendNumber(state: NumberLeaseState): {
  formatted: string;
  state: NumberLeaseState;
} {
  const head = state.ranges[0];
  if (!head) {
    throw new Error(
      "No leased numbers left. Refusing to invent one: a number minted outside a lease can collide with another device's.",
    );
  }

  const formatted = formatDocumentNumber(state.propertyCode, state.prefix, head.start);

  const spentOut = head.start === head.end;
  const ranges = spentOut
    ? state.ranges.slice(1)
    : [{ start: head.start + 1, end: head.end }, ...state.ranges.slice(1)];

  return { formatted, state: { ...state, ranges } };
}
