import { findColumn, parseCsv } from "../csv/csv";

/**
 * Reading a property's item list.
 *
 * This is the longest-lead piece of any onboarding — several hundred rows that nobody
 * wants to type twice — so the importer bends to whatever spreadsheet already exists
 * rather than asking for a reformat.
 *
 * It reads and reports; it does not decide. Resolving a category name to an id and
 * validating the result belongs to the caller, which has the property's masters in
 * hand. Keeping those apart is what lets the whole preview be tested without a
 * database.
 */

/**
 * Header aliases, most specific first.
 *
 * `definition` leads the type list because that is the heading one real client uses,
 * and it has to win over a generic "type" in a file containing both.
 */
export const ITEM_COLUMN_ALIASES = {
  code: ["itemcode", "productcode", "code", "sku"],
  name: ["itemname", "name", "particular", "particulars", "description", "item"],
  type: ["definition", "type", "itemtype", "producttype"],
  category: ["category", "group"],
  subCategory: ["subcategory", "subgroup"],
  uom: ["uom", "unit", "units"],
  barcode: ["barcode", "ean", "upc"],
  /**
   * Optional, and the difference between a stock list and this product.
   *
   * Without a shelf life an item cannot be perishable — the schema refuses it, because a
   * perishable whose expiry can never be computed is worse than one nobody claimed was
   * perishable. So a sheet with this column imports items that appear in the expiry
   * watchlist on day one, and a sheet without it imports items somebody has to go back
   * and mark by hand.
   */
  shelfLifeDays: ["shelflifedays", "shelflife", "shelflifeindays", "expirydays", "daystoexpiry"],
} as const;

export interface ItemSheetRow {
  /** Null when the property has no code of their own for this line. */
  code: string | null;
  name: string;
  type: string | null;
  category: string | null;
  subCategory: string | null;
  uom: string | null;
  barcode: string | null;
  /**
   * Whole positive days, or null.
   *
   * Null covers three different sheets — no column, a blank cell, and "n/a" — and all
   * three mean the same thing here: nothing is known, so nothing is claimed.
   */
  shelfLifeDays: number | null;
  /** 1-based line in the original file, so an error points at a row they can find. */
  line: number;
}

export interface ItemSheet {
  ok: boolean;
  /** Set when the file could not be read at all. */
  problem?: string;
  rows: ItemSheetRow[];
  withCode: number;
  needingCode: number;
  /** Rows dropped for having no name. */
  skipped: number;
  /** Codes appearing more than once in the file. */
  duplicates: string[];
}

const empty = (problem: string): ItemSheet => ({
  ok: false,
  problem,
  rows: [],
  withCode: 0,
  needingCode: 0,
  skipped: 0,
  duplicates: [],
});

export function readItemSheet(text: string): ItemSheet {
  const grid = parseCsv(text);

  if (grid.length < 2) {
    return empty("That file has no rows in it — a header line plus at least one item.");
  }

  const headers = grid[0] ?? [];
  const at = (aliases: readonly string[]) => findColumn(headers, aliases);

  const nameCol = at(ITEM_COLUMN_ALIASES.name);
  if (nameCol === null) {
    // Naming what was found is the difference between a fixable error and a shrug.
    return empty(
      `No "Item Name" column. Headers seen: ${headers.join(", ") || "(none)"}. ` +
        "Rename one of them, or add a column called Item Name.",
    );
  }

  const codeCol = at(ITEM_COLUMN_ALIASES.code);
  const typeCol = at(ITEM_COLUMN_ALIASES.type);
  const categoryCol = at(ITEM_COLUMN_ALIASES.category);
  const subCol = at(ITEM_COLUMN_ALIASES.subCategory);
  const uomCol = at(ITEM_COLUMN_ALIASES.uom);
  const barcodeCol = at(ITEM_COLUMN_ALIASES.barcode);
  const shelfCol = at(ITEM_COLUMN_ALIASES.shelfLifeDays);

  const cell = (row: string[], index: number | null): string | null => {
    if (index === null) return null;
    const value = row[index]?.trim();
    return value ? value : null;
  };

  const rows: ItemSheetRow[] = [];
  let skipped = 0;

  for (let i = 1; i < grid.length; i += 1) {
    const row = grid[i] ?? [];
    const name = cell(row, nameCol);

    // A row with no name is not an item. Importing it would create a nameless line
    // somebody has to find and delete later.
    if (!name) {
      skipped += 1;
      continue;
    }

    rows.push({
      // Verbatim. Not upper-cased, not trimmed of its own punctuation, not renumbered.
      // A client's code is the one printed on their paperwork, and silently changing it
      // breaks every cross-reference they hold outside this system.
      code: cell(row, codeCol),
      name,
      type: cell(row, typeCol),
      category: cell(row, categoryCol),
      subCategory: cell(row, subCol),
      uom: cell(row, uomCol),
      barcode: cell(row, barcodeCol),
      shelfLifeDays: wholeDays(cell(row, shelfCol)),
      line: i + 1,
    });
  }

  if (rows.length === 0) {
    return empty("Every row in that file is missing a name, so there is nothing to import.");
  }

  // Case-sensitive, because the codes are kept verbatim — "Milk" and "MILK" are two
  // different codes to this system and to the unique constraint behind it.
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    if (!row.code) continue;
    if (seen.has(row.code)) duplicates.add(row.code);
    seen.add(row.code);
  }

  return {
    ok: true,
    rows,
    withCode: rows.filter((r) => r.code !== null).length,
    needingCode: rows.filter((r) => r.code === null).length,
    skipped,
    duplicates: [...duplicates],
  };
}

/**
 * A shelf life, or nothing.
 *
 * Deliberately unforgiving. "7 days", "approx 30", "1 year" and "n/a" all become null
 * rather than a guess, because a wrong shelf life produces a wrong expiry date on a batch
 * and a watchlist that quietly lies is worse than one with gaps in it. A property that
 * wants these tracked writes the number.
 */
function wholeDays(raw: string | null): number | null {
  if (raw === null) return null;
  if (!/^\d+$/.test(raw.trim())) return null;
  const days = Number(raw.trim());
  return Number.isSafeInteger(days) && days > 0 ? days : null;
}

/**
 * A code for a line the property has none for.
 *
 * Derived from the name rather than a counter, because a storekeeper reading a printed
 * label should be able to tell what it is. `TONED-MILK-1L` is findable; `SB-ITEM-0147`
 * sends them to a screen to look it up.
 *
 * `taken` carries what is already spoken for — both the codes elsewhere in the sheet and
 * the ones already in the item master — because the collision that matters is against the
 * unique constraint, not against this file.
 */
export function suggestItemCode(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toUpperCase()
      // Anything that is not a letter, a digit or a separator becomes a separator, so
      // "Milk 1L (Toned)" and "Milk-1L-Toned" arrive at the same place.
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24)
      .replace(/-+$/g, "") || "ITEM";

  if (!taken.has(base)) return base;

  // Suffixed rather than truncated-and-hashed: two items genuinely called the same thing
  // is a real situation in a hotel store — two suppliers' toned milk — and -2 says that
  // more clearly than a checksum would.
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base.slice(0, 28)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }

  throw new Error(`Could not find a free code for "${name}" — a thousand are already taken.`);
}
