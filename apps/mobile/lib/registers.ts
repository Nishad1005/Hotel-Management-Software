import type {
  BatchSource,
  DispatchType,
  GrnLineDecision,
  MovementReason,
  RejectReason,
  ScanMethod,
  StockState,
} from "@golai/db";
import { toQty } from "@golai/domain";
import { requireSupabase } from "./supabase";

/**
 * The FSSAI registers.
 *
 * There is no capture in this file, and that is the product argument (PRD section 7.1).
 * Every register is a read over records made for an operational reason by somebody who
 * was not thinking about compliance at the time — which is exactly why they are worth
 * trusting. A register filled in for the inspector is filled in the night before; one
 * assembled from the receiving dock cannot be.
 */

export interface InwardRow {
  receivedAt: string;
  grnNo: string;
  gateEntryNo: string | null;
  vendorName: string | null;
  vendorFssai: string | null;
  itemCode: string;
  itemName: string;
  batchNo: string | null;
  batchIsGenerated: boolean | null;
  qtyChallan: number | null;
  qtyPhysical: number;
  qtyAccepted: number;
  qtyRejected: number;
  uomCode: string;
  bestBefore: string | null;
  receiptTempC: number | null;
  tempMinC: number | null;
  tempMaxC: number | null;
  /** Null when there is nothing to judge against — no probe reading or no range. */
  tempInRange: boolean | null;
  decision: GrnLineDecision;
  rejectReason: RejectReason | null;
  receivedBy: string;
  batchId: string | null;
}

export async function listInwardRegister(
  propertyId: string,
  from: string | null,
  to: string | null,
): Promise<InwardRow[]> {
  const { data, error } = await requireSupabase().rpc("list_inward_register", {
    p_property_id: propertyId,
    p_from: from,
    p_to: to,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    receivedAt: r.received_at,
    grnNo: r.grn_no,
    gateEntryNo: r.gate_entry_no,
    vendorName: r.vendor_name,
    vendorFssai: r.vendor_fssai,
    itemCode: r.item_code,
    itemName: r.item_name,
    batchNo: r.batch_no,
    batchIsGenerated: r.batch_is_generated,
    qtyChallan: r.qty_challan === null ? null : toQty(r.qty_challan),
    qtyPhysical: toQty(r.qty_physical),
    qtyAccepted: toQty(r.qty_accepted),
    qtyRejected: toQty(r.qty_rejected),
    uomCode: r.uom_code,
    bestBefore: r.best_before,
    receiptTempC: r.receipt_temp_c === null ? null : Number(r.receipt_temp_c),
    tempMinC: r.temp_min_c === null ? null : Number(r.temp_min_c),
    tempMaxC: r.temp_max_c === null ? null : Number(r.temp_max_c),
    tempInRange: r.temp_in_range,
    decision: r.decision,
    rejectReason: r.reject_reason,
    receivedBy: r.received_by,
    batchId: r.batch_id,
  }));
}

export interface WasteRow {
  dispatchedAt: string;
  dispatchNo: string;
  dispatchType: DispatchType;
  reasonCode: string | null;
  recipientName: string | null;
  recipientFssai: string | null;
  itemCode: string;
  itemName: string;
  batchNo: string;
  qty: number;
  uomCode: string;
  /** Null until Security passes it out — an open consignment, not a missing one. */
  gatePassNo: string | null;
  leftAt: string | null;
  carrier: string | null;
  vehicleNumber: string | null;
  stagedByName: string | null;
  verifiedByName: string | null;
}

export async function listWasteRegister(
  propertyId: string,
  from: string | null,
  to: string | null,
): Promise<WasteRow[]> {
  const { data, error } = await requireSupabase().rpc("list_waste_register", {
    p_property_id: propertyId,
    p_from: from,
    p_to: to,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    dispatchedAt: r.dispatched_at,
    dispatchNo: r.dispatch_no,
    dispatchType: r.dispatch_type,
    reasonCode: r.reason_code,
    recipientName: r.recipient_name,
    recipientFssai: r.recipient_fssai,
    itemCode: r.item_code,
    itemName: r.item_name,
    batchNo: r.batch_no,
    qty: toQty(r.qty),
    uomCode: r.uom_code,
    gatePassNo: r.gate_pass_no,
    leftAt: r.left_at,
    carrier: r.carrier,
    vehicleNumber: r.vehicle_number,
    stagedByName: r.staged_by_name,
    verifiedByName: r.verified_by_name,
  }));
}

export interface TraceStep {
  occurredAt: string;
  reason: MovementReason;
  qty: number;
  uomCode: string;
  fromCode: string | null;
  fromName: string | null;
  fromState: StockState | null;
  toCode: string | null;
  toName: string | null;
  toState: StockState | null;
  scanMethod: ScanMethod | null;
  recordedByName: string | null;
  note: string | null;
}

