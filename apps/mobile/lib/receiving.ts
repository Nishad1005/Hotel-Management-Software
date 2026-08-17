import type { GrnLineDecision, PostGrnLine, RejectReason } from "@golai/db";
import { requireSupabase } from "./supabase";

/**
 * Gates 1 to 5 — receiving.
 *
 * Everything here goes through `post_grn`, which does the whole receipt in one
 * transaction. Not for tidiness: a posted GRN is immutable by trigger, so a half-written
 * one cannot be edited back into shape, only amended. Doing this as five client
 * statements would mean a dropped connection between the third and the fourth leaves a
 * receipt nobody can correct.
 *
 * The consequence for this file is that it is thin on purpose. There is no place to add
 * a validation here that the server does not also make — the server is the one that has
 * to be right, because an offline device running a six-month-old build will call it too.
 */

export interface OpenArrival {
  id: string;
  gateEntryNo: string;
  /** The vendor, or the name Security typed when there was no vendor record. */
  partyName: string | null;
  partyId: string | null;
  packageCount: number;
  vehicleNumber: string | null;
  /** Server-computed. Device clocks are never trusted for a dwell figure. */
  hoursOpen: number;
  arrivedAt: string;
}

/**
 * Arrivals with no receipt against them.
 *
 * This is the receiving worklist and the reconciliation control at the same time (PRD
 * section 1): every gate entry resolves to a GRN or it stays on this list getting older,
 * which is the whole reason the module exists.
 */
export async function listOpenArrivals(propertyId: string): Promise<OpenArrival[]> {
  const { data, error } = await requireSupabase().rpc("list_open_gate_entries", {
    p_property_id: propertyId,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    gateEntryNo: row.gate_entry_no,
    partyName: row.party_name,
    partyId: row.party_id,
    packageCount: row.package_count,
    vehicleNumber: row.vehicle_number,
    hoursOpen: Number(row.hours_open),
    arrivedAt: row.timestamp_in,
  }));
}

/**
 * One line of a receipt, as the screen holds it.
 *
 * Carries the item's name and unit alongside the ids so the review list can be rendered
 * without a second lookup — the screen already had them when the line was added, and
 * re-fetching to display what the user just typed is work for nothing.
 */
export interface DraftLine {
  itemId: string;
  itemName: string;
  itemCode: string;
  uomId: string;
  uomCode: string;
  isPerishable: boolean;
  isColdChain: boolean;

  qtyChallan: number | null;
  qtyPhysical: number;
  qtyAccepted: number;
  qtyRejected: number;
  decision: GrnLineDecision;
  rejectReason: RejectReason | null;

  batchNo: string | null;
  bestBefore: string | null;
  receiptTempC: number | null;
}

/** The six reasons at P1, with the words a storekeeper would use (PRD section 4 Gate 4). */
export const REJECT_REASONS: { id: RejectReason; label: string }[] = [
  { id: "SHORT_SHELF_LIFE", label: "Too close to expiry" },
  { id: "NOT_COLD_ENOUGH", label: "Not cold enough" },
  { id: "POOR_QUALITY", label: "Poor quality" },
  { id: "DAMAGED", label: "Damaged" },
  { id: "WRONG_ITEM", label: "Wrong item" },
  { id: "OTHER", label: "Something else" },
];

export interface PostedReceipt {
  grnId: string;
  grnNo: string;
}

export async function postReceipt(params: {
  propertyId: string;
  gateEntryId: string | null;
  partyId: string | null;
  lines: DraftLine[];
  /**
   * Identifies this submission. Minted once when the screen opens, not per attempt —
   * that is what makes a retry after a dropped connection return the original receipt
   * instead of counting the delivery twice under a number already written on a challan.
   */
  submissionId: string;
}): Promise<PostedReceipt> {
  const payload: PostGrnLine[] = params.lines.map((l) => ({
    item_id: l.itemId,
    uom_id: l.uomId,
    batch_no: l.batchNo,
    best_before: l.bestBefore,
    receipt_temp_c: l.receiptTempC,
    qty_challan: l.qtyChallan,
    qty_physical: l.qtyPhysical,
    qty_accepted: l.qtyAccepted,
    qty_rejected: l.qtyRejected,
    decision: l.decision,
    reject_reason: l.rejectReason,
  }));

  const { data, error } = await requireSupabase().rpc("post_grn", {
    p_property_id: params.propertyId,
    p_gate_entry_id: params.gateEntryId,
    p_party_id: params.partyId,
    p_idempotency_key: params.submissionId,
    p_lines: payload,
  });

  if (error) throw new Error(friendly(error.code, error.message));

  const row = (data ?? [])[0];
  // The function always returns a row or raises, so an empty result is not a receipt
  // that quietly did nothing — it means the call did not reach the function it named.
  if (!row) throw new Error("The receipt did not post. Nothing was recorded; try again.");

  return { grnId: row.grn_id, grnNo: row.grn_no };
}

/**
 * post_grn raises in the words a storekeeper needs — "Line 2 (Joha Rice): count what
 * actually arrived" — so almost nothing here rewrites a message. What it handles is the
 * failures that never reach the function body.
 */
function friendly(code: string | undefined, message: string): string {
  if (code === "42501" && !message.includes("Line "))
    return "You do not have permission to receive goods at this property.";
  if (code === "PGRST202")
    return "This build is talking to a database that does not have receiving yet. The migration has not been deployed.";
  return message;
}
