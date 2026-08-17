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
