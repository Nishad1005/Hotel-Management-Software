import type { MovementReason, StockState } from "@golai/db";
import { requireSupabase } from "./supabase";

/**
 * Stock reads and writes.
 *
 * Reads come from stock_lot, the maintained projection — replaying the ledger on every
 * screen would not survive a year of movements. Writes go to stock_movement, which is
 * append-only: a correction is a compensating movement, never an edit (ADR 0003).
 */

export interface StockLine {
  batchId: string;
  batchNo: string;
  isSystemGenerated: boolean;
  itemId: string;
  itemName: string;
  itemCode: string;
  uomCode: string;
  uomId: string;
  locationId: string;
  locationCode: string;
  state: StockState;
  qty: number;
  bestBefore: number | null;
  shelfLifeTotalDays: number | null;
}

/** Everything currently on hand. Zero and negative lots are excluded as noise. */
export async function listStockOnHand(): Promise<StockLine[]> {
  const { data, error } = await requireSupabase()
    .from("stock_lot")
    .select(
      `qty, state, location_id,
       location:location_id(code),
       batch:batch_id(id, batch_no, is_system_generated, best_before, shelf_life_total_days,
                      item:item_id(id, name, code, base_uom_id, uom:base_uom_id(id, code)))`,
    )
    .gt("qty", 0)
    .limit(500);

  if (error) throw new Error(error.message);

  return (data ?? []).flatMap((raw) => {
    const row = raw as unknown as StockLotJoin;
    const batch = row.batch;
    const item = batch?.item;
    if (!batch || !item) return [];
    return [
      {
        batchId: batch.id,
        batchNo: batch.batch_no,
        isSystemGenerated: batch.is_system_generated,
        itemId: item.id,
        itemName: item.name,
        itemCode: item.code,
        uomCode: item.uom?.code ?? "",
        uomId: item.uom?.id ?? item.base_uom_id,
        locationId: row.location_id,
        locationCode: row.location?.code ?? "",
        state: row.state,
        qty: Number(row.qty),
        // Dates arrive as YYYY-MM-DD. Parsed as UTC midnight so a device in IST does
        // not shift an expiry date by a day.
        bestBefore: batch.best_before ? Date.parse(`${batch.best_before}T00:00:00Z`) : null,
        shelfLifeTotalDays: batch.shelf_life_total_days,
      },
    ];
  });
}

export interface OpeningStockEntry {
  propertyId: string;
  itemId: string;
  uomId: string;
  locationId: string;
  qty: number;
  batchNo: string | null;
  bestBefore: string | null;
  shelfLifeTotalDays: number | null;
}

/**
 * Records stock that is already physically in the store.
 *
 * Creates a batch, then a single movement into AVAILABLE. Two statements rather than
 * one because a batch is a first-class record (PRD section 9) that later movements,
 * traces and registers all hang off — it is not an attribute of the movement.
 */
export async function recordOpeningStock(entry: OpeningStockEntry): Promise<void> {
  const client = requireSupabase();

  const batchNo = entry.batchNo?.trim() || `OPEN-${Date.now().toString(36).toUpperCase()}`;

  const { data: batch, error: batchError } = await client
    .from("batch")
    .insert({
      property_id: entry.propertyId,
      item_id: entry.itemId,
      batch_no: batchNo,
      is_system_generated: !entry.batchNo?.trim(),
      best_before: entry.bestBefore,
      shelf_life_total_days: entry.shelfLifeTotalDays,
      source: "OPENING_STOCK",
    })
    .select("id")
    .single();

  if (batchError) throw new Error(friendlyError(batchError.code, batchError.message));

  const { error: moveError } = await client.from("stock_movement").insert({
    property_id: entry.propertyId,
    batch_id: batch.id,
    item_id: entry.itemId,
    to_location_id: entry.locationId,
    to_state: "AVAILABLE",
    qty: entry.qty,
    uom_id: entry.uomId,
    reason: "OPENING_STOCK",
    // Derived from the batch, so a retry cannot post the quantity twice.
    idempotency_key: `open:${batch.id}`,
  });

  if (moveError) throw new Error(friendlyError(moveError.code, moveError.message));
}

/**
 * Moves stock out of AVAILABLE.
 *
 * Used for both issuing and writing off. Both are the same shape — stock leaves a
 * location — and differ only in reason and destination state, which is exactly what
 * the ledger models.
 */
export async function moveStockOut(params: {
  propertyId: string;
  line: StockLine;
  qty: number;
  reason: MovementReason;
  toState: StockState | null;
  note?: string;
}): Promise<void> {
  const { error } = await requireSupabase()
    .from("stock_movement")
    .insert({
      property_id: params.propertyId,
      batch_id: params.line.batchId,
      item_id: params.line.itemId,
      from_location_id: params.line.locationId,
      from_state: params.line.state,
      to_location_id: params.toState ? params.line.locationId : null,
      to_state: params.toState,
      qty: params.qty,
      uom_id: params.line.uomId,
      reason: params.reason,
      note: params.note ?? null,
      // Time-based so two genuine issues of the same batch are distinct events, while
      // a retry of one submission is not.
      idempotency_key: `${params.reason}:${params.line.batchId}:${Date.now()}`,
    });

  if (error) throw new Error(friendlyError(error.code, error.message));
}

function friendlyError(code: string | undefined, message: string): string {
  if (code === "23505") return "That has already been recorded.";
  if (code === "42501") return "You do not have permission to record stock at this property.";
  if (code === "23514" && message.includes("rejected_cannot_reach_a_zone")) {
    return "Rejected stock cannot be moved into a zone. It can only leave via dispatch.";
  }
  return message;
}

interface StockLotJoin {
  qty: number | string;
  state: StockState;
  location_id: string;
  location: { code: string } | null;
  batch: {
    id: string;
    batch_no: string;
    is_system_generated: boolean;
    best_before: string | null;
    shelf_life_total_days: number | null;
    item: {
      id: string;
      name: string;
      code: string;
      base_uom_id: string;
      uom: { id: string; code: string } | null;
    } | null;
  } | null;
}
