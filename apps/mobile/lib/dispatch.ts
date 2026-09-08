import {
  serverAnswered,
  type DispatchStageLine,
  type DispatchType,
  type StockState,
} from "@golai/db";
import { toQty } from "@golai/domain";
import { notifyOutboxChanged, outbox } from "./outbox";
import { requireSupabase } from "./supabase";

/**
 * Gates 9 and 10 — Terminal 2 staging, and the gate pass out.
 *
 * These two exist so that a reject decision is a decision rather than a dead end. A
 * storekeeper holding fifty kilos of bad fish with no way to send it back does not leave
 * it in the cage; they walk it out of a side door, and every control upstream becomes
 * decoration.
 *
 * They are deliberately two calls and usually two people. Staging says what is leaving;
 * the gate pass says it left, and PRD section 11 requires those not be the same person —
 * which the server enforces against the individual, not the role.
 */

export interface DispatchableLot {
  batchId: string;
  batchNo: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  uomId: string;
  uomCode: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  state: StockState;
  qty: number;
  bestBefore: string | null;
}

export async function listDispatchableStock(propertyId: string): Promise<DispatchableLot[]> {
  const { data, error } = await requireSupabase().rpc("list_dispatchable_stock", {
    p_property_id: propertyId,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    batchId: row.batch_id,
    batchNo: row.batch_no,
    itemId: row.item_id,
    itemName: row.item_name,
    itemCode: row.item_code,
    uomId: row.uom_id,
    uomCode: row.uom_code,
    locationId: row.location_id,
    locationCode: row.location_code,
    locationName: row.location_name,
    state: row.state,
    qty: toQty(row.qty),
    bestBefore: row.best_before,
  }));
}

/**
 * The kinds of departure, in the words a storekeeper would use.
 *
 * Ordered by how often they happen at a hotel rather than alphabetically. The rest of the
 * enum — inter-property transfer, outdoor catering, used cooking oil — arrives with the
 * modules that own them.
 */
export const DISPATCH_TYPES: { id: DispatchType; label: string; hint: string }[] = [
  { id: "SUPPLIER_RETURN", label: "Back to the vendor", hint: "Rejected goods" },
  { id: "EMPTIES", label: "Empties", hint: "Bottles, crates, cylinders" },
  { id: "LINEN", label: "Linen to the laundry", hint: "Comes back" },
  { id: "EQUIPMENT_REPAIR", label: "Equipment for repair", hint: "Comes back" },
  { id: "CONDEMNED", label: "Condemned", hint: "Unfit, written off" },
  { id: "FOOD_WASTE", label: "Food waste", hint: "To a registered handler" },
  { id: "USED_COOKING_OIL", label: "Used cooking oil", hint: "Regulated register" },
  { id: "SCRAP", label: "Scrap", hint: "Sold or removed" },
];

/** Departures the property expects to see again. Gate 9 forces a return date on these. */
export const RETURNABLE_TYPES: DispatchType[] = [
  "LINEN",
  "EQUIPMENT_REPAIR",
  "OUTDOOR_CATERING",
  "EMPTIES",
];

export interface DraftDispatchLine {
  lot: DispatchableLot;
  qty: number;
}

/**
 * What became of a staging.
 *
 * Gate 9 queues; Gate 10 does not. The PRD puts gate-out among the two steps that must
 * reach the server, because a gate pass is the thing Security checks against a vehicle
 * that is about to leave, and a pass issued from an unsynced device is a pass nobody
 * else can see. Staging is the opposite: it moves stock to Terminal 2 inside the
 * property, which is an internal movement like any other and safe to record offline.
 */
export type StagedResult =
  | { status: "STAGED"; dispatchId: string; dispatchNo: string }
  | { status: "QUEUED" };

