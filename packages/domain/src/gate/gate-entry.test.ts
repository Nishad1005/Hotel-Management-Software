import { describe, expect, test } from "vitest";
import {
  ARRIVAL_TYPES,
  formatDocumentNumber,
  validateGateEntryDraft,
  VEHICLE_MODES,
  type GateEntryDraft,
} from "./gate-entry";

/** The minimal capture path from PRD section 4 Gate 0a: vendor, photo, count. */
function minimalDraft(overrides: Partial<GateEntryDraft> = {}): GateEntryDraft {
  return {
    vendor: { kind: "REGISTERED", partyId: "11111111-1111-1111-1111-111111111111" },
    bill: { kind: "PHOTOGRAPHED", photoRef: "file://bill-1.jpg" },
    packageCount: 3,
    arrivalType: "PO_DELIVERY",
    ...overrides,
  };
}

describe("validateGateEntryDraft — the minimal capture path", () => {
  test("accepts vendor, bill photo and package count alone", () => {
    expect(validateGateEntryDraft(minimalDraft()).ok).toBe(true);
  });

  test("accepts an unregistered vendor captured by name", () => {
    // PRD section 4 Gate 0: a vendor may be created with name + phone at the gate.
    // Acceptance criterion 9 requires an unregistered vendor with no bill to be receivable.
    const draft = minimalDraft({ vendor: { kind: "UNREGISTERED", name: "Bhaskar Fish Supply" } });
    expect(validateGateEntryDraft(draft).ok).toBe(true);
  });

  test("rejects an unregistered vendor with a blank name", () => {
    const draft = minimalDraft({ vendor: { kind: "UNREGISTERED", name: "   " } });
    const result = validateGateEntryDraft(draft);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("VENDOR_REQUIRED");
  });
});

describe("validateGateEntryDraft — 'no bill' is an answer, not a skip", () => {
  // PRD section 4 Gate 0 lists "no bill" as a valid answer, and section 8 designs
  // against click-through. The guard must assert there is no bill, not leave it blank.
  test("accepts an explicit declaration that there is no bill", () => {
    const draft = minimalDraft({ bill: { kind: "NONE" } });
    expect(validateGateEntryDraft(draft).ok).toBe(true);
  });

  test("rejects a bill left unanswered", () => {
    const draft = minimalDraft({ bill: { kind: "UNANSWERED" } });
    const result = validateGateEntryDraft(draft);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("BILL_UNANSWERED");
  });

  test("rejects a photographed bill with no photo attached", () => {
    const draft = minimalDraft({ bill: { kind: "PHOTOGRAPHED", photoRef: "" } });
    const result = validateGateEntryDraft(draft);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("BILL_PHOTO_MISSING");
  });
});

describe("validateGateEntryDraft — package count", () => {
  test("requires at least one package", () => {
    const result = validateGateEntryDraft(minimalDraft({ packageCount: 0 }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("PACKAGE_COUNT_REQUIRED");
  });

  test("rejects a fractional package count", () => {
    // Security counts packages, never weight or volume. PRD section 4 Gate 0.
    const result = validateGateEntryDraft(minimalDraft({ packageCount: 2.5 }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("PACKAGE_COUNT_NOT_WHOLE");
  });
});

describe("validateGateEntryDraft — reports every problem at once", () => {
  test("collects all errors rather than stopping at the first", () => {
    // A guard on a night shift should be told everything that is wrong in one pass,
    // not made to resubmit repeatedly to discover the next problem.
    const result = validateGateEntryDraft({
      vendor: { kind: "UNREGISTERED", name: "" },
      bill: { kind: "UNANSWERED" },
      packageCount: 0,
      arrivalType: "PO_DELIVERY",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining(["VENDOR_REQUIRED", "BILL_UNANSWERED", "PACKAGE_COUNT_REQUIRED"]),
    );
  });
});

describe("optional fields stay optional at the gate", () => {
  test("a hand-cart arrival is valid with no vehicle number", () => {
    // A hand-cart has no registration plate. Requiring one would produce invented data.
    const draft = minimalDraft({ vehicleMode: "HAND_CART" });
    expect(validateGateEntryDraft(draft).ok).toBe(true);
  });
});

describe("formatDocumentNumber", () => {
  test("formats as property, document type and a zero-padded sequence", () => {
    expect(formatDocumentNumber("SB", "GE", 42)).toBe("SB-GE-000042");
  });

  test("does not truncate a sequence that outgrows the padding", () => {
    expect(formatDocumentNumber("SB", "GE", 1234567)).toBe("SB-GE-1234567");
  });

  test("rejects a non-positive sequence", () => {
    expect(() => formatDocumentNumber("SB", "GE", 0)).toThrow();
  });
});

describe("vocabularies", () => {
  test("arrival types cover the PRD list", () => {
    expect([...ARRIVAL_TYPES].sort()).toEqual([
      "MARKET_PURCHASE",
      "PO_DELIVERY",
      "RETURN_FROM_OUTLET",
      "SAMPLE",
      "TRANSFER_IN",
    ]);
  });

  test("vehicle modes include the ones with no registration plate", () => {
    expect(VEHICLE_MODES).toContain("HAND_CART");
    expect(VEHICLE_MODES).toContain("TWO_WHEELER");
  });
});
