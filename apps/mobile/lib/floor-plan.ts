import type {
  FacilityRoomRow,
  LocationRow,
  PlanDataBehavior,
  PlanSize,
  StorageRegime,
} from "@golai/db";
import { planZone, resolveVisual } from "@golai/domain";
import { requireSupabase } from "./supabase";

/**
 * Reading and writing the floor plan.
 *
 * There is no separate store of plan locations: a location on the plan is a row in
 * `location`, and this module only ever adds the room grouping and the three
 * presentation columns to what is already there (ADR 0017). That is why creating a
 * location here is `createZone` and not something new — a property typing its store into
 * the Floor Plan step is building its storage tree, and the plan assembling as they type
 * is the same act seen from the other side.
 *
 * It never creates bins. Those are scanned put-away destinations under hard rule 13, and
 * a screen whose job is drawing a picture must not become a way to conjure somewhere
 * stock can be dumped without a label.
 */

export interface PlanLocation {
  id: string;
  code: string;
  name: string;
  regime: StorageRegime;
  roomId: string | null;
  /** What the property chose, or null meaning "derive from the regime". */
  visual: string | null;
  behavior: PlanDataBehavior | null;
  size: PlanSize | null;
  sortKey: number | null;
}

export interface PlanRoom {
  id: string;
  name: string;
  sortOrder: number | null;
  locations: PlanLocation[];
}

export interface FloorPlan {
  rooms: PlanRoom[];
  /**
   * Zones the property has not put in a room yet. Drawn all the same, gathered into one
   * implicit room — a plan does not require setup to have been done, which is the whole
   * reason the seeded seven locations show up before anyone opens this screen.
   */
  ungrouped: PlanLocation[];
}

/**
 * The whole plan in two reads.
 *
 * Deliberately not one join. The rooms and the zones are small, independent lists, and
 * fetching them separately means an empty `facility_room` table still returns every zone
 * — where an inner join would have returned nothing and looked exactly like a property
 * with no storage at all.
 */
export async function loadFloorPlan(): Promise<FloorPlan> {
  const client = requireSupabase();

  const [roomsRes, locsRes] = await Promise.all([
    client
      .from("facility_room")
      .select("id, name, sort_order")
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name"),
    client
      .from("location")
      .select(
        "id, code, name, regime, facility_room_id, plan_visual_type, plan_data_behavior, plan_size, sort_key",
      )
      .eq("kind", "ZONE")
      .eq("is_active", true)
      .order("sort_key", { ascending: true, nullsFirst: false })
      .order("code"),
  ]);

  if (roomsRes.error) throw new Error(friendly(roomsRes.error.code, roomsRes.error.message));
  if (locsRes.error) throw new Error(friendly(locsRes.error.code, locsRes.error.message));

  const locations: PlanLocation[] = (locsRes.data ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    regime: r.regime,
    roomId: r.facility_room_id,
    visual: r.plan_visual_type,
    behavior: r.plan_data_behavior,
    size: r.plan_size,
    sortKey: r.sort_key,
  }));

  const byRoom = new Map<string, PlanLocation[]>();
  for (const l of locations) {
    if (!l.roomId) continue;
    byRoom.set(l.roomId, [...(byRoom.get(l.roomId) ?? []), l]);
  }

  return {
    rooms: (roomsRes.data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
      locations: byRoom.get(r.id) ?? [],
    })),
    ungrouped: locations.filter((l) => !l.roomId),
  };
}

export async function createRoom(
  propertyId: string,
  name: string,
  sortOrder: number,
): Promise<{ id: string }> {
  const { data, error } = await requireSupabase()
    .from("facility_room")
    .insert({ property_id: propertyId, name: name.trim(), sort_order: sortOrder })
    .select("id")
    .single();

  if (error) throw new Error(friendly(error.code, error.message));
  return { id: data.id };
}

/**
 * Renames or reorders a room.
 *
 * `select()` is not decoration: RLS denies UPDATE by making rows invisible rather than by
 * raising, so a storekeeper's rename succeeds having changed nothing at all. The returned
 * row count is the only evidence the write landed (CLAUDE.md 4b).
 */
export async function updateRoom(
  propertyId: string,
  roomId: string,
  patch: { name?: string; sortOrder?: number },
): Promise<void> {
  const fields: Partial<FacilityRoomRow> = {};
  if (patch.name !== undefined) fields.name = patch.name.trim();
  if (patch.sortOrder !== undefined) fields.sort_order = patch.sortOrder;
  if (Object.keys(fields).length === 0) return;

  const { data, error } = await requireSupabase()
    .from("facility_room")
    .update(fields)
    .eq("property_id", propertyId)
    .eq("id", roomId)
    .select("id");

  if (error) throw new Error(friendly(error.code, error.message));
  if (!data || data.length === 0) throw new Error(DENIED);
}