export interface Provenance {
  batchNo: string;
  isSystemGenerated: boolean;
  itemCode: string;
  itemName: string;
  categoryName: string;
  uomCode: string;
  bestBefore: string | null;
  mfgDate: string | null;
  receiptTempC: number | null;
  pctAtReceipt: number | null;
  dwellBreach: boolean;
  source: BatchSource;
  receivedAt: string | null;
  grnNo: string | null;
  gateEntryNo: string | null;
  arrivedAt: string | null;
  vendorName: string | null;
  vendorCode: string | null;
  vendorFssai: string | null;
  decision: GrnLineDecision | null;
  rejectReason: RejectReason | null;
  qtyAccepted: number | null;
  qtyRejected: number | null;
  receivedBy: string | null;
}

/**
 * Both halves of a trace, in one call.
 *
 * They are always read together — a timeline with no header does not say what was traced —
 * and two sequential round trips would show the reader half a screen while the other half
 * arrived.
 */
export async function traceBatch(
  propertyId: string,
  batchId: string,
): Promise<{ provenance: Provenance | null; steps: TraceStep[] }> {
  const client = requireSupabase();

  const [head, trail] = await Promise.all([
    client.rpc("batch_provenance", { p_property_id: propertyId, p_batch_id: batchId }),
    client.rpc("trace_batch", { p_property_id: propertyId, p_batch_id: batchId }),
  ]);

  if (head.error) throw new Error(head.error.message);
  if (trail.error) throw new Error(trail.error.message);

  const h = (head.data ?? [])[0];

  return {
    provenance: h
      ? {
          batchNo: h.batch_no,
          isSystemGenerated: h.is_system_generated,
          itemCode: h.item_code,
          itemName: h.item_name,
          categoryName: h.category_name,
          uomCode: h.uom_code,
          bestBefore: h.best_before,
          mfgDate: h.mfg_date,
          receiptTempC: h.receipt_temp_c === null ? null : Number(h.receipt_temp_c),
          pctAtReceipt: h.pct_at_receipt === null ? null : Number(h.pct_at_receipt),
          dwellBreach: h.dwell_breach,
          source: h.source,
          receivedAt: h.received_at,
          grnNo: h.grn_no,
          gateEntryNo: h.gate_entry_no,
          arrivedAt: h.arrived_at,
          vendorName: h.vendor_name,
          vendorCode: h.vendor_code,
          vendorFssai: h.vendor_fssai,
          decision: h.decision,
          rejectReason: h.reject_reason,
          qtyAccepted: h.qty_accepted === null ? null : toQty(h.qty_accepted),
          qtyRejected: h.qty_rejected === null ? null : toQty(h.qty_rejected),
          receivedBy: h.received_by,
        }
      : null,
    steps: (trail.data ?? []).map((s) => ({
      occurredAt: s.occurred_at,
      reason: s.reason,
      qty: toQty(s.qty),
      uomCode: s.uom_code,
      fromCode: s.from_code,
      fromName: s.from_name,
      fromState: s.from_state,
      toCode: s.to_code,
      toName: s.to_name,
      toState: s.to_state,
      scanMethod: s.scan_method,
      recordedByName: s.recorded_by_name,
      note: s.note,
    })),
  };
}

/**
 * What each movement means, in words rather than in the enum's.
 *
 * A trace is read aloud to an inspector. "GRN_POSTING" is not a sentence; "received at
 * Terminal 1" is.
 */
export const REASON_LABELS: Record<MovementReason, string> = {
  OPENING_STOCK: "Recorded as opening stock",
  GRN_POSTING: "Received",
  PUT_AWAY: "Put away",
  ZONE_TRANSFER: "Moved between zones",
  ISSUE: "Issued to a department",
  RETURN_TO_STORE: "Returned to the store",
  DISPATCH_STAGING: "Staged at Terminal 2",
  GATE_OUT: "Left the property",
  WRITE_OFF_EXPIRED: "Written off — expired",
  WRITE_OFF_DAMAGED: "Written off — damaged",
  CORRECTION: "Correction",
};

/** The six reasons at P1, in the words a storekeeper used when they chose one. */
export const REJECT_LABELS: Record<RejectReason, string> = {
  SHORT_SHELF_LIFE: "Too close to expiry",
  NOT_COLD_ENOUGH: "Not cold enough",
  POOR_QUALITY: "Poor quality",
  DAMAGED: "Damaged",
  WRONG_ITEM: "Wrong item",
  OTHER: "Something else",
};
