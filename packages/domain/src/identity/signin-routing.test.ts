import { describe, expect, it } from "vitest";
import { looksLikePhone, normalisePhone } from "./phone";

/**
 * The decision sign-in makes before it can ask Supabase anything.
 *
 * A wrong answer here is indistinguishable from a wrong password to the person holding
 * the temporary one they were just given — which is exactly how a provisioned owner
 * ended up unable to log in with the number the console had shown.
 */
describe("which grant sign-in should use", () => {
  it("routes the number the console actually produced to the phone grant", () => {
    expect(looksLikePhone("+918965314563")).toBe(true);
    expect(normalisePhone("+918965314563")).toBe("+918965314563");
  });

  it("accepts the forms a person types instead of E.164", () => {
    for (const typed of ["8965314563", "089653 14563", "+91 89653-14563", "(91) 8965314563"]) {
      expect(looksLikePhone(typed)).toBe(true);
      expect(normalisePhone(typed)).toBe("+918965314563");
    }
  });

  it("sends anything email-shaped to the email grant, untouched", () => {
    for (const typed of ["sunita@voyage.in", "owner+gate@hotel.co.in", "a.b@c.io"]) {
      expect(looksLikePhone(typed)).toBe(false);
    }
  });

  it("refuses a number it cannot complete rather than guessing one", () => {
    // Too short to be a mobile: a guess here mints a login nobody can use.
    expect(normalisePhone("12345")).toBeNull();
    expect(normalisePhone("+1")).toBeNull();
  });
});
