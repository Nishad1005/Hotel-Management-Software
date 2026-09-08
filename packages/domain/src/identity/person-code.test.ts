import { describe, expect, it } from "vitest";
import {
  dammCheckDigit,
  dammIsValid,
  isPersonCode,
  parsePersonCode,
  personCode,
  PERSON_SEQUENCE_DIGITS,
} from "./person-code";

describe("the Damm check digit", () => {
  it("appends a digit that makes the run validate", () => {
    for (let n = 0; n < 2000; n++) {
      const digits = String(n).padStart(4, "0");
      expect(dammIsValid(digits + dammCheckDigit(digits))).toBe(true);
    }
  });

  /*
    The two properties the scheme is chosen for, swept exhaustively over the whole
    four-digit series rather than spot-checked. A transcription slip in the operation
    table would not break these functions — it would quietly weaken them, and a handful
    of examples would still pass. These two sweeps are therefore also the structural
    check on the table itself: a malformed quasigroup cannot survive them.

    Counterexamples are collected and asserted once. The first version put an `expect`
    inside the innermost loop — half a million of them — and vitest timed out at five
    seconds, which is reported at the `it` line and reads exactly like the check digit
    being broken. It was not; collecting is both faster and names the input that failed.
  */
  it("detects every single-digit substitution", () => {
    const missed: string[] = [];
    for (let n = 0; n < 10000; n++) {
      const body = String(n).padStart(4, "0");
      const full = body + dammCheckDigit(body);
      for (let pos = 0; pos < full.length; pos++) {
        for (let d = 0; d <= 9; d++) {
          if (full[pos] === String(d)) continue;
          const corrupted = full.slice(0, pos) + d + full.slice(pos + 1);
          if (dammIsValid(corrupted)) missed.push(`${full} -> ${corrupted}`);
        }
      }
    }
    expect(missed).toEqual([]);
  });

  it("detects every adjacent transposition", () => {
    const missed: string[] = [];
    for (let n = 0; n < 10000; n++) {
      const body = String(n).padStart(4, "0");
      const full = body + dammCheckDigit(body);
      for (let pos = 0; pos + 1 < full.length; pos++) {
        if (full[pos] === full[pos + 1]) continue;
        const swapped = full.slice(0, pos) + full[pos + 1] + full[pos] + full.slice(pos + 2);
        if (dammIsValid(swapped)) missed.push(`${full} -> ${swapped}`);
      }
    }
    expect(missed).toEqual([]);
  });

  /*
    The vectors the SQL side asserts too.

    app.damm_check_digit in 20260908031449_person_master.sql and dammCheckDigit here are
    the same rule written twice — the server mints codes because only it holds the
    sequence, the device validates a scan because at the dock there may be no network.
    Neither copy can be dropped, so these four numbers and two codes appear verbatim in
    supabase/tests/032-person-master.test.sql. If the implementations ever drift, one of
    the two suites fails instead of a storekeeper meeting a card the app refuses.

    Computed from this implementation and then transcribed there — not guessed. The
    first draft of the SQL test asserted four invented values and every one was wrong.
  */
  it("matches the vectors the database asserts", () => {
    expect(dammCheckDigit("0001")).toBe(3);
    expect(dammCheckDigit("0042")).toBe(7);
    expect(dammCheckDigit("0427")).toBe(0);
    expect(dammCheckDigit("9999")).toBe(2);
    expect(personCode("PA", 1)).toBe("PA-EMP-00013");
    expect(personCode("PA", 2)).toBe("PA-EMP-00021");
  });

  it("rejects a run that is not digits", () => {
    expect(dammIsValid("12a4")).toBe(false);
    expect(dammIsValid("")).toBe(false);
  });
});

describe("personCode", () => {
  it("builds the property's own series", () => {
    const code = personCode("TW", 427);
    expect(code).toMatch(/^TW-EMP-\d{5}$/);
    expect(code.startsWith("TW-EMP-0427")).toBe(true);
  });

  it("round-trips through the parser", () => {
    for (const n of [1, 9, 10, 99, 100, 999, 1000, 9999]) {
      const parsed = parsePersonCode(personCode("TW", n));
      expect(parsed).toEqual({ propertyCode: "TW", sequence: n });
    }
  });

  it("normalises the property code it is given", () => {
    expect(personCode(" tw ", 1)).toBe(personCode("TW", 1));
  });

  it("refuses a sequence outside the series rather than reissuing a number", () => {
    // Widening silently would print cards that no longer match the stock already issued,
    // and clamping would hand two people the same number.
    expect(() => personCode("TW", 10000)).toThrow();
    expect(() => personCode("TW", 0)).toThrow();
    expect(() => personCode("TW", -1)).toThrow();
    expect(() => personCode("TW", 1.5)).toThrow();
  });

  it("refuses a property code that is not one", () => {
    expect(() => personCode("", 1)).toThrow();
    expect(() => personCode("TOO-LONG-CODE", 1)).toThrow();
  });
});

describe("parsePersonCode", () => {
  it("returns null for anything that is not a valid card", () => {
    const good = personCode("TW", 42);
    const badCheck = good.slice(0, -1) + ((Number(good.slice(-1)) + 1) % 10);

    expect(parsePersonCode(badCheck)).toBeNull();
    expect(parsePersonCode("TW-VEN-00427")).toBeNull(); // another series
    expect(parsePersonCode("TW-EMP-0427")).toBeNull(); // no check digit
    expect(parsePersonCode("TW-EMP-004271")).toBeNull(); // too long
    expect(parsePersonCode("not a code")).toBeNull();
    expect(parsePersonCode("")).toBeNull();
  });

  it("accepts a scan that arrives lowercase or padded with spaces", () => {
    const code = personCode("TW", 88);
    expect(parsePersonCode(`  ${code.toLowerCase()}  `)).toEqual({
      propertyCode: "TW",
      sequence: 88,
    });
  });

  it("rejects sequence zero even when the check digit is right", () => {
    const zeros = "0".repeat(PERSON_SEQUENCE_DIGITS);
    expect(parsePersonCode(`TW-EMP-${zeros}${dammCheckDigit(zeros)}`)).toBeNull();
  });

  it("isPersonCode agrees with the parser", () => {
    expect(isPersonCode(personCode("TW", 7))).toBe(true);
    expect(isPersonCode("TW-EMP-99999")).toBe(dammIsValid("99999"));
  });
});
