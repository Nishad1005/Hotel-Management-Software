import { describe, expect, test } from "vitest";
import { normaliseItemCode, validateItemDraft, type ItemDraft } from "./item";

function draft(overrides: Partial<ItemDraft> = {}): ItemDraft {
  return {
    code: "MILK-1L",
    name: "Toned Milk 1L",
    categoryId: "cat-1",
    baseUomId: "uom-kg",
    isPerishable: false,
    isColdChain: false,
    isBatchControlled: false,
    storageRegime: "AMBIENT",
    ...overrides,
  };
}

describe("the basics", () => {
  test("accepts a minimal non-perishable item", () => {
    expect(validateItemDraft(draft()).ok).toBe(true);
  });

  test("requires a code", () => {
    const result = validateItemDraft(draft({ code: "  " }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("CODE_REQUIRED");
  });

  test("requires a name", () => {
    const result = validateItemDraft(draft({ name: "" }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("NAME_REQUIRED");
  });

  test("requires a category", () => {
    expect(validateItemDraft(draft({ categoryId: "" })).errors).toContain("CATEGORY_REQUIRED");
  });

  test("requires a base unit", () => {
    expect(validateItemDraft(draft({ baseUomId: "" })).errors).toContain("BASE_UOM_REQUIRED");
  });
});

describe("perishables must be computable", () => {
  test("a perishable item needs a shelf life", () => {
    // Without one, remaining shelf life cannot be computed and the item silently
    // never expires — worse than a rejected form, because nobody finds out.
    const result = validateItemDraft(
      draft({ isPerishable: true, isBatchControlled: true, shelfLifeDays: undefined }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("PERISHABLE_NEEDS_SHELF_LIFE");
  });

  test("a perishable item must be batch controlled", () => {
    // Expiry attaches to a batch. On an item without batches it has nowhere to live.
    const result = validateItemDraft(
      draft({ isPerishable: true, shelfLifeDays: 5, isBatchControlled: false }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("PERISHABLE_NEEDS_BATCH_CONTROL");
  });

  test("accepts a properly configured perishable", () => {
    const result = validateItemDraft(
      draft({ isPerishable: true, isBatchControlled: true, shelfLifeDays: 5 }),
    );
    expect(result.ok).toBe(true);
  });

  test("rejects a zero or negative shelf life", () => {
    expect(
      validateItemDraft(draft({ isPerishable: true, isBatchControlled: true, shelfLifeDays: 0 }))
        .errors,
    ).toContain("SHELF_LIFE_INVALID");
  });

  test("rejects a fractional shelf life", () => {
    expect(
      validateItemDraft(draft({ isPerishable: true, isBatchControlled: true, shelfLifeDays: 2.5 }))
        .errors,
    ).toContain("SHELF_LIFE_INVALID");
  });
});

describe("cold chain", () => {
  test("a cold-chain item needs a temperature range", () => {
    // The probe reading at Gate 3 has nothing to be checked against without one.
    const result = validateItemDraft(draft({ isColdChain: true }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("COLD_CHAIN_NEEDS_RANGE");
  });

  test("accepts a cold-chain item with a range", () => {
    const result = validateItemDraft(
      draft({ isColdChain: true, tempMinC: 0, tempMaxC: 4, storageRegime: "CHILLED" }),
    );
    expect(result.ok).toBe(true);
  });

  test("rejects an inverted temperature range", () => {
    const result = validateItemDraft(draft({ isColdChain: true, tempMinC: 4, tempMaxC: 0 }));
    expect(result.errors).toContain("TEMP_RANGE_INVERTED");
  });

  test("accepts a range that is a single temperature", () => {
    const result = validateItemDraft(
      draft({ isColdChain: true, tempMinC: -18, tempMaxC: -18, storageRegime: "FROZEN" }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("minimum shelf life at receipt", () => {
  test("accepts a percentage within range", () => {
    const result = validateItemDraft(
      draft({
        isPerishable: true,
        isBatchControlled: true,
        shelfLifeDays: 5,
        minShelfLifePctAtReceipt: 60,
      }),
    );
    expect(result.ok).toBe(true);
  });

  test("rejects a percentage above 100", () => {
    expect(validateItemDraft(draft({ minShelfLifePctAtReceipt: 120 })).errors).toContain(
      "MIN_SHELF_LIFE_PCT_INVALID",
    );
  });

  test("rejects a negative percentage", () => {
    expect(validateItemDraft(draft({ minShelfLifePctAtReceipt: -1 })).errors).toContain(
      "MIN_SHELF_LIFE_PCT_INVALID",
    );
  });
});

describe("reports every problem at once", () => {
  test("collects all errors rather than stopping at the first", () => {
    const result = validateItemDraft({
      code: "",
      name: "",
      categoryId: "",
      baseUomId: "",
      isPerishable: true,
      isColdChain: true,
      isBatchControlled: false,
      storageRegime: "AMBIENT",
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "CODE_REQUIRED",
        "NAME_REQUIRED",
        "CATEGORY_REQUIRED",
        "BASE_UOM_REQUIRED",
        "PERISHABLE_NEEDS_SHELF_LIFE",
        "PERISHABLE_NEEDS_BATCH_CONTROL",
        "COLD_CHAIN_NEEDS_RANGE",
      ]),
    );
  });
});

describe("normaliseItemCode", () => {
  test("uppercases and trims", () => {
    expect(normaliseItemCode("  milk-1l  ")).toBe("MILK-1L");
  });

  test("collapses internal whitespace to a dash", () => {
    // Codes get read aloud and typed. A space in the middle produces two codes that
    // look identical on a label.
    expect(normaliseItemCode("milk 1l")).toBe("MILK-1L");
  });

  test("strips characters that cannot survive a label or a barcode", () => {
    expect(normaliseItemCode("milk/1l#2")).toBe("MILK-1L-2");
  });

  test("does not leave leading or trailing dashes", () => {
    expect(normaliseItemCode("--milk--")).toBe("MILK");
  });
});
