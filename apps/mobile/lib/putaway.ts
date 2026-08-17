import type { ScanMethod, StorageRegime } from "@golai/db";
import { toQty } from "@golai/domain";
import { requireSupabase } from "./supabase";

/**
 * Gate 6 — put-away.
 *
 * The destination is sent as a CODE, never an id. That is deliberate: what comes off a
 * label is a string, and resolving it server-side means this app never has to hold a bin
 * list in order to interpret one. A property with four hundred bins would otherwise be
 * downloading them to a dock device to do a lookup the database can do better.
 */

export interface AwaitingPutaway {
  batchId: string;
  batchNo: string;
  isSystemGenerated: boolean;
  itemId: string;
  itemName: string;
  itemCode: string;
  storageRegime: StorageRegime;
  uomId: string;
  uomCode: string;
  locationId: string;
  locationCode: string;
  qty: number;
  bestBefore: string | null;
  /** Server-computed. A dwell figure from a device clock would not be one. */
  hoursWaiting: number | null;
}

export async function listAwaitingPutaway(propertyId: string): Promise<AwaitingPutaway[]> {
  const { data, error } = await requireSupabase().rpc("list_awaiting_putaway", {
    p_property_id: propertyId,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    batchId: row.batch_id,
    batchNo: row.batch_no,
    isSystemGenerated: row.is_system_generated,
    itemId: row.item_id,
    itemName: row.item_name,
    itemCode: row.item_code,
    storageRegime: row.storage_regime,
    uomId: row.uom_id,
    uomCode: row.uom_code,
    locationId: row.location_id,
    locationCode: row.location_code,
    // Numeric arrives as a string. The moment two of these are added anywhere, Number()
    // having been skipped makes the result concatenate instead of summing.
    qty: toQty(row.qty),
    bestBefore: row.best_before,
    hoursWaiting: row.hours_waiting === null ? null : Number(row.hours_waiting),
  }));
}

export interface PutAwayResult {
  movementId: string;
  toLocationId: string;
  toLocationCode: string;
  /** What is still at Terminal 1 for this batch. Zero means the line is finished. */
  remaining: number;
}

export async function putAway(params: {
  propertyId: string;
  batchId: string;
  fromLocationId: string;
  toLocationCode: string;
  qty: number;
  scanMethod: ScanMethod;
  submissionId: string;
}): Promise<PutAwayResult> {
  const { data, error } = await requireSupabase().rpc("put_away", {
    p_property_id: params.propertyId,
    p_batch_id: params.batchId,
    p_from_location_id: params.fromLocationId,
    p_to_location_code: params.toLocationCode,
    p_qty: params.qty,
    p_scan_method: params.scanMethod,
    p_idempotency_key: params.submissionId,
  });

  if (error) throw new Error(friendly(error.code, error.message));

  const row = (data ?? [])[0];
  if (!row) throw new Error("The put-away did not record. Nothing was moved; try again.");

  return {
    movementId: row.movement_id,
    toLocationId: row.to_location_id,
    toLocationCode: row.to_location_code,
    remaining: toQty(row.remaining),
  };
}

/**
 * put_away raises in words a storekeeper can act on — which bin, which regime, why
 * rejected stock has no path. Almost nothing here rewrites a message; what it handles is
 * the failures that never reach the function body.
 */
function friendly(code: string | undefined, message: string): string {
  if (code === "42501" && !message.includes("belong"))
    return "You do not have permission to put stock away at this property.";
  if (code === "23505")
    return "That put-away has already been recorded. Refresh to see where the stock went.";
  if (code === "PGRST202")
    return "This build is talking to a database that does not have put-away yet. The migration has not been deployed.";
  return message;
}
