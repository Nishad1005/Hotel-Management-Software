import { describe, expect, test } from "vitest";
import {
  daysRemaining,
  expiryStatus,
  meetsMinimumShelfLife,
  shelfLifeRemainingPct,
  sortByFefo,
  type ExpiryThresholds,
} from "./shelf-life";

/** Dates are handled as calendar days, so the tests read as calendar days. */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const TODAY = day("2026-08-12");

describe("daysRemaining", () => {
  test("counts whole days to the best-before date", () => {
    expect(daysRemaining(day("2026-08-15"), TODAY)).toBe(3);
  });

  test("is zero on the best-before date itself", () => {
    // Best BEFORE the end of that day, so the day itself is still usable.
    expect(daysRemaining(day("2026-08-12"), TODAY)).toBe(0);
  });

  test("goes negative once the date has passed", () => {
    expect(daysRemaining(day("2026-08-10"), TODAY)).toBe(-2);
  });

  test("is null when there is no best-before date", () => {
    expect(daysRemaining(null, TODAY)).toBeNull();
  });
});

describe("shelfLifeRemainingPct", () => {
  test("halfway through a ten day life is fifty percent", () => {
    expect(shelfLifeRemainingPct(day("2026-08-17"), 10, TODAY)).toBe(50);
  });

  test("a full life remaining reads as one hundred", () => {
    expect(shelfLifeRemainingPct(day("2026-08-22"), 10, TODAY)).toBe(100);
  });

  test("expired stock reads as zero, never negative", () => {
    // A watchlist showing "-40% remaining" is noise. Expired is expired.
    expect(shelfLifeRemainingPct(day("2026-08-08"), 10, TODAY)).toBe(0);
  });

  test("is capped at one hundred when a delivery arrives fresher than its stated life", () => {
    expect(shelfLifeRemainingPct(day("2026-09-30"), 10, TODAY)).toBe(100);
  });

  test("is null without a best-before date", () => {
    expect(shelfLifeRemainingPct(null, 10, TODAY)).toBeNull();
  });

  test("is null without a total shelf life, rather than dividing by zero", () => {
    expect(shelfLifeRemainingPct(day("2026-08-15"), null, TODAY)).toBeNull();
    expect(shelfLifeRemainingPct(day("2026-08-15"), 0, TODAY)).toBeNull();
  });
});

describe("expiryStatus", () => {
  const thresholds: ExpiryThresholds = { criticalDays: 2, nearingDays: 7 };

  test("past the best-before date is EXPIRED", () => {
    expect(expiryStatus(day("2026-08-11"), TODAY, thresholds)).toBe("EXPIRED");
  });

  test("the best-before date itself is not yet expired", () => {
    // Use-it-today, not throw-it-away. Calling it expired a day early is waste.
    expect(expiryStatus(day("2026-08-12"), TODAY, thresholds)).toBe("CRITICAL");
  });

  test("within the critical window is CRITICAL", () => {
    expect(expiryStatus(day("2026-08-14"), TODAY, thresholds)).toBe("CRITICAL");
  });

  test("within the nearing window is NEARING", () => {
    expect(expiryStatus(day("2026-08-18"), TODAY, thresholds)).toBe("NEARING");
  });

  test("beyond the nearing window is FRESH", () => {
    expect(expiryStatus(day("2026-09-30"), TODAY, thresholds)).toBe("FRESH");
  });

  test("stock with no best-before date is FRESH, not EXPIRED", () => {
    // Non-perishables have no date. Treating absence as expiry would fill the
    // watchlist with rice and cleaning chemicals and make it useless.
    expect(expiryStatus(null, TODAY, thresholds)).toBe("FRESH");
  });
});

describe("meetsMinimumShelfLife", () => {
  // PRD section 4: dairy and bakery 60%, chilled meat and fish 70%, frozen and
  // packaged 75%, dry provisions 70%. The rule is checked at RECEIPT, against the
  // percentage remaining, which is a different question from the watchlist's.
  test("passes when enough life remains", () => {
    const result = meetsMinimumShelfLife(72, 70, "BLOCK");
    expect(result.ok).toBe(true);
  });

  test("fails when too little remains", () => {
    const result = meetsMinimumShelfLife(55, 70, "BLOCK");
    expect(result.ok).toBe(false);
    expect(result.shortfallPct).toBe(15);
  });

  test("exactly at the threshold passes", () => {
    expect(meetsMinimumShelfLife(70, 70, "BLOCK").ok).toBe(true);
  });

  test("under RECORD_ONLY a failure is recorded but does not block", () => {
    // PRD section 8: every rule ships RECORD_ONLY. Where the property cannot refuse a
    // delivery, the system must not pretend it can — an unenforceable rule produces
    // click-through, and the record then carries a false assertion.
    const result = meetsMinimumShelfLife(40, 70, "RECORD_ONLY");
    expect(result.ok).toBe(false);
    expect(result.blocks).toBe(false);
  });

  test("under WARN a failure warns but does not block", () => {
    expect(meetsMinimumShelfLife(40, 70, "WARN").blocks).toBe(false);
  });

  test("under BLOCK a failure blocks", () => {
    expect(meetsMinimumShelfLife(40, 70, "BLOCK").blocks).toBe(true);
  });

  test("passing never blocks, whatever the mode", () => {
    expect(meetsMinimumShelfLife(90, 70, "BLOCK").blocks).toBe(false);
  });

  test("is not applicable when the percentage is unknown", () => {
    const result = meetsMinimumShelfLife(null, 70, "BLOCK");
    expect(result.applicable).toBe(false);
    expect(result.blocks).toBe(false);
  });

  test("is not applicable when the category sets no threshold", () => {
    expect(meetsMinimumShelfLife(30, null, "BLOCK").applicable).toBe(false);
  });
});

describe("sortByFefo", () => {
  test("orders by earliest expiry first", () => {
    const sorted = sortByFefo([
      { id: "c", bestBefore: day("2026-09-01") },
      { id: "a", bestBefore: day("2026-08-14") },
      { id: "b", bestBefore: day("2026-08-20") },
    ]);
    expect(sorted.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  test("puts undated batches last, not first", () => {
    // An undated batch sorted first would be issued ahead of stock that is about to
    // expire, which is the exact opposite of what FEFO is for.
    const sorted = sortByFefo([
      { id: "undated", bestBefore: null },
      { id: "soon", bestBefore: day("2026-08-14") },
      { id: "later", bestBefore: day("2026-09-01") },
    ]);
    expect(sorted.map((b) => b.id)).toEqual(["soon", "later", "undated"]);
  });

  test("keeps insertion order among undated batches", () => {
    // With nothing to sort by, FEFO degrades to FIFO rather than to an arbitrary order.
    const sorted = sortByFefo([
      { id: "first", bestBefore: null },
      { id: "second", bestBefore: null },
    ]);
    expect(sorted.map((b) => b.id)).toEqual(["first", "second"]);
  });

  test("does not mutate the input", () => {
    const input = [
      { id: "b", bestBefore: day("2026-09-01") },
      { id: "a", bestBefore: day("2026-08-14") },
    ];
    sortByFefo(input);
    expect(input.map((b) => b.id)).toEqual(["b", "a"]);
  });
});
