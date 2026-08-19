import type { GrnLineDecision, RejectReason } from "@golai/db";
import { toQty } from "@golai/domain";
import { requireSupabase } from "./supabase";

/**
 * Posted receipts, and correcting one.
 *
 * A posted GRN is immutable by trigger — it is corrected by superseding it, never by
 * editing (PRD section 4 Gate 5). That half shipped with the flow spine; this is the
 * other half, which until now did not exist and made a posted receipt uncorrectable
 * rather than immutable.
 */

export interface ReceiptSummary {
  grnId: string;
  grnNo: string;
  postedAt: string;
  postedByName: string | null;
  gateEntryNo: string | null;
  vendorName: string | null;
  lineCount: number;
  totalAccepted: number;
  totalRejected: number;
  /** What this receipt corrected, where it is itself an amendment. */
  amendsGrnNo: string | null;
  amendmentReason: string | null;
  /** What corrected this one. Non-null means it is no longer the current version. */
  supersededByGrnNo: string | null;
}

export async function listReceipts(
  propertyId: string,
  from: string | null,
): Promise<ReceiptSummary[]> {
  const { data, error } = await requireSupabase().rpc("list_receipts", {
    p_property_id: propertyId,
    p_from: from,
    p_to: null,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    grnId: r.grn_id,
    grnNo: r.grn_no,
    postedAt: r.posted_at,
    postedByName: r.posted_by_name,
    gateEntryNo: r.gate_entry_no,
    vendorName: r.vendor_name,
    lineCount: r.line_count,
    totalAccepted: toQty(r.total_accepted),
    totalRejected: toQty(r.total_rejected),
    amendsGrnNo: r.amends_grn_no,
    amendmentReason: r.amendment_reason,
    supersededByGrnNo: r.superseded_by_grn_no,
  }));
}

export interface ReceiptLine {
  lineId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  batchId: string | null;
  batchNo: string | null;
  uomCode: string;
  qtyChallan: number | null;
  qtyPhysical: number;
  qtyAccepted: number;
  qtyRejected: number;
  decision: GrnLineDecision;
  rejectReason: RejectReason | null;
  /**
   * How much is still where the receipt put it, and therefore how far the line can be
   * corrected downwards. Shown before the figures are typed, because being told
   * afterwards is being told too late.
   */
  stillQuarantined: number;
  stillRejected: number;
}

export async function listReceiptLines(propertyId: string, grnId: string): Promise<ReceiptLine[]> {
  const { data, error } = await requireSupabase().rpc("list_receipt_lines", {
    p_property_id: propertyId,
    p_grn_id: grnId,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    lineId: r.line_id,
    itemId: r.item_id,
    itemCode: r.item_code,
    itemName: r.item_name,
    batchId: r.batch_id,
    batchNo: r.batch_no,
    uomCode: r.uom_code,
    qtyChallan: r.qty_challan === null ? null : toQty(r.qty_challan),
    qtyPhysical: toQty(r.qty_physical),
    qtyAccepted: toQty(r.qty_accepted),
    qtyRejected: toQty(r.qty_rejected),
    decision: r.decision,
    rejectReason: r.reject_reason,
    stillQuarantined: toQty(r.still_quarantined),
    stillRejected: toQty(r.still_rejected),
  }));
}

export interface AmendedLine {
  grn_line_id: string;
  qty_physical: number;
  qty_accepted: number;
  qty_rejected: number;
  decision: GrnLineDecision;
  reject_reason: RejectReason | null;
}

export async function amendReceipt(params: {
  propertyId: string;
  grnId: string;
  reason: string;
  lines: AmendedLine[];
  submissionId: string;
}): Promise<{ grnId: string; grnNo: string; adjustedLines: number }> {
  const { data, error } = await requireSupabase().rpc("amend_grn", {
    p_property_id: params.propertyId,
    p_grn_id: params.grnId,
    p_reason: params.reason,
    p_idempotency_key: params.submissionId,
    p_lines: params.lines,
  });

  if (error) throw new Error(friendly(error.code, error.message));

  const row = (data ?? [])[0];
  if (!row) throw new Error("The amendment did not post. Nothing was changed; try again.");

  return { grnId: row.grn_id, grnNo: row.grn_no, adjustedLines: row.adjusted_lines };
}

/**
 * amend_grn raises in the words somebody can act on — how much has already moved, and
 * what to do instead. Only the failures that never reach the function body are rewritten.
 */
function friendly(code: string | undefined, message: string): string {
  if (code === "42501" && !message.includes("Amending") && !message.includes("Line "))
    return "You do not have permission to amend receipts at this property.";
  if (code === "PGRST202")
    return "This build is talking to a database that cannot amend receipts yet. The migration has not been deployed.";
  return message;
}
