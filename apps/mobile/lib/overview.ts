import { DEFAULT_EXPIRY_THRESHOLDS } from "@golai/domain";
import { requireSupabase } from "./supabase";

/**
 * The state of the property, in one call.
 *
 * The home screen used to be a list of links — three cards of navigation rows and not a
 * single figure anywhere. For an operations product that is the wrong shape: the first
 * thing somebody opening this wants is not a menu, it is to know whether anything needs
 * them today.
 *
 * It then computed those figures by fetching the whole stock table and counting it in
 * JavaScript, which was tolerable for two numbers and would not have been for nine. The
 * counting moved to the database; what stayed here is the one thing that is a rule rather
 * than an aggregate — what "expiring soon" means — and that is passed in from the domain
 * package so this screen and the watchlist cannot disagree about it.
 */

export interface PropertyOverview {
  items: number;
  locations: number;
  bins: number;
  vendors: number;
  vendorsOnHold: number;

  /** Distinct issuable lots — batch × location, in AVAILABLE. */
  stockLines: number;
  /** Past best-before and still on the books. Money already lost, not money at risk. */
  expired: number;
  expiringSoon: number;

  /** Gate entries with no goods receipt against them (PRD section 1). */
  arrivalsWaiting: number;
  arrivalsOverdue: number;
  quarantineLines: number;
  /** How long the oldest thing at Terminal 1 has stood there. */
  quarantineOldestHours: number | null;
  awaitingGatePass: number;
}

export async function loadOverview(propertyId: string): Promise<PropertyOverview> {
  const { data, error } = await requireSupabase().rpc("property_overview", {
    p_property_id: propertyId,
    p_nearing_days: DEFAULT_EXPIRY_THRESHOLDS.nearingDays,
  });

  if (error) throw new Error(error.message);

  const row = (data ?? [])[0];
  if (!row) throw new Error("The overview came back empty.");

  return {
    items: row.items,
    locations: row.locations,
    bins: row.bins,
    vendors: row.vendors,
    vendorsOnHold: row.vendors_on_hold,
    stockLines: row.stock_lines,
    expired: row.expired,
    expiringSoon: row.expiring_soon,
    arrivalsWaiting: row.arrivals_waiting,
    arrivalsOverdue: row.arrivals_overdue,
    quarantineLines: row.quarantine_lines,
    quarantineOldestHours:
      row.quarantine_oldest_hours === null ? null : Number(row.quarantine_oldest_hours),
    awaitingGatePass: row.awaiting_gate_pass,
  };
}
