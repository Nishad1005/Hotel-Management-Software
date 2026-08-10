import { describe, expect, test } from "vitest";
import {
  assertTransition,
  canTransition,
  IllegalStockTransitionError,
  isIssuable,
  STOCK_STATES,
} from "./state-machine";

describe("isIssuable", () => {
  test("only AVAILABLE stock can be issued", () => {
    const issuable = STOCK_STATES.filter(isIssuable);
    expect(issuable).toEqual(["AVAILABLE"]);
  });
});

describe("canTransition — the inbound path", () => {
  test("put-away moves stock from QUARANTINE to AVAILABLE", () => {
    expect(canTransition("QUARANTINE", "AVAILABLE", "PUT_AWAY")).toBe(true);
  });

  test("put-away is the only way out of QUARANTINE into a zone", () => {
    expect(canTransition("QUARANTINE", "AVAILABLE", "ISSUE")).toBe(false);
  });
});

describe("canTransition — rejected stock can never reach a zone", () => {
  // PRD section 4 Gate 4 and section 8 hard rule 3. No enforcement mode, no override.
  const zoneStates = ["AVAILABLE", "TRANSIT", "ISSUED", "BLOCKED"] as const;

  test.each(zoneStates)("REJECT_HOLD cannot become %s under any trigger", (target) => {
    for (const trigger of [
      "PUT_AWAY",
      "ISSUE",
      "RETURN_TO_STORE",
      "TRANSFER_DESPATCH",
      "TRANSFER_RECEIPT",
      "STAGE_OUT",
      "FSO_HOLD",
      "FSO_RELEASE",
    ] as const) {
      expect(canTransition("REJECT_HOLD", target, trigger)).toBe(false);
    }
  });

  test("rejected stock leaves only by being staged for dispatch", () => {
    expect(canTransition("REJECT_HOLD", "STAGED_OUT", "STAGE_OUT")).toBe(true);
  });
});

describe("canTransition — internal movement", () => {
  test("stock entering an inter-zone transfer becomes TRANSIT", () => {
    expect(canTransition("AVAILABLE", "TRANSIT", "TRANSFER_DESPATCH")).toBe(true);
  });

  test("stock is issuable at neither end while in TRANSIT", () => {
    expect(isIssuable("TRANSIT")).toBe(false);
  });

  test("a received transfer returns to AVAILABLE", () => {
    expect(canTransition("TRANSIT", "AVAILABLE", "TRANSFER_RECEIPT")).toBe(true);
  });

  test("stock issued to a department leaves the zone", () => {
    expect(canTransition("AVAILABLE", "ISSUED", "ISSUE")).toBe(true);
  });

  test("a return to store makes stock available again", () => {
    expect(canTransition("ISSUED", "AVAILABLE", "RETURN_TO_STORE")).toBe(true);
  });
});

describe("canTransition — FSO hold", () => {
  test("the FSO can block available stock", () => {
    expect(canTransition("AVAILABLE", "BLOCKED", "FSO_HOLD")).toBe(true);
  });

  test("blocked stock is not issuable", () => {
    expect(isIssuable("BLOCKED")).toBe(false);
  });

  test("the FSO can release a hold", () => {
    expect(canTransition("BLOCKED", "AVAILABLE", "FSO_RELEASE")).toBe(true);
  });

  test("blocked stock cannot be issued while the hold stands", () => {
    expect(canTransition("BLOCKED", "ISSUED", "ISSUE")).toBe(false);
  });
});

describe("canTransition — outbound", () => {
  test("stock staged at T2 is not issuable", () => {
    expect(isIssuable("STAGED_OUT")).toBe(false);
  });

  test("a cancelled dispatch returns staged stock to its zone", () => {
    expect(canTransition("STAGED_OUT", "AVAILABLE", "DISPATCH_CANCELLED")).toBe(true);
  });

  test("staging never reaches back into quarantine", () => {
    expect(canTransition("STAGED_OUT", "QUARANTINE", "DISPATCH_CANCELLED")).toBe(false);
  });
});

describe("assertTransition", () => {
  test("returns nothing for a legal transition", () => {
    expect(() => assertTransition("QUARANTINE", "AVAILABLE", "PUT_AWAY")).not.toThrow();
  });

  test("throws IllegalStockTransitionError naming both states and the trigger", () => {
    let caught: unknown;
    try {
      assertTransition("REJECT_HOLD", "AVAILABLE", "PUT_AWAY");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(IllegalStockTransitionError);
    const error = caught as IllegalStockTransitionError;
    expect(error.from).toBe("REJECT_HOLD");
    expect(error.to).toBe("AVAILABLE");
    expect(error.trigger).toBe("PUT_AWAY");
    expect(error.message).toContain("REJECT_HOLD");
    expect(error.message).toContain("AVAILABLE");
  });
});

describe("the state list", () => {
  test("covers exactly the seven states in PRD section 3.2", () => {
    expect([...STOCK_STATES].sort()).toEqual([
      "AVAILABLE",
      "BLOCKED",
      "ISSUED",
      "QUARANTINE",
      "REJECT_HOLD",
      "STAGED_OUT",
      "TRANSIT",
    ]);
  });
});