export async function stageForDispatch(params: {
  propertyId: string;
  dispatchType: DispatchType;
  recipientPartyId: string | null;
  reasonCode: string | null;
  isReturnable: boolean;
  expectedReturnDate: string | null;
  lines: DraftDispatchLine[];
  submissionId: string;
}): Promise<StagedResult> {
  const payload: DispatchStageLine[] = params.lines.map((l) => ({
    batch_id: l.lot.batchId,
    from_location_id: l.lot.locationId,
    from_state: l.lot.state,
    qty: l.qty,
  }));

  const queue = async (): Promise<StagedResult> => {
    await outbox.enqueue({
      type: "DISPATCH_STAGE",
      idempotencyKey: params.submissionId,
      payload: {
        propertyId: params.propertyId,
        dispatchType: params.dispatchType,
        recipientPartyId: params.recipientPartyId,
        reasonCode: params.reasonCode,
        isReturnable: params.isReturnable,
        expectedReturnDate: params.expectedReturnDate,
        lines: payload,
      },
    });
    notifyOutboxChanged();
    return { status: "QUEUED" };
  };

  let data;
  let error;
  try {
    ({ data, error } = await requireSupabase().rpc("stage_for_dispatch", {
      p_property_id: params.propertyId,
      p_dispatch_type: params.dispatchType,
      p_recipient_party_id: params.recipientPartyId,
      p_reason_code: params.reasonCode,
      p_is_returnable: params.isReturnable,
      p_expected_return_date: params.expectedReturnDate,
      p_idempotency_key: params.submissionId,
      p_lines: payload,
    }));
  } catch {
    // Nothing answered, so there is no verdict to respect. See postReceipt.
    return queue();
  }

  // A server that answered is obeyed, including when it refuses for want of stock.
  if (error) {
    if (serverAnswered(error)) throw new Error(friendly(error.code, error.message));
    return queue();
  }

  const row = (data ?? [])[0];
  if (!row) throw new Error("The dispatch did not stage. Nothing moved; try again.");
  return { status: "STAGED", dispatchId: row.dispatch_id, dispatchNo: row.dispatch_no };
}

export interface StagedDispatch {
  dispatchId: string;
  dispatchNo: string;
  dispatchType: DispatchType;
  recipientName: string | null;
  isReturnable: boolean;
  expectedReturnDate: string | null;
  stagedByName: string | null;
  /** Who staged it, so the screen can say why the pass button is not for them. */
  stagedBy: string | null;
  stagedAt: string;
  lineCount: number;
  totalQty: number;
}

export async function listAwaitingGatePass(propertyId: string): Promise<StagedDispatch[]> {
  const { data, error } = await requireSupabase().rpc("list_awaiting_gate_pass", {
    p_property_id: propertyId,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    dispatchId: row.dispatch_id,
    dispatchNo: row.dispatch_no,
    dispatchType: row.dispatch_type,
    recipientName: row.recipient_name,
    isReturnable: row.is_returnable,
    expectedReturnDate: row.expected_return_date,
    stagedByName: row.staged_by_name,
    stagedBy: row.staged_by,
    stagedAt: row.staged_at,
    lineCount: row.line_count,
    totalQty: toQty(row.total_qty),
  }));
}

export async function issueGatePass(params: {
  propertyId: string;
  dispatchNoteId: string;
  carrier: string;
  vehicleNumber: string | null;
  packageCount: number | null;
  submissionId: string;
}): Promise<{ gatePassId: string; gatePassNo: string }> {
  const { data, error } = await requireSupabase().rpc("issue_gate_pass", {
    p_property_id: params.propertyId,
    p_dispatch_note_id: params.dispatchNoteId,
    p_carrier: params.carrier,
    p_vehicle_number: params.vehicleNumber,
    p_package_count: params.packageCount,
    p_idempotency_key: params.submissionId,
  });

  if (error) throw new Error(friendly(error.code, error.message));

  const row = (data ?? [])[0];
  if (!row) throw new Error("The gate pass did not issue. Nothing left the property; try again.");
  return { gatePassId: row.gate_pass_id, gatePassNo: row.gate_pass_no };
}

function friendly(code: string | undefined, message: string): string {
  // The server's own 42501 messages here are specific and worth keeping — "you staged
  // this", "passing goods out is Security's job" — so only the generic case is rewritten.
  if (code === "42501" && !message.includes("staged") && !message.includes("Security"))
    return "You do not have permission to do that at this property.";
  if (code === "PGRST202")
    return "This build is talking to a database that does not have dispatch yet. The migration has not been deployed.";
  return message;
}