/** Through the RPC, so the refusal is loud rather than a silent no-op. */
export async function deleteRoom(propertyId: string, roomId: string): Promise<void> {
  const { error } = await requireSupabase().rpc("delete_facility_room", {
    p_property_id: propertyId,
    p_room_id: roomId,
  });
  if (error) throw new Error(friendly(error.code, error.message));
}

export interface PlanPatch {
  roomId?: string | null;
  visual?: string | null;
  behavior?: PlanDataBehavior | null;
  size?: PlanSize | null;
  name?: string;
}

/** Sets a location's plan attributes. Same silent-denial caveat as `updateRoom`. */
export async function updateLocationPlan(
  propertyId: string,
  locationId: string,
  patch: PlanPatch,
): Promise<void> {
  const fields: Partial<LocationRow> = {};
  if (patch.roomId !== undefined) fields.facility_room_id = patch.roomId;
  if (patch.visual !== undefined) fields.plan_visual_type = patch.visual;
  if (patch.behavior !== undefined) fields.plan_data_behavior = patch.behavior;
  if (patch.size !== undefined) fields.plan_size = patch.size;
  if (patch.name !== undefined) fields.name = patch.name.trim();
  if (Object.keys(fields).length === 0) return;

  const { data, error } = await requireSupabase()
    .from("location")
    .update(fields)
    .eq("property_id", propertyId)
    .eq("id", locationId)
    .select("id");

  if (error) throw new Error(friendly(error.code, error.message));
  if (!data || data.length === 0) throw new Error(DENIED);
}

export interface NewPlanLocation {
  propertyId: string;
  propertyCode: string;
  roomId: string;
  name: string;
  regime: StorageRegime;
  visual: string;
  behavior: PlanDataBehavior;
  size: PlanSize;
  /** The property's own word for what is inside — Shelf, Rack, Ghoda. */
  fixtureType?: string;
}

/**
 * Adds a storage zone from the Floor Plan step.
 *
 * A real zone in `location`, with the same generated code and the same OWNER/ADMIN policy
 * the location tree screen uses — not a plan-only entity. The reactivate-first step is
 * there for the reason `createZone` has one: a retired code still occupies
 * `unique (property_id, code)`, so a plain insert reports a duplicate and a plain upsert
 * silently does nothing.
 */
export async function createPlanLocation(
  input: NewPlanLocation,
): Promise<{ id: string; code: string }> {
  const plan = planZone({ propertyCode: input.propertyCode, name: input.name });
  if (!plan.ok) throw new Error(`Cannot add that location: ${plan.errors.join(", ")}`);

  const client = requireSupabase();
  const fields = {
    facility_room_id: input.roomId,
    plan_visual_type: input.visual,
    plan_data_behavior: input.behavior,
    plan_size: input.size,
  };

  const { data: revived, error: reviveError } = await client
    .from("location")
    .update({ is_active: true, name: input.name.trim(), regime: input.regime, ...fields })
    .eq("property_id", input.propertyId)
    .eq("code", plan.code)
    .eq("is_active", false)
    .select("id, code");

  if (reviveError) throw new Error(friendly(reviveError.code, reviveError.message));
  if (revived && revived.length > 0) return { id: revived[0]!.id, code: revived[0]!.code };

  const { data, error } = await client
    .from("location")
    .insert({
      property_id: input.propertyId,
      code: plan.code,
      name: input.name.trim(),
      kind: "ZONE",
      parent_id: null,
      regime: input.regime,
      fixture_type: input.fixtureType?.trim() || "Shelf",
      ...fields,
    })
    .select("id, code")
    .single();

  if (error) throw new Error(friendly(error.code, error.message));
  return { id: data.id, code: data.code };
}

/** The visual to draw, given what the property chose and what their regime implies. */
export function visualFor(location: PlanLocation): string {
  return resolveVisual(location.visual, "ZONE", location.regime);
}

const DENIED =
  "That change did not apply. Redrawing the floor plan needs an Administrator — recording stock does not, and neither should hold the other.";

function friendly(code: string | undefined, message: string): string {
  if (code === "42501") return DENIED;
  if (code === "23505") return "There is already a room with that name here.";
  // The composite tenant FK. Reachable only from a stale client holding an id from a
  // property the user has since left, so it says what to do rather than what happened.
  if (code === "23503") return "That room is no longer here. Reload the plan and try again.";
  return message;
}
