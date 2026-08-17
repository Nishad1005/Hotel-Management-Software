import { expiryStatus } from "@golai/domain";
import { listStockOnHand } from "./stock";
import { requireSupabase } from "./supabase";

/**
 * The state of the store, in four numbers.
 *
 * The home screen used to be a list of links — three cards of navigation rows and not a
 * single figure anywhere. For an operations product that is the wrong shape: the first
 * thing somebody opening this wants is not a menu, it is to know whether anything needs
 * them today. The links still matter, but they belong under the answer, not instead of
 * it.
 */

export interface PropertyOverview {
  items: number;
  locations: number;
  /** Distinct lots holding stock — batch × location × state. */
  stockLines: number;
  /** Past best-before, still on the books. */
  expired: number;
  /** Inside a week of best-before. */
  expiringSoon: number;
}

/** Same thresholds as the watchlist, so the two screens cannot disagree. */
const THRESHOLDS = { criticalDays: 2, nearingDays: 7 };

export async function loadOverview(now: number): Promise<PropertyOverview> {
  const client = requireSupabase();

  // Counts come back as counts rather than rows: the item master runs to hundreds of
  // lines and none of them are needed to render a number.
  const [items, locations, stock] = await Promise.all([
    client.from("item").select("id", { count: "exact", head: true }).eq("is_active", true),
    client.from("location").select("id", { count: "exact", head: true }).eq("is_active", true),
    listStockOnHand(),
  ]);

  const available = stock.filter((line) => line.state === "AVAILABLE");

  let expired = 0;
  let expiringSoon = 0;
  for (const line of available) {
    const state = expiryStatus(line.bestBefore, now, THRESHOLDS);
    if (state === "EXPIRED") expired += 1;
    else if (state === "CRITICAL" || state === "NEARING") expiringSoon += 1;
  }

  return {
    items: items.count ?? 0,
    locations: locations.count ?? 0,
    stockLines: available.length,
    expired,
    expiringSoon,
  };
}
