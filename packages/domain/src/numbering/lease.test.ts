import { describe, expect, it } from "vitest";
import {
  addRange,
  LEASE_REFILL_BELOW,
  LEASE_TARGET_DEPTH,
  needsRefill,
  refillCount,
  remainingNumbers,
  spendNumber,
  type NumberLeaseState,
} from "./lease";

/**
 * The client half of ADR 0005, as pure state.
 *
 * The server guarantees ranges never overlap; this module's job is to spend them in
 * order, know when it is running low, and refuse to invent a number when it has none —
 * because a number minted outside a lease is exactly the collision the whole design
 * exists to end.
 */

const fresh = (): NumberLeaseState =>
  addRange(null, { start: 1, end: 5 }, { propertyCode: "SB", prefix: "GE" });

describe("spending a lease", () => {
  it("spends in order and formats like the server allocator", () => {
    const a = spendNumber(fresh());
    expect(a.formatted).toBe("SB-GE-000001");
    const b = spendNumber(a.state);
    expect(b.formatted).toBe("SB-GE-000002");
  });

  it("crosses into the next range without a gap of its own making", () => {
    let state = addRange(fresh(), { start: 40, end: 41 });
    // Spend all five of the first range.
    for (let i = 0; i < 5; i++) state = spendNumber(state).state;
    const next = spendNumber(state);
    // 6..39 is the OTHER device's business; this one continues at its own next range.
    expect(next.formatted).toBe("SB-GE-000040");
  });

  it("throws rather than invent a number outside a lease", () => {
    let state = fresh();
    for (let i = 0; i < 5; i++) state = spendNumber(state).state;
    expect(remainingNumbers(state)).toBe(0);
    expect(() => spendNumber(state)).toThrow(/no leased numbers/i);
  });
});

describe("knowing when to refill", () => {
  it("counts what is left across every range", () => {
    const state = addRange(fresh(), { start: 100, end: 102 });
    expect(remainingNumbers(state)).toBe(8);
  });

  it("no lease at all is the emptiest state there is", () => {
    expect(remainingNumbers(null)).toBe(0);
    expect(needsRefill(null)).toBe(true);
  });

  it("refills below the threshold, not at it", () => {
    const at = addRange(
      null,
      { start: 1, end: LEASE_REFILL_BELOW },
      { propertyCode: "SB", prefix: "GE" },
    );
    expect(needsRefill(at)).toBe(false);
    const below = spendNumber(at).state;
    expect(needsRefill(below)).toBe(true);
  });

  it("asks for exactly enough to reach the target depth", () => {
    expect(refillCount(null)).toBe(LEASE_TARGET_DEPTH);
    const state = fresh();
    expect(refillCount(state)).toBe(LEASE_TARGET_DEPTH - 5);
  });
});

describe("accepting a range from the server", () => {
  it("refuses a range that does not move forward", () => {
    const state = fresh();
    // A duplicate or stale response must not be spendable twice.
    expect(() => addRange(state, { start: 3, end: 8 })).toThrow(/forward/i);
    expect(() => addRange(state, { start: 1, end: 5 })).toThrow(/forward/i);
  });

  it("refuses a backwards or empty range outright", () => {
    expect(() =>
      addRange(null, { start: 5, end: 4 }, { propertyCode: "SB", prefix: "GE" }),
    ).toThrow(/range/i);
    expect(() =>
      addRange(null, { start: 0, end: 4 }, { propertyCode: "SB", prefix: "GE" }),
    ).toThrow(/range/i);
  });

  it("refuses to mix properties in one state", () => {
    const state = fresh();
    expect(() =>
      addRange(state, { start: 10, end: 12 }, { propertyCode: "VV", prefix: "GE" }),
    ).toThrow(/property/i);
  });
});
