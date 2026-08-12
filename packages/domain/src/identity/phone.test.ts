import { describe, expect, it } from "vitest";
import { looksLikePhone, normalisePhone } from "./phone";

describe("normalisePhone", () => {
  it("turns a bare ten-digit Indian mobile into E.164", () => {
    expect(normalisePhone("9829012345")).toBe("+919829012345");
  });

  it("accepts the spacing people actually type", () => {
    expect(normalisePhone("98290 12345")).toBe("+919829012345");
    expect(normalisePhone("98290-12345")).toBe("+919829012345");
    expect(normalisePhone(" (98290) 12345 ")).toBe("+919829012345");
  });

  it("strips a single trunk zero", () => {
    // Written on a card as 098290-12345 far more often than not.
    expect(normalisePhone("098290-12345")).toBe("+919829012345");
  });

  it("accepts the country code with or without the plus", () => {
    expect(normalisePhone("+91 98290 12345")).toBe("+919829012345");
    expect(normalisePhone("919829012345")).toBe("+919829012345");
  });

  it("leaves an explicit international number alone", () => {
    expect(normalisePhone("+1 415 555 0123")).toBe("+14155550123");
    expect(normalisePhone("+971 50 123 4567")).toBe("+971501234567");
  });

  it("refuses anything with letters, so an email is never mistaken for a number", () => {
    expect(normalisePhone("chef@example.com")).toBeNull();
    expect(normalisePhone("9829O12345")).toBeNull(); // capital O, not zero
  });

  it("refuses lengths that cannot be a number", () => {
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone("   ")).toBeNull();
    expect(normalisePhone("12345")).toBeNull();
    expect(normalisePhone("+1234567")).toBeNull(); // under the E.164 floor
    expect(normalisePhone("+1234567890123456")).toBeNull(); // over the E.164 ceiling of 15
  });

  it("refuses a nine or eleven digit domestic number rather than guessing", () => {
    // Guessing here would create a login nobody can sign in to, and the admin reads
    // the number back off the screen believing it is right.
    expect(normalisePhone("982901234")).toBeNull();
    expect(normalisePhone("98290123456")).toBeNull();
  });

  it("takes a different default country when one is given", () => {
    expect(normalisePhone("501234567", "+971")).toBe(null);
    expect(normalisePhone("5012345678", "+971")).toBe("+9715012345678");
  });
});

describe("looksLikePhone", () => {
  it("separates a number from an email so sign-in can pick a lane", () => {
    expect(looksLikePhone("9829012345")).toBe(true);
    expect(looksLikePhone("+91 98290 12345")).toBe(true);
    expect(looksLikePhone("098290-12345")).toBe(true);

    expect(looksLikePhone("chef@example.com")).toBe(false);
    expect(looksLikePhone("storekeeper")).toBe(false);
    expect(looksLikePhone("")).toBe(false);
  });

  it("is not fooled by a short run of digits", () => {
    expect(looksLikePhone("12345")).toBe(false);
  });
});
