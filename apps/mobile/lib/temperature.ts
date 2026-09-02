import type { StorageRegime } from "@golai/db";
import { outbox } from "./outbox";
import { requireSupabase } from "./supabase";

/**
 * The temperature round — capture and register (PRD section 7.3).
 *
 * Capture goes through the offline outbox, exactly as gate entries do. That is not
 * incidental: the cold room is the worst corner of the building for signal, and a round
 * that fails to save at the freezer door is a round that stops being walked within a
 * week. The reading queues with its own idempotency key and syncs when the network
 * allows; a resend of an unanswered send lands on the named constraint and is
 * recognised as this device's own.
 */

export interface ColdLocation {
  id: string;
  code: string;
  name: string;
  regime: StorageRegime;
}

/** The units on the round: every active chilled or frozen location, coldest last. */
export async function listColdLocations(propertyId: string): Promise<ColdLocation[]> {
  const { data, error } = await requireSupabase()
    .from("location")
    .select("id, code, name, regime")
    // Explicit, not left to RLS — a group storekeeper's RLS shows two properties,
    // and a round is walked at one of them.
    .eq("property_id", propertyId)
    .in("regime", ["CHILLED", "FROZEN"])
    .eq("is_active", true)
    .order("regime") // CHILLED before FROZEN — the walking order of the round
    .order("code");

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id, code: r.code, name: r.name, regime: r.regime }));
}

/**
 * Queues one reading. Resolves as soon as it is safely in the outbox — the walk
 * continues offline, and the sync engine owns delivery.
 */
export async function queueTemperatureReading(entry: {
  propertyId: string;
  locationId: string;
  temperatureC: number;
  recordedBy: string | undefined;
}): Promise<void> {
  await outbox.enqueue({
    type: "TEMPERATURE_READING",
    // Minted per submission, not derived from location-and-day: a second reading after
    // the compressor is fixed is a new fact, and deriving the key would silently
    // swallow it as a duplicate of the alarming one.
    idempotencyKey: newReadingKey(),
    payload: {
      propertyId: entry.propertyId,
      locationId: entry.locationId,
      temperatureC: entry.temperatureC,
      recordedBy: entry.recordedBy,
      takenAt: Date.now(),
    },
  });
}

function newReadingKey(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  return `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface StorageReading {
  id: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  regime: StorageRegime;
  temperatureC: number;
  /** The server's clock. What the device believed sits beside it in the row. */
  recordedAt: string;
  takenAtDevice: string | null;
}

/**
 * The register, newest first. `recorded_by` is on every row in the database for the
 * day an inspector export needs names; the screen does not show it yet because there
 * is no client-readable join from auth ids to names, and inventing one is not this
 * register's job.
 */
export async function listStorageReadings(
  propertyId: string,
  fromIso: string,
): Promise<StorageReading[]> {
  const client = requireSupabase();

  const [readings, locations] = await Promise.all([
    client
      .from("temperature_reading")
      .select("id, location_id, temperature_c, recorded_at, taken_at_device")
      .eq("property_id", propertyId)
      .gte("recorded_at", fromIso)
      .order("recorded_at", { ascending: false }),
    client.from("location").select("id, code, name, regime").eq("property_id", propertyId),
  ]);

  if (readings.error) throw new Error(friendly(readings.error.code, readings.error.message));
  if (locations.error) throw new Error(locations.error.message);

  const byId = new Map((locations.data ?? []).map((l) => [l.id, l]));

  return (readings.data ?? []).map((r) => {
    const loc = byId.get(r.location_id);
    return {
      id: r.id,
      locationId: r.location_id,
      locationCode: loc?.code ?? "?",
      locationName: loc?.name ?? "A removed location",
      regime: loc?.regime ?? "CHILLED",
      temperatureC: Number(r.temperature_c),
      recordedAt: r.recorded_at,
      takenAtDevice: r.taken_at_device,
    };
  });
}

function friendly(code: string | undefined, message: string): string {
  // 42P01 is what a table-less database answers where an RPC-less one says PGRST202.
  if (code === "42P01")
    return "This build is talking to a database that does not have the temperature register yet. The migration has not been deployed.";
  return message;
}
