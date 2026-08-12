/**
 * Shelf life and expiry.
 *
 * Two different questions live here, and conflating them causes real mistakes:
 *
 *   - AT RECEIPT: "is enough life left to accept this delivery?" measured as a
 *     PERCENTAGE of total shelf life, because a 2-day yoghurt and a 2-year tin are
 *     not comparable in days. PRD section 4 sets the defaults.
 *   - IN STORE: "what do I use first, and what has gone?" measured in DAYS, because
 *     a kitchen plans in days and "34% remaining" tells a chef nothing useful.
 *
 * Time is always passed in, never read (ADR 0009). That keeps these testable without
 * freezing clocks, and it is what lets the same function run on an offline device and
 * on the server with the server's clock winning.
 */

import type { EnforcementMode } from "./enforcement-mode";

const MS_PER_DAY = 86_400_000;

/**
 * Whole days from `asOf` until `bestBefore`. Zero on the day itself.
 *
 * A best-before date means good *before the end of* that day, so the date itself is
 * still usable. Treating it as already gone would throw away a day of good stock on
 * every batch.
 */
export function daysRemaining(bestBefore: number | null, asOf: number): number | null {
  if (bestBefore === null) return null;
  return Math.floor((startOfDay(bestBefore) - startOfDay(asOf)) / MS_PER_DAY);
}

/**
 * Percentage of total shelf life still left, 0–100.
 *
 * Clamped at both ends. Negative would mean "minus forty percent remaining", which is
 * noise on a screen; above one hundred happens when a delivery arrives fresher than
 * its stated shelf life allows, which is a data problem, not a bonus.
 */
export function shelfLifeRemainingPct(
  bestBefore: number | null,
  totalDays: number | null,
  asOf: number,
): number | null {
  if (bestBefore === null) return null;
  if (totalDays === null || totalDays <= 0) return null;

  const left = daysRemaining(bestBefore, asOf);
  if (left === null) return null;

  const pct = (left / totalDays) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export type ExpiryState = "FRESH" | "NEARING" | "CRITICAL" | "EXPIRED";

export interface ExpiryThresholds {
  /** Days at or below which stock needs using now. */
  criticalDays: number;
  /** Days at or below which stock should be planned for. */
  nearingDays: number;
}

/**
 * Which bucket a batch belongs in.
 *
 * Stock with no best-before date is FRESH rather than EXPIRED. Non-perishables have
 * no date at all, and treating absence as expiry would fill the watchlist with rice
 * and cleaning chemicals until nobody looked at it.
 */
export function expiryStatus(
  bestBefore: number | null,
  asOf: number,
  thresholds: ExpiryThresholds,
): ExpiryState {
  const left = daysRemaining(bestBefore, asOf);
  if (left === null) return "FRESH";
  if (left < 0) return "EXPIRED";
  if (left <= thresholds.criticalDays) return "CRITICAL";
  if (left <= thresholds.nearingDays) return "NEARING";
  return "FRESH";
}

export interface MinimumShelfLifeResult {
  /** False when the percentage or the threshold is unknown; nothing can be judged. */
  applicable: boolean;
  /** Whether the delivery meets the threshold. True when not applicable. */
  ok: boolean;
  /** How many percentage points short, when it falls short. */
  shortfallPct: number | null;
  /** Whether this should actually stop the receipt, per the rule's enforcement mode. */
  blocks: boolean;
}

/**
 * The receipt rule from PRD section 4.
 *
 * Returns an enforcement-aware result rather than a bare boolean, because the answer
 * to "does this fail?" and the answer to "should that stop anything?" are different
 * questions. Every rule ships RECORD_ONLY (PRD section 8): where a property cannot
 * actually refuse a delivery, the system must not pretend it can, or the storekeeper
 * clicks through and the record ends up carrying a false assertion instead of an
 * honest gap.
 */
export function meetsMinimumShelfLife(
  pctRemaining: number | null,
  thresholdPct: number | null,
  mode: EnforcementMode,
): MinimumShelfLifeResult {
  if (pctRemaining === null || thresholdPct === null) {
    return { applicable: false, ok: true, shortfallPct: null, blocks: false };
  }

  const ok = pctRemaining >= thresholdPct;
  return {
    applicable: true,
    ok,
    shortfallPct: ok ? null : Math.round(thresholdPct - pctRemaining),
    blocks: !ok && mode === "BLOCK",
  };
}

export interface FefoCandidate {
  bestBefore: number | null;
}

/**
 * First-expired-first-out.
 *
 * Undated batches sort LAST. Sorting them first would issue stock with no known
 * expiry ahead of stock about to expire, which is precisely backwards. Among
 * themselves they keep insertion order, so FEFO degrades to FIFO rather than to
 * something arbitrary.
 */
export function sortByFefo<T extends FefoCandidate>(batches: readonly T[]): T[] {
  return [...batches]
    .map((batch, index) => ({ batch, index }))
    .sort((a, b) => {
      const left = a.batch.bestBefore;
      const right = b.batch.bestBefore;
      if (left === null && right === null) return a.index - b.index;
      if (left === null) return 1;
      if (right === null) return -1;
      if (left !== right) return left - right;
      return a.index - b.index;
    })
    .map(({ batch }) => batch);
}

/** Calendar days, not elapsed milliseconds: expiry is a date, not a timestamp. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
