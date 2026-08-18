import { suggestItemCode, type ItemSheetRow } from "@golai/domain";
import { requireSupabase } from "./supabase";
import type { CategoryOption, UomOption } from "./masters";

/**
 * Turning a spreadsheet into an item master.
 *
 * The reading and the counting are in `packages/domain` with tests. This is the half that
 * needs the property's masters in hand: resolving a category NAME to a category id,
 * deciding what to do with rows that resolve to nothing, and writing them.
 *
 * Keeping those apart is what lets the whole preview be tested without a database, and it
 * is why the domain function reports rather than decides.
 */

export interface ResolvedRow {
  line: number;
  name: string;
  /** Theirs where they had one, generated where they did not. */
  code: string;
  codeWasGenerated: boolean;
  categoryId: string | null;
  categoryLabel: string;
  uomId: string | null;
  uomLabel: string;
  shelfLifeDays: number | null;
  /** True when a shelf life was supplied, which is the only way an import can be. */
  isPerishable: boolean;
}

export interface ResolutionSummary {
  rows: ResolvedRow[];
  /** Distinct category names in the file that matched nothing. */
  unknownCategories: string[];
  unknownUoms: string[];
  /** Codes that already exist in the master. Skipped rather than overwritten. */
  alreadyPresent: string[];
  generated: number;
  perishable: number;
}

/**
 * Matches on code first, then on name, both case- and space-insensitively.
 *
 * Code first because a sheet that carries "DAIRY" means the category with that code, and
 * matching its name against "Dairy" would be a coincidence that fails on the first
 * property calling the same thing something else.
 */
function indexBy<T extends { id: string; code: string; name: string }>(
  options: readonly T[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const o of options) {
    map.set(normalise(o.name), o);
    // Set after the name so a code wins where a code and somebody else's name collide.
    map.set(normalise(o.code), o);
  }
  return map;
}

const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function resolveSheet(params: {
  rows: readonly ItemSheetRow[];
  categories: readonly CategoryOption[];
  uoms: readonly UomOption[];
  existingCodes: ReadonlySet<string>;
  /** Used for rows whose category matched nothing. Null leaves them unresolved. */
  fallbackCategoryId: string | null;
  fallbackUomId: string | null;
}): ResolutionSummary {
  const byCategory = indexBy(params.categories);
  const byUom = indexBy(params.uoms);

  const unknownCategories = new Set<string>();
  const unknownUoms = new Set<string>();
  const alreadyPresent: string[] = [];

  // Seeded with the master's codes, so a generated code cannot collide with one that
  // already exists — the constraint does not care that this file has not seen it.
  const taken = new Set(params.existingCodes);
  const rows: ResolvedRow[] = [];

  for (const row of params.rows) {
    const category = row.category ? byCategory.get(normalise(row.category)) : undefined;
    const uom = row.uom ? byUom.get(normalise(row.uom)) : undefined;

    if (row.category && !category) unknownCategories.add(row.category);
    if (row.uom && !uom) unknownUoms.add(row.uom);

    const code = row.code ?? suggestItemCode(row.name, taken);
    taken.add(code);

    if (params.existingCodes.has(code)) {
      alreadyPresent.push(code);
      continue;
    }

    const fallbackCategory = params.categories.find((c) => c.id === params.fallbackCategoryId);
    const fallbackUom = params.uoms.find((u) => u.id === params.fallbackUomId);

    rows.push({
      line: row.line,
      name: row.name,
      code,
      codeWasGenerated: row.code === null,
      categoryId: category?.id ?? params.fallbackCategoryId,
      categoryLabel: category?.name ?? fallbackCategory?.name ?? row.category ?? "—",
      uomId: uom?.id ?? params.fallbackUomId,
      uomLabel: uom?.code ?? fallbackUom?.code ?? row.uom ?? "—",
      shelfLifeDays: row.shelfLifeDays,
      // A shelf life is the ONLY way an imported item becomes perishable. The schema
      // refuses a perishable without one, and rightly: a perishable whose expiry can
      // never be computed is worse than one nobody claimed was perishable.
      isPerishable: row.shelfLifeDays !== null,
    });
  }

  return {
    rows,
    unknownCategories: [...unknownCategories],
    unknownUoms: [...unknownUoms],
    alreadyPresent,
    generated: rows.filter((r) => r.codeWasGenerated).length,
    perishable: rows.filter((r) => r.isPerishable).length,
  };
}

export async function listExistingItemCodes(): Promise<Set<string>> {
  const { data, error } = await requireSupabase().from("item").select("code").limit(5000);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.code));
}

export interface ImportProgress {
  done: number;
  total: number;
}

export interface ImportOutcome {
  inserted: number;
  /** Rows the database refused, with the reason it gave. */
  failures: { code: string; name: string; reason: string }[];
}

/**
 * Writes the resolved rows, in chunks.
 *
 * Chunked rather than one statement because a single insert of six hundred rows fails as
 * one thing: one bad row and nothing lands, with no indication which. Fifty at a time
 * means a failure names fifty candidates and the rest of the master still imports — which
 * matters when this is the first thing a new property does with the product.
 *
 * The chunks are not a transaction between them, and that is deliberate. A partial item
 * master is not a corrupt one; re-running the import skips what is already there, because
 * codes already present are filtered out during resolution.
 */
export async function importItems(
  propertyId: string,
  rows: readonly ResolvedRow[],
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportOutcome> {
  const client = requireSupabase();
  const CHUNK = 50;
  const failures: ImportOutcome["failures"] = [];
  let inserted = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);

    const { error } = await client.from("item").insert(
      chunk.map((r) => ({
        property_id: propertyId,
        code: r.code,
        name: r.name,
        category_id: r.categoryId as string,
        base_uom_id: r.uomId as string,
        is_perishable: r.isPerishable,
        is_batch_controlled: r.isPerishable,
        shelf_life_days: r.shelfLifeDays,
      })),
    );

    if (error) {
      // Retried one at a time so the report names the row that failed rather than the
      // fifty it travelled with. Slower, and only on the failing chunk.
      for (const r of chunk) {
        const { error: single } = await client.from("item").insert({
          property_id: propertyId,
          code: r.code,
          name: r.name,
          category_id: r.categoryId as string,
          base_uom_id: r.uomId as string,
          is_perishable: r.isPerishable,
          is_batch_controlled: r.isPerishable,
          shelf_life_days: r.shelfLifeDays,
        });
        if (single)
          failures.push({
            code: r.code,
            name: r.name,
            reason: friendly(single.code, single.message),
          });
        else inserted += 1;
      }
    } else {
      inserted += chunk.length;
    }

    onProgress?.({ done: Math.min(i + CHUNK, rows.length), total: rows.length });
  }

  return { inserted, failures };
}

function friendly(code: string | undefined, message: string): string {
  if (code === "23505") return "That code is already in the item master.";
  if (code === "42501") return "Only an Administrator can add to the item master.";
  if (code === "23514" && message.includes("perishable_has_shelf_life"))
    return "Marked perishable with no shelf life.";
  return message;
}
