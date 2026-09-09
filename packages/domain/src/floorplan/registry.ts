/**
 * The location type registry — what a place on the floor plan looks like, and where the
 * number on its pin comes from.
 *
 * Two things are deliberately separate here, and keeping them separate is the whole
 * reason this file exists rather than a switch in a component:
 *
 *   - the **visual** is how a location is drawn. It is a plain string, and an unknown one
 *     falls back rather than failing, because the set of pictures must be able to grow
 *     without a migration and without every client agreeing first.
 *   - the **behaviour** is which real source fills the pin. A property that keeps cheese
 *     in a chiller and counts wheels rather than reading temperatures gets a
 *     chiller-shaped box with a stock count on it, and we ship nothing.
 *
 * Nothing in this file may import anything hotel-specific. The engine that consumes it —
 * layout, gestures, level-of-detail, pins — reads only the shape below, so a different
 * registry is a different vertical (racks and dispatch bays for a factory, shelves and
 * counters for a parts business) on the same code. ADR 0017.
 *
 * Zero I/O, per ADR 0009: no clock, no network, no lookups. Every function here is a
 * total function of its arguments.
 */

/** Where a pin's number comes from. Mirrors the `plan_data_behavior` enum. */
export type PlanDataBehavior = "TEMPERATURE" | "COUNT" | "DWELL" | "RETURNABLE";

/** The footprint multiplier. Mirrors the `plan_size` enum. */
export type PlanSize = "S" | "M" | "L";

/** A location's floor area in scene units, before any room packing. */
export interface Footprint {
  /** Extent along the corridor. */
  w: number;
  /** Extent into the room. */
  d: number;
}

export interface LocationTypeEntry {
  /** What to call this kind of place when the property has not named it. */
  label: string;
  /** Its floor area at a given size. */
  footprint: (size: PlanSize) => Footprint;
  /** Where its pin's number comes from, unless the property says otherwise. */
  defaultBehavior: PlanDataBehavior;
}

/**
 * Size factors, ported verbatim from the reference demo's `SIZEF`.
 *
 * The spread is deliberately narrow. These describe "a smaller cold room" and "a bigger
 * cold room", not a scale control — a property choosing S must still get something that
 * reads as the same kind of place, and the auto-layout's bay arithmetic stays predictable
 * when no location can be three times its neighbour.
 */
export const SIZE_FACTOR: Record<PlanSize, number> = { S: 0.78, M: 1, L: 1.22 };

/** The size to assume when a location does not state one. */
export const DEFAULT_PLAN_SIZE: PlanSize = "M";

/**
 * The built-in visuals.
 *
 * Footprint rules are ported from the demo's `footprint()`. Two of them are not simply
 * `base × factor` and that is intentional rather than an oversight in the original:
 * shelving runs (`dry`, `linen`) get longer rather than squarer as they grow, because a
 * bigger dry store in a real building is another run of shelves along the same wall, not
 * a wider square. Their depth is fixed for the same reason.
 */
export const LOCATION_TYPES: Record<string, LocationTypeEntry> = {
  chiller: {
    label: "Walk-in Chiller",
    footprint: (s) => ({ w: 4.0 * SIZE_FACTOR[s], d: 3.9 }),
    defaultBehavior: "TEMPERATURE",
  },
  freezer: {
    label: "Deep Freeze",
    footprint: (s) => ({ w: 4.0 * SIZE_FACTOR[s], d: 3.9 }),
    defaultBehavior: "TEMPERATURE",
  },
  wine: {
    label: "Wine & Beverage",
    footprint: (s) => ({ w: 4.6 * SIZE_FACTOR[s], d: 4.6 }),
    defaultBehavior: "TEMPERATURE",
  },
  dry: {
    label: "Dry Store",
    footprint: (s) => ({ w: 3.6 + SIZE_FACTOR[s] * 1.2, d: 1.5 }),
    defaultBehavior: "COUNT",
  },
  linen: {
    label: "Linen Store",
    footprint: (s) => ({ w: 3.6 + SIZE_FACTOR[s] * 1.2, d: 1.5 }),
    defaultBehavior: "COUNT",
  },
  store: {
    label: "General Store",
    footprint: (s) => ({ w: 3.8 * SIZE_FACTOR[s], d: 3.9 }),
    defaultBehavior: "COUNT",
  },
  kegs: {
    label: "Kegs & Returnables",
    footprint: (s) => ({ w: 3.0 * SIZE_FACTOR[s], d: 2.6 }),
    defaultBehavior: "RETURNABLE",
  },
  staging: {
    label: "Staging",
    footprint: (s) => ({ w: 4.2 * SIZE_FACTOR[s], d: 3.8 }),
    defaultBehavior: "DWELL",
  },
};

/** The renderer an unrecognised visual falls back to. */
export const FALLBACK_VISUAL = "store";

/**
 * The entry for a visual, or the generic store when the name is not one we know.
 *
 * Never throws and never returns undefined. A location written by a newer client — or by
 * a property that typed something we have never seen — has to draw as *something*, and a
 * plain box carrying its real name is a better answer than a gap in the map or an error
 * where the dashboard should be.
 */
export function locationType(visual: string | null | undefined): LocationTypeEntry {
  return isKnownVisual(visual) ? LOCATION_TYPES[visual!]! : LOCATION_TYPES[FALLBACK_VISUAL]!;
}

/**
 * Whether this is a visual the registry actually knows how to draw.
 *
 * `Object.hasOwn` rather than a truthiness check on the lookup, because the value comes
 * from a text column a property types into. `LOCATION_TYPES["constructor"]` is truthy on
 * any object literal, so the plain lookup handed the renderer `Object` — a function, not
 * an entry — for a property that named a location "constructor". Far-fetched as a name
 * and trivial as a fix, but it is the general shape of the problem: user text used as a
 * key must be asked about ownership, never about truthiness.
 */
export function isKnownVisual(visual: string | null | undefined): boolean {
  return visual != null && Object.hasOwn(LOCATION_TYPES, visual);
}

/**
 * Where this location's pin gets its number, given what the property has said.
 *
 * Behaviour wins when set; otherwise the visual's default. The order matters: a property
 * that chose "count the wheels" for its cheese cave must keep counting wheels even though
 * the box is drawn as a chiller, and a defaulting rule that consulted the picture first
 * would quietly overrule them.
 */
export function resolveBehavior(
  visual: string | null | undefined,
  behavior: PlanDataBehavior | null | undefined,
): PlanDataBehavior {
  return behavior ?? locationType(visual).defaultBehavior;
}
