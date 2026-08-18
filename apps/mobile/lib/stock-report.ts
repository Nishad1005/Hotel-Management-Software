import type { LocationKind, StockState } from "@golai/db";
import { toQty } from "@golai/domain";
import { requireSupabase } from "./supabase";

/**
 * Where everything is.
 *
 * The most-asked question of any stock system, and the one this app had no screen for —
 * only the expiry watchlist, which is a different question wearing similar clothes.
 *
 * Every state, not only what is issuable. Stock in quarantine, in the reject cage, staged
 * at Terminal 2 or held by a department is still the property's; showing only AVAILABLE is
 * how a physical count comes out short with nothing to explain the difference.
 */

export interface StockRow {
  batchId: string;
  batchNo: string;
  isSystemGenerated: boolean;
  itemId: string;
  itemName: string;
  itemCode: string;
  categoryName: string;
  uomCode: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  locationKind: LocationKind;
  state: StockState;
  qty: number;
  bestBefore: string | null;
  daysRemaining: number | null;
  /** Stood at Terminal 1 past the dwell limit when it was put away. Never cleared. */
  dwellBreach: boolean;
}

export async function listStockReport(propertyId: string, search: string): Promise<StockRow[]> {
  const { data, error } = await requireSupabase().rpc("list_stock_on_hand", {
    p_property_id: propertyId,
    p_search: search.trim() || null,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    batchId: row.batch_id,
    batchNo: row.batch_no,
    isSystemGenerated: row.is_system_generated,
    itemId: row.item_id,
    itemName: row.item_name,
    itemCode: row.item_code,
    categoryName: row.category_name,
    uomCode: row.uom_code,
    locationId: row.location_id,
    locationCode: row.location_code,
    locationName: row.location_name,
    locationKind: row.location_kind,
    state: row.state,
    // Numeric arrives as a string. The moment two of these are summed anywhere without
    // it, the result concatenates instead of adding.
    qty: toQty(row.qty),
    bestBefore: row.best_before,
    daysRemaining: row.days_remaining,
    dwellBreach: row.dwell_breach,
  }));
}

/**
 * What each state means to somebody standing in the store.
 *
 * Worded as a place rather than as a status, because that is the question being asked.
 * "QUARANTINE" tells a storekeeper nothing; "at Terminal 1, not yet put away" tells them
 * where to walk and what to do.
 */
export const STATE_LABELS: Record<
  StockState,
  { label: string; tone: "good" | "warn" | "bad" | "neutral" }
> = {
  AVAILABLE: { label: "In the store", tone: "good" },
  QUARANTINE: { label: "At Terminal 1, not put away", tone: "warn" },
  TRANSIT: { label: "Moving between zones", tone: "warn" },
  ISSUED: { label: "With a department", tone: "neutral" },
  STAGED_OUT: { label: "At Terminal 2, waiting to leave", tone: "warn" },
  REJECT_HOLD: { label: "Rejected — owed back to the vendor", tone: "bad" },
  BLOCKED: { label: "Blocked by the food safety officer", tone: "bad" },
};

export interface ItemGroup {
  itemId: string;
  itemName: string;
  itemCode: string;
  categoryName: string;
  uomCode: string;
  total: number;
  /** Only what can actually be issued. The difference from `total` is the point. */
  available: number;
  rows: StockRow[];
}

/**
 * Groups the flat list by item.
 *
 * The server returns it already ordered by item then by expiry, so this only has to walk
 * it once — and the walking order is what keeps the oldest batch at the top of each group,
 * which is the batch that should go out next.
 */
export function groupByItem(rows: readonly StockRow[]): ItemGroup[] {
  const groups: ItemGroup[] = [];
  let current: ItemGroup | null = null;

  for (const row of rows) {
    if (!current || current.itemId !== row.itemId) {
      current = {
        itemId: row.itemId,
        itemName: row.itemName,
        itemCode: row.itemCode,
        categoryName: row.categoryName,
        uomCode: row.uomCode,
        total: 0,
        available: 0,
        rows: [],
      };
      groups.push(current);
    }
    current.rows.push(row);
    current.total += row.qty;
    if (row.state === "AVAILABLE") current.available += row.qty;
  }

  return groups;
}
