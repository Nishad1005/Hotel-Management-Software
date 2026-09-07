import { describe, expect, it } from "vitest";
import { GOLAI_MODULES, moduleAllows, moduleLabel } from "./modules";

describe("the module registry", () => {
  it("has no duplicate keys, since the key is what the server is asked about", () => {
    const keys = GOLAI_MODULES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every module a label and a sentence a hotelier would recognise", () => {
    for (const m of GOLAI_MODULES) {
      expect(m.label.length).toBeGreaterThan(0);
      // The blurb is what the platform console shows beside a checkbox that removes a
      // module for an entire property. "GATE" is not enough to decide that on.
      expect(m.blurb.length).toBeGreaterThan(20);
    }
  });
});

describe("moduleAllows", () => {
  it("refuses while the answer is still in flight, so nothing flashes into the nav", () => {
    // The moment between sign-in and the first response. Returning true here would
    // show every module and then take some away.
    expect(moduleAllows(undefined, "GATE")).toBe(false);
  });

  it("refuses a module the server did not mention", () => {
    // Matches the database, where an unrecognised key resolves to `not true`. A typo
    // must deny rather than grant.
    expect(moduleAllows({ GATE: true }, "RECEIVING")).toBe(false);
    expect(moduleAllows({}, "GATE")).toBe(false);
  });

  it("reports exactly what the server said, and nothing it inferred", () => {
    const map = { GATE: true, RECEIVING: false };
    expect(moduleAllows(map, "GATE")).toBe(true);
    expect(moduleAllows(map, "RECEIVING")).toBe(false);
  });

  it("treats a non-boolean as a refusal rather than a truthy value", () => {
    // A malformed response is not permission. `"true"` and `1` are both wrong answers
    // to a yes/no question, and the safe reading of a wrong answer is no.
    expect(moduleAllows({ GATE: "true" } as never, "GATE")).toBe(false);
    expect(moduleAllows({ GATE: 1 } as never, "GATE")).toBe(false);
  });
});

describe("moduleLabel", () => {
  it("names a module for a person", () => {
    expect(moduleLabel("TEMPERATURE")).toBe("Temperature rounds");
  });

  it("falls back to the key rather than showing nothing", () => {
    // A newer server can hold a module this build predates. Showing "PROCUREMENT" is
    // ugly; showing an empty row is a bug report.
    expect(moduleLabel("PROCUREMENT")).toBe("PROCUREMENT");
  });
});
