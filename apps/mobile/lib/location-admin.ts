import type { LocationKind, StorageRegime } from "@golai/db";
import { planLocationRun, planZone } from "@golai/domain";
import { requireSupabase } from "./supabase";

/**
 * Building a property's storage tree.
 *
 * Written as implementer tooling — we take the layout a property sends and generate the
 * tree — and it turned out the property wants to do it themselves. It works either way:
 * the write policy is OWNER/ADMIN, which a property administrator holds, and the fixture
 * name is asked for in their words rather than ours.
 *
 * Everything here is shaped around one person doing it quickly and not being able to make
 * a mess somebody else has to clean up: the codes are previewed before anything is
 * written, a run is capped, and retiring a location is refused while stock is on it.
 */

export interface LocationNode {
  id: string;
  code: string;
  name: string;
  kind: LocationKind;
  fixtureType: string;
  parentId: string | null;
  regime: StorageRegime;
  sortKey: number | null;
}

export interface ZoneSummary extends LocationNode {
  children: LocationNode[];
}

/** Kinds that can hold bins. A bin cannot itself be a parent. */
const PARENTABLE: LocationKind[] = ["ZONE", "RECEIVING", "REJECT", "DISPATCH", "RACK"];

/**
 * The whole active tree, in one read.
 *
 * A property runs to a couple of hundred locations, so fetching all of them and
 * grouping here is cheaper than a query per zone — and it means the expand/collapse in
 * the screen is instant rather than a spinner per row.
 */
export async function listLocationTree(): Promise<ZoneSummary[]> {
  const { data, error } = await requireSupabase()
    .from("location")
    .select("id, code, name, kind, fixture_type, parent_id, regime, sort_key")
    .eq("is_active", true)
    .order("sort_key", { ascending: true, nullsFirst: false })
    .order("code");

  if (error) throw new Error(error.message);

  const nodes: LocationNode[] = (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    fixtureType: row.fixture_type,
    parentId: row.parent_id,
    regime: row.regime,
    sortKey: row.sort_key,
  }));

  const parents = nodes.filter((n) => PARENTABLE.includes(n.kind) && n.parentId === null);
  const byParent = new Map<string, LocationNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
  }

  return parents.map((zone) => ({ ...zone, children: byParent.get(zone.id) ?? [] }));
}

export interface ZoneInput {
  propertyId: string;
  propertyCode: string;
  name: string;
  suffix?: string;
  regime: StorageRegime;
  /** The property's word for what is inside — Shelf, Rack, Ghoda, Peti stack. */
  fixtureType: string;
}

/**
 * Creates a storage zone.
 *
 * Provisioning seeds seven and that is a starting set, not a complete one. A resort has a
 * pool bar store and a spa store; without this the seeded seven were all a property could
 * ever have, and its own layout had nowhere to go.
 *
 * A zone rather than a bin: `kind = 'ZONE'` and no parent, which is what makes it appear
 * as a heading on the tree screen and what makes it a lawful parent for a run of bins.
 * Put-away still refuses it as a destination — only the leaf is one — so adding a zone
 * cannot accidentally create somewhere stock can be dumped without a label.
 */
export async function createZone(input: ZoneInput): Promise<{ id: string; code: string }> {
  const plan = planZone({
    propertyCode: input.propertyCode,
    name: input.name,
    ...(input.suffix ? { suffix: input.suffix } : {}),
  });

  if (!plan.ok) throw new Error(`Cannot create that zone: ${plan.errors.join(", ")}`);

  const client = requireSupabase();

  // Reactivated rather than inserted where the code was retired, for the same reason the
  // bin run does it: a retired row still occupies `unique (property_id, code)`, so an
  // insert reports a duplicate and a plain upsert silently does nothing at all.
  const { data: revived, error: reviveError } = await client
    .from("location")
    .update({ is_active: true, name: input.name.trim(), regime: input.regime })
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
      fixture_type: input.fixtureType.trim() || "Shelf",
    })
    .select("id, code")
    .single();

  if (error) throw new Error(friendly(error.code, error.message));
  return { id: data.id, code: data.code };
}

export interface LocationRunInput {
  propertyId: string;
  parent: LocationNode;
  fixtureName: string;
  prefix?: string;
  from: number;
  to: number;
}

export interface LocationRunResult {
  created: number;
  /** Codes that existed but had been retired, and were brought back rather than skipped. */
  revived: number;
  codes: string[];
}

/**
 * Creates a run of bins under a zone.
 *
 * The reactivate-first step is not defensive tidying, it is the whole reason this
 * function exists rather than a plain upsert. Retiring a location leaves its row in
 * place, so its code still occupies `unique (property_id, code)` — and an upsert with
 * `ignoreDuplicates` then silently inserts nothing when somebody recreates it. Zero
 * rows affected, no error, no locations: CLAUDE.md rule 4b, and the exact bug golaiv1
 * had to go back and fix. pgTAP 015 pins the constraint this relies on.
 */
export async function createLocationRun(input: LocationRunInput): Promise<LocationRunResult> {
  const plan = planLocationRun({
    parentCode: input.parent.code,
    fixtureName: input.fixtureName,
    ...(input.prefix ? { prefix: input.prefix } : {}),
    from: input.from,
    to: input.to,
  });

  if (!plan.ok) throw new Error(`Cannot create that run: ${plan.errors.join(", ")}`);

  const client = requireSupabase();

  const { data: revivedRows, error: reviveError } = await client
    .from("location")
    .update({ is_active: true })
    .eq("property_id", input.propertyId)
    .eq("is_active", false)
    .in("code", plan.codes)
    .select("id");

  // Zero here is the ordinary case — nothing was retired — so it is deliberately not
  // treated as a failure, unlike almost every other write in this app.
  if (reviveError) throw new Error(friendly(reviveError.code, reviveError.message));
  const revived = revivedRows?.length ?? 0;

  const rows = plan.codes.map((code, index) => ({
    property_id: input.propertyId,
    code,
    // The property's own word, numbered. "Ghoda 1", not "Bin 1".
    name: `${input.fixtureName.trim() || "Shelf"} ${input.from + index}`,
    kind: "BIN" as const,
    parent_id: input.parent.id,
    // Inherited: a bin inside the cold room is chilled, and asking twice is how the
    // two end up disagreeing.
    regime: input.parent.regime,
    fixture_type: input.fixtureName.trim() || "Shelf",
    sort_key: input.from + index,
  }));

  const { data: inserted, error: insertError } = await client
    .from("location")
    .upsert(rows, { onConflict: "property_id,code", ignoreDuplicates: true })
    .select("id");

  if (insertError) throw new Error(friendly(insertError.code, insertError.message));

  return { created: inserted?.length ?? 0, revived, codes: plan.codes };
}

/**
 * Retires a location.
 *
 * Through the RPC rather than an update, because it refuses while stock is still there
 * — and that refusal is the point. Emptying a location is a compensating movement with
 * a reason and a named person, not an admin screen quietly making stock disappear.
 */
export async function deactivateLocation(propertyId: string, locationId: string): Promise<void> {
  const { error } = await requireSupabase().rpc("deactivate_location", {
    p_property_id: propertyId,
    p_location_id: locationId,
  });

  if (error) throw new Error(friendly(error.code, error.message));
}

function friendly(code: string | undefined, message: string): string {
  if (code === "42501")
    return "Changing the store layout needs an Administrator. Recording stock does not, and neither should hold the other.";
  if (code === "23505") return "A location with that code already exists here.";
  return message;
}
