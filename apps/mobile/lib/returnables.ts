import type { DispatchType } from "@golai/db";
import { toQty } from "@golai/domain";
import { requireSupabase } from "./supabase";

/**
 * The returnable register, and recording what comes back.
 *
 * The register itself is written by the dispatch — `stage_for_dispatch` creates the row
 * in the same transaction as the note, so nothing here can forget to open one. This file
 * only reads the register and settles it, which is why it is so much smaller than the
 * migration behind it.
 */

export interface Returnable {
  returnableId: string;
  dispatchId: string;
  dispatchNo: string;
  dispatchType: DispatchType;
  /** Who has it — the laundry, the repair shop, the vendor whose crates these are. */
  recipientName: string | null;
  qtyOut: number;
  qtyReturned: number;
  /** `qtyOut − qtyReturned`. Zero means settled. */
  outstanding: number;
  expectedReturnDate: string | null;
  /**
   * Days past the promised date, while something is still out. Null when nothing is —
   * a settled row has no age — and null when no date was promised, which for the
   * returnable types Gate 9 no longer permits but old rows may predate.
   */
  daysOverdue: number | null;
  stagedAt: string;
  returnedAt: string | null;
  conditionOnReturn: string | null;
}

export async function listReturnables(propertyId: string): Promise<Returnable[]> {
  const { data, error } = await requireSupabase().rpc("list_returnables", {
    p_property_id: propertyId,
  });

  if (error) throw new Error(friendly(error.code, error.message));

  // Server-ordered: outstanding before settled, most overdue on top. Kept as sent.
  return (data ?? []).map((r) => ({
    returnableId: r.returnable_id,
    dispatchId: r.dispatch_id,
    dispatchNo: r.dispatch_no,
    dispatchType: r.dispatch_type,
    recipientName: r.recipient_name,
    qtyOut: toQty(r.qty_out),
    qtyReturned: toQty(r.qty_returned),
    outstanding: toQty(r.outstanding),
    expectedReturnDate: r.expected_return_date,
    daysOverdue: r.days_overdue,
    stagedAt: r.staged_at,
    returnedAt: r.returned_at,
    conditionOnReturn: r.condition_on_return,
  }));
}

export interface ReturnResult {
  qtyOut: number;
  qtyReturned: number;
  outstanding: number;
}

/**
 * Partial or full — the server accumulates. Over-return is refused there against the
 * live row, so the caller's precheck is a courtesy, not the boundary.
 */
export async function recordReturn(
  propertyId: string,
  returnableId: string,
  qty: number,
  condition: string | null,
): Promise<ReturnResult> {
  const { data, error } = await requireSupabase().rpc("record_return", {
    p_property_id: propertyId,
    p_returnable_id: returnableId,
    p_qty: qty,
    p_condition: condition,
  });

  if (error) throw new Error(friendly(error.code, error.message));

  const row = (data ?? [])[0];
  if (!row) throw new Error("The return did not record. Nothing changed; try again.");

  return {
    qtyOut: toQty(row.qty_out),
    qtyReturned: toQty(row.qty_returned),
    outstanding: toQty(row.outstanding),
  };
}

function friendly(code: string | undefined, message: string): string {
  // The server's own refusals here are written for the person at the counter — the
  // over-return message names the quantities, the 42501s name the property — so they
  // pass through. Only the failure no server message covers is rewritten: this build
  // reaching a database that predates the returnable register.
  if (code === "PGRST202")
    return "This build is talking to a database that does not have the returnable register yet. The migration has not been deployed.";
  return message;
}
