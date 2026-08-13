import { describe, expect, it } from "vitest";
import { QUANTITY_DECIMALS, roundQty, sumQty, toQty } from "./quantity";

describe("toQty", () => {
  it("reads the string Postgres actually sends", () => {
    // numeric(14,4) arrives over PostgREST as "18.0000", not 18. Every quantity in this
    // system is numeric, so every quantity arrives as a string.
    expect(toQty("18.0000")).toBe(18);
    expect(toQty("0.5000")).toBe(0.5);
    expect(toQty("1234.5678")).toBe(1234.5678);
  });

  it("passes a number through", () => {
    expect(toQty(18)).toBe(18);
    expect(toQty(0)).toBe(0);
  });

  it("treats absent as zero, because absent is a real answer", () => {
    expect(toQty(null)).toBe(0);
    expect(toQty(undefined)).toBe(0);
    expect(toQty("")).toBe(0);
    expect(toQty("   ")).toBe(0);
  });

  it("throws on something that was never a quantity", () => {
    // Not a data problem — a numeric column cannot hold this. It means the wrong column
    // was read, and silently returning 0 would turn a coding mistake into a stock
    // discrepancy nobody can trace.
    expect(() => toQty("abc")).toThrow();
    expect(() => toQty("12kg")).toThrow();
    expect(() => toQty({})).toThrow();
    expect(() => toQty(Number.NaN)).toThrow();
    expect(() => toQty(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("sumQty", () => {
  it("adds, rather than concatenating", () => {
    // The whole reason this module exists:
    //   ["10", "5", "20"].reduce((s, q) => s + q, 0)  ->  "0105 20"
    expect(sumQty(["10", "5", "20"])).toBe(35);
  });

  it("adds a mixed bag of what the database and the app produce", () => {
    expect(sumQty(["18.0000", 2, null, "0.5000", undefined])).toBe(20.5);
  });

  it("is zero for nothing", () => {
    expect(sumQty([])).toBe(0);
  });

  it("does not leak floating-point noise into a displayed total", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in IEEE 754. On a stock report that reads as
    // 0.30000000000000004 kg, which makes the number look broken and the system with it.
    expect(sumQty(["0.1000", "0.2000"])).toBe(0.3);
    expect(sumQty(["1.1000", "2.2000"])).toBe(3.3);
  });

  it("stays exact across many lines of the same item", () => {
    const hundred = Array.from({ length: 100 }, () => "0.1000");
    expect(sumQty(hundred)).toBe(10);
  });
});

describe("roundQty", () => {
  it("rounds to the precision the column actually holds", () => {
    expect(QUANTITY_DECIMALS).toBe(4);
    expect(roundQty(1.23456789)).toBe(1.2346);
    expect(roundQty(18)).toBe(18);
  });

  it("does not turn a small quantity into nothing", () => {
    // A guard against rounding 0.0001 kg to zero and reporting stock that is not there.
    expect(roundQty(0.0001)).toBe(0.0001);
  });
});
