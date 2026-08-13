/**
 * Quantities arrive from Postgres as strings.
 *
 * `numeric` has more precision than a JavaScript number, so supabase-js hands it over
 * as text rather than silently losing digits. That is the right call by the driver and
 * a trap for everyone downstream:
 *
 *   ["10", "5", "20"].reduce((sum, q) => sum + q, 0)   ->   "0105 20"
 *
 * It type-checks, it runs, and it produces a stock total that is nonsense. golaiv1
 * shipped exactly this and did not find it until an item was spread across enough
 * locations to be summed — during a stock take. Every quantity column in this system is
 * `numeric(14,4)`, so every quantity has this shape, and the coercion belongs in one
 * place rather than at each call site.
 */

/** Matches `numeric(14, 4)` on `stock_movement.qty`, `stock_lot.qty` and their kin. */
export const QUANTITY_DECIMALS = 4;

const FACTOR = 10 ** QUANTITY_DECIMALS;

/**
 * Coerces a quantity as it comes off the wire.
 *
 * Null, undefined and blank are zero — "nothing on this shelf" is a real answer and not
 * an error. Anything else non-numeric throws, because a `numeric` column cannot contain
 * it: reaching this branch means the wrong column was read, and returning zero would
 * turn a coding mistake into a stock discrepancy that looks like theft.
 */
export function toQty(value: unknown): number {
  if (value === null || value === undefined) return 0;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Quantity must be a finite number, received ${String(value)}`);
    }
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return 0;

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new TypeError(`Quantity is not numeric: ${JSON.stringify(value)}`);
    }
    return parsed;
  }

  throw new TypeError(`Quantity must be a number or a numeric string, received ${typeof value}`);
}

/**
 * Rounds to the precision the database actually stores.
 *
 * Binary floating point cannot represent 0.1, so a sum of tenths drifts — 0.1 + 0.2 is
 * 0.30000000000000004. Printed on a stock report that reads as a broken system, and a
 * storekeeper who stops trusting the numbers stops using the app.
 */
export function roundQty(value: number): number {
  return Math.round(value * FACTOR) / FACTOR;
}

/** Sums quantities off the wire, coercing each and rounding once at the end. */
export function sumQty(values: readonly unknown[]): number {
  let total = 0;
  for (const value of values) total += toQty(value);
  return roundQty(total);
}
