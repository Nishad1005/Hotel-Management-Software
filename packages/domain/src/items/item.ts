/**
 * The item master. PRD section 4 Gate 2.
 *
 * An item must exist here before anything can be received against it, with no creation
 * at the dock — one of the four hard rules that carry no enforcement mode and no
 * override (PRD section 8). That makes this master the thing receiving is checked
 * against, and the reason its rules are worth stating carefully.
 *
 * These checks mirror constraints in the masters migration. The duplication is
 * deliberate and narrow: the database enforces them because an offline client cannot
 * be trusted, and this enforces them because a form should explain itself rather than
 * surface a constraint violation.
 */

import type { StorageRegime } from "./storage-regime";

export interface ItemDraft {
  code: string;
  name: string;
  categoryId: string;
  baseUomId: string;
  isPerishable: boolean;
  isColdChain: boolean;
  isBatchControlled: boolean;
  storageRegime: StorageRegime;
  shelfLifeDays?: number | undefined;
  minShelfLifePctAtReceipt?: number | undefined;
  tempMinC?: number | undefined;
  tempMaxC?: number | undefined;
}

export type ItemError =
  | "CODE_REQUIRED"
  | "NAME_REQUIRED"
  | "CATEGORY_REQUIRED"
  | "BASE_UOM_REQUIRED"
  | "PERISHABLE_NEEDS_SHELF_LIFE"
  | "PERISHABLE_NEEDS_BATCH_CONTROL"
  | "SHELF_LIFE_INVALID"
  | "COLD_CHAIN_NEEDS_RANGE"
  | "TEMP_RANGE_INVERTED"
  | "MIN_SHELF_LIFE_PCT_INVALID";

export interface ItemValidationResult {
  ok: boolean;
  errors: ItemError[];
}

/** Every problem at once, as everywhere else in this codebase. */
export function validateItemDraft(draft: ItemDraft): ItemValidationResult {
  const errors: ItemError[] = [];

  if (draft.code.trim().length === 0) errors.push("CODE_REQUIRED");
  if (draft.name.trim().length === 0) errors.push("NAME_REQUIRED");
  if (draft.categoryId.trim().length === 0) errors.push("CATEGORY_REQUIRED");
  if (draft.baseUomId.trim().length === 0) errors.push("BASE_UOM_REQUIRED");

  if (draft.shelfLifeDays !== undefined) {
    if (!Number.isInteger(draft.shelfLifeDays) || draft.shelfLifeDays < 1) {
      errors.push("SHELF_LIFE_INVALID");
    }
  }

  if (draft.isPerishable) {
    // Without a shelf life, remaining life cannot be computed and the item silently
    // never expires. A form that refuses is better than a watchlist that lies.
    if (draft.shelfLifeDays === undefined) errors.push("PERISHABLE_NEEDS_SHELF_LIFE");
    // Expiry attaches to a batch. On an item without batches it has nowhere to live.
    if (!draft.isBatchControlled) errors.push("PERISHABLE_NEEDS_BATCH_CONTROL");
  }

  if (draft.isColdChain) {
    // The probe reading at Gate 3 has nothing to be checked against without a range.
    if (draft.tempMinC === undefined || draft.tempMaxC === undefined) {
      errors.push("COLD_CHAIN_NEEDS_RANGE");
    }
  }

  if (
    draft.tempMinC !== undefined &&
    draft.tempMaxC !== undefined &&
    draft.tempMinC > draft.tempMaxC
  ) {
    errors.push("TEMP_RANGE_INVERTED");
  }

  if (draft.minShelfLifePctAtReceipt !== undefined) {
    const pct = draft.minShelfLifePctAtReceipt;
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) errors.push("MIN_SHELF_LIFE_PCT_INVALID");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Item codes are read aloud, written on labels and typed into a search box, so they
 * are normalised rather than merely validated. A code containing a space produces two
 * entries that look identical on a printed label and differ in the database — which is
 * the sort of duplicate nobody finds until a stock count disagrees.
 */
export function normaliseItemCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
