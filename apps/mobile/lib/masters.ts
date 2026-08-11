import { assertAffected, type ItemRow, type StorageRegime } from "@golai/db";
import { requireSupabase } from "./supabase";

/**
 * Master data access.
 *
 * Every read is already scoped by row level security, so nothing here filters by
 * property defensively — that would be a second, weaker copy of the real boundary.
 * Writes DO pass property_id explicitly, because an insert has to satisfy the policy's
 * WITH CHECK and the database cannot infer which property the row belongs to.
 */

export interface CategoryOption {
  id: string;
  code: string;
  name: string;
  defaultMinShelfLifePct: number | null;
  defaultStorageRegime: StorageRegime;
}

export interface UomOption {
  id: string;
  code: string;
  name: string;
}

export interface ItemListRow {
  id: string;
  code: string;
  name: string;
  isPerishable: boolean;
  isColdChain: boolean;
  shelfLifeDays: number | null;
  storageRegime: StorageRegime;
  isActive: boolean;
  categoryName: string;
  uomCode: string;
}

export async function listCategories(): Promise<CategoryOption[]> {
  const { data, error } = await requireSupabase()
    .from("item_category")
    .select("id, code, name, default_min_shelf_life_pct, default_storage_regime")
    .eq("is_active", true)
    .order("name");

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    defaultMinShelfLifePct: r.default_min_shelf_life_pct,
    defaultStorageRegime: r.default_storage_regime,
  }));
}

export async function listUoms(): Promise<UomOption[]> {
  const { data, error } = await requireSupabase()
    .from("uom")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id, code: r.code, name: r.name }));
}

export async function listItems(search: string, categoryId: string | null): Promise<ItemListRow[]> {
  let query = requireSupabase()
    .from("item")
    .select(
      "id, code, name, is_perishable, is_cold_chain, shelf_life_days, storage_regime, is_active, category:category_id(name), uom:base_uom_id(code)",
    )
    .order("name")
    .limit(200);

  const term = search.trim();
  // Matched on both code and name because people search by whichever they remember,
  // and a storekeeper is as likely to type "MILK" as "Toned".
  if (term) query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
  if (categoryId) query = query.eq("category_id", categoryId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => {
    const row = r as unknown as ItemRow & {
      category: { name: string } | null;
      uom: { code: string } | null;
    };
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      isPerishable: row.is_perishable,
      isColdChain: row.is_cold_chain,
      shelfLifeDays: row.shelf_life_days,
      storageRegime: row.storage_regime,
      isActive: row.is_active,
      categoryName: row.category?.name ?? "",
      uomCode: row.uom?.code ?? "",
    };
  });
}

export async function getItem(id: string): Promise<ItemRow | null> {
  const { data, error } = await requireSupabase()
    .from("item")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export interface ItemWrite {
  code: string;
  name: string;
  categoryId: string;
  baseUomId: string;
  isPerishable: boolean;
  isColdChain: boolean;
  isBatchControlled: boolean;
  storageRegime: StorageRegime;
  shelfLifeDays: number | null;
  minShelfLifePctAtReceipt: number | null;
  tempMinC: number | null;
  tempMaxC: number | null;
  isActive: boolean;
}

export async function createItem(propertyId: string, write: ItemWrite): Promise<string> {
  const { data, error } = await requireSupabase()
    .from("item")
    .insert({
      property_id: propertyId,
      code: write.code,
      name: write.name,
      category_id: write.categoryId,
      base_uom_id: write.baseUomId,
      is_perishable: write.isPerishable,
      is_cold_chain: write.isColdChain,
      is_batch_controlled: write.isBatchControlled,
      storage_regime: write.storageRegime,
      shelf_life_days: write.shelfLifeDays,
      min_shelf_life_pct_at_receipt: write.minShelfLifePctAtReceipt,
      temp_min_c: write.tempMinC,
      temp_max_c: write.tempMaxC,
      is_active: write.isActive,
    })
    .select("id")
    .single();

  if (error) throw new Error(friendlyWriteError(error.code, error.message));
  return data.id;
}

export async function updateItem(id: string, write: ItemWrite): Promise<void> {
  const { data, error } = await requireSupabase()
    .from("item")
    .update({
      code: write.code,
      name: write.name,
      category_id: write.categoryId,
      base_uom_id: write.baseUomId,
      is_perishable: write.isPerishable,
      is_cold_chain: write.isColdChain,
      is_batch_controlled: write.isBatchControlled,
      storage_regime: write.storageRegime,
      shelf_life_days: write.shelfLifeDays,
      min_shelf_life_pct_at_receipt: write.minShelfLifePctAtReceipt,
      temp_min_c: write.tempMinC,
      temp_max_c: write.tempMaxC,
      is_active: write.isActive,
    })
    .eq("id", id)
    .select("id");

  if (error) throw new Error(friendlyWriteError(error.code, error.message));
  // An update the policy refuses does not raise — it matches no rows and reports
  // success. Without this check a storekeeper's rejected edit would look like it
  // worked. CLAUDE.md rule 4b.
  assertAffected("item", data);
}

/**
 * Database errors say what the database cares about. This says what the person cares
 * about, and only for the cases we can identify confidently — everything else passes
 * through unaltered rather than being guessed at.
 */
function friendlyWriteError(code: string | undefined, message: string): string {
  if (code === "23505") return "An item with that code already exists at this property.";
  if (code === "42501")
    return "You do not have permission to change the item master. That needs an Administrator.";
  if (code === "23514") {
    if (message.includes("perishable_has_shelf_life"))
      return "A perishable item needs a shelf life, or its expiry cannot be computed.";
    if (message.includes("cold_chain_has_range"))
      return "A cold-chain item needs a temperature range to check the probe reading against.";
    if (message.includes("perishable_is_batch_controlled"))
      return "A perishable item must be batch controlled, because expiry belongs to a batch.";
  }
  return message;
}
