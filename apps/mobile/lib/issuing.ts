import type { IssueStockLine } from "@golai/db";
import { sortByFefo, toQty } from "@golai/domain";
import { requireSupabase } from "./supabase";

/**
 * Gate 8 — zone to department.
 *
 * ## What this does not do
 *
 * Acceptance criterion 17 requires that no custody changes hands without a card scan.
 * This takes a typed receiver name, which is an assertion by the storekeeper rather than
 * proof of anybody's identity, and the acknowledgement is written with
 * `verified_by_scan = false` to say so. The screen says so too, in words, because a
 * control the user believes exists is worse than one they know does not.
 */

export interface Department {
  id: string;
  code: string;
  name: string;
}

export async function listDepartments(): Promise<Department[]> {
  const { data, error } = await requireSupabase()
    .from("location")
    .select("id, code, name")
    .eq("kind", "DEPARTMENT")
    .eq("is_active", true)
    .order("name");

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id, code: r.code, name: r.name }));
}

export interface IssuableLot {
  batchId: string;
  batchNo: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  isPerishable: boolean;
  uomId: string;
  uomCode: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  qty: number;
  /** Epoch milliseconds at UTC midnight, or null. Sorted on by the domain's FEFO rule. */
  bestBefore: number | null;
  daysRemaining: number | null;
}

/**
 * Everything issuable, first-expired-first-out.
 *
 * The server already orders this way, so a client that skipped the sort would still
 * behave. It is re-sorted here anyway with the domain's own `sortByFefo`, because that is
 * where the rule lives and has tests — and because the two agreeing is what makes the
 * ordering a rule rather than a coincidence of two ORDER BY clauses.
 */
export async function listIssuableStock(propertyId: string): Promise<IssuableLot[]> {
  const { data, error } = await requireSupabase().rpc("list_issuable_stock", {
    p_property_id: propertyId,
  });

  if (error) throw new Error(error.message);

  const lots: IssuableLot[] = (data ?? []).map((row) => ({
    batchId: row.batch_id,
    batchNo: row.batch_no,
    itemId: row.item_id,
    itemName: row.item_name,
    itemCode: row.item_code,
    isPerishable: row.is_perishable,
    uomId: row.uom_id,
    uomCode: row.uom_code,
    locationId: row.location_id,
    locationCode: row.location_code,
    locationName: row.location_name,
    qty: toQty(row.qty),
    // Parsed as UTC midnight so a device in IST does not shift an expiry by a day.
    bestBefore: row.best_before ? Date.parse(`${row.best_before}T00:00:00Z`) : null,
    daysRemaining: row.days_remaining,
  }));

  return sortByFefo(lots);
}

export interface DraftIssueLine {
  lot: IssuableLot;
  qty: number;
}

export interface IssuedResult {
  issueId: string;
  issueNo: string;
  /** How many lines were past their date. Recorded, not refused. */
  expiredLines: number;
}

export async function issueStock(params: {
  propertyId: string;
  departmentId: string;
  receiverName: string;
  purpose: string | null;
  lines: DraftIssueLine[];
  submissionId: string;
}): Promise<IssuedResult> {
  const payload: IssueStockLine[] = params.lines.map((l) => ({
    batch_id: l.lot.batchId,
    from_location_id: l.lot.locationId,
    qty: l.qty,
  }));

  const { data, error } = await requireSupabase().rpc("issue_stock", {
    p_property_id: params.propertyId,
    p_department_id: params.departmentId,
    p_receiver_name: params.receiverName,
    p_purpose: params.purpose,
    p_idempotency_key: params.submissionId,
    p_lines: payload,
  });

  if (error) throw new Error(friendly(error.code, error.message));

  const row = (data ?? [])[0];
  if (!row) throw new Error("The issue did not record. Nothing left the store; try again.");

  return { issueId: row.issue_id, issueNo: row.issue_no, expiredLines: row.expired_lines };
}

function friendly(code: string | undefined, message: string): string {
  if (code === "42501" && !message.includes("Line "))
    return "You do not have permission to issue stock at this property.";
  if (code === "PGRST202")
    return "This build is talking to a database that does not have issuing yet. The migration has not been deployed.";
  return message;
}
