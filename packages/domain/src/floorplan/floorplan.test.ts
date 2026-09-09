import { describe, expect, it } from "vitest";

import {
  DEFAULT_PLAN_SIZE,
  LOCATION_TYPES,
  deriveVisual,
  isKnownVisual,
  layoutFloorPlan,
  locationType,
  planRole,
  resolveBehavior,
  resolveVisual,
  visualContradictsRegime,
  type LayoutLocationInput,
  type LayoutRoomInput,
  type LocationKind,
  type PlanSize,
} from "./index";

const footprintOf = (l: LayoutLocationInput) =>
  locationType(l.visual).footprint(l.size ?? DEFAULT_PLAN_SIZE);

const loc = (id: string, visual: string | null, size: PlanSize | null = null) => ({
  id,
  name: id,
  visual,
  size,
});

const room = (id: string, locations: LayoutLocationInput[]): LayoutRoomInput => ({
  id,
  name: id,
  locations,
});

describe("the type registry", () => {
  it("falls back to a plain store for a visual it has never heard of", () => {
    // The whole reason plan_visual_type is text and not an enum. A row written by a
    // newer client, or by a property that typed something of their own, must draw.
    expect(locationType("cheese_cave")).toBe(LOCATION_TYPES["store"]);
    expect(locationType(null)).toBe(LOCATION_TYPES["store"]);
    expect(locationType(undefined)).toBe(LOCATION_TYPES["store"]);
    expect(isKnownVisual("cheese_cave")).toBe(false);
  });

  it("does not mistake an inherited Object property for a visual", () => {
    // `LOCATION_TYPES["constructor"]` is truthy on a plain object literal, so a lookup
    // without an own-property check would report that "constructor" is a known visual
    // and then hand the renderer a function.
    expect(isKnownVisual("constructor")).toBe(false);
    expect(isKnownVisual("toString")).toBe(false);
    expect(locationType("constructor")).toBe(LOCATION_TYPES["store"]);
  });

  it("lets the property's chosen behaviour beat the visual's default", () => {
    // A cheese cave drawn as a chiller but counted rather than read. If the default won
    // here, that property would silently go back to temperature pins.
    expect(resolveBehavior("chiller", "COUNT")).toBe("COUNT");
    expect(resolveBehavior("chiller", null)).toBe("TEMPERATURE");
    expect(resolveBehavior("kegs", null)).toBe("RETURNABLE");
    expect(resolveBehavior("staging", null)).toBe("DWELL");
    // Unknown visual still yields a usable behaviour rather than undefined.
    expect(resolveBehavior("cheese_cave", null)).toBe("COUNT");
  });

  it("grows shelving runs lengthways and cold rooms squarely", () => {
    const dryS = LOCATION_TYPES["dry"]!.footprint("S");
    const dryL = LOCATION_TYPES["dry"]!.footprint("L");
    // A bigger dry store is another run of shelves along the same wall.
    expect(dryL.w).toBeGreaterThan(dryS.w);
    expect(dryL.d).toBe(dryS.d);

    const chillS = LOCATION_TYPES["chiller"]!.footprint("S");
    const chillL = LOCATION_TYPES["chiller"]!.footprint("L");
    expect(chillL.w).toBeGreaterThan(chillS.w);
    expect(chillL.d).toBe(chillS.d);
  });

  it("gives every built-in visual a positive footprint at every size", () => {
    const bad: string[] = [];
    for (const [key, entry] of Object.entries(LOCATION_TYPES)) {
      for (const size of ["S", "M", "L"] as const) {
        const fp = entry.footprint(size);
        if (!(fp.w > 0) || !(fp.d > 0)) bad.push(`${key}/${size}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("deriving a visual from the regime", () => {
  const KINDS: LocationKind[] = [
    "SECURITY",
    "RECEIVING",
    "REJECT",
    "ZONE",
    "RACK",
    "BIN",
    "DISPATCH",
    "DEPARTMENT",
  ];

  it("draws a zone from its regime, so a property that never opened setup still has a plan", () => {
    expect(deriveVisual("ZONE", "FROZEN")).toBe("freezer");
    expect(deriveVisual("ZONE", "CHILLED")).toBe("chiller");
    expect(deriveVisual("ZONE", "AMBIENT")).toBe("dry");
  });

  it("puts the shelf-level kinds off the map entirely", () => {
    // A property runs to a couple of hundred bins. Drawing them is not a busy map, it is
    // an unusable one.
    expect(planRole("BIN")).toBe("HIDDEN");
    expect(planRole("RACK")).toBe("HIDDEN");
    expect(planRole("DEPARTMENT")).toBe("HIDDEN");
  });

  it("answers for every kind in the schema without throwing", () => {
    const bad = KINDS.filter((k) => {
      try {
        return !deriveVisual(k, "AMBIENT") || !planRole(k);
      } catch {
        return true;
      }
    });
    expect(bad).toEqual([]);
  });

  it("never lets a stored visual be overruled by the regime", () => {
    // The setup screen warns about this; the renderer obeys it. A property that draws
    // its spice room as a chiller has reasons the regime does not capture.
    expect(resolveVisual("chiller", "ZONE", "AMBIENT")).toBe("chiller");
    expect(resolveVisual(null, "ZONE", "AMBIENT")).toBe("dry");
  });

  it("notices when the picture and the regime disagree, without refusing it", () => {
    expect(visualContradictsRegime("chiller", "ZONE", "AMBIENT")).toBe(true);
    expect(visualContradictsRegime("dry", "ZONE", "FROZEN")).toBe(true);
    expect(visualContradictsRegime("chiller", "ZONE", "CHILLED")).toBe(false);
    expect(visualContradictsRegime("freezer", "ZONE", "FROZEN")).toBe(false);
    // Nothing stored is not a disagreement — it is the ordinary state.
    expect(visualContradictsRegime(null, "ZONE", "AMBIENT")).toBe(false);
    // Scenery has no regime to disagree with.
    expect(visualContradictsRegime("gate", "SECURITY", "AMBIENT")).toBe(false);
  });
});

describe("laying the plan out", () => {
  it("puts a room's first location in the front lane and balances the rest", () => {
    const out = layoutFloorPlan(
      [room("r1", [loc("a", "chiller"), loc("b", "freezer"), loc("c", "dry")])],
      footprintOf,
    );
    const placed = out.rooms[0]!.locations;
    expect(placed.find((l) => l.id === "a")!.lane).toBe(0);
    expect(placed.find((l) => l.id === "b")!.lane).toBe(1);
    // Two 4.0-wide boxes, then the narrower dry store joins whichever lane is shorter.
    expect(placed.filter((l) => l.lane === 0)).toHaveLength(2);
  });

  it("does not move locations that were already placed when another is added", () => {
    // The reason the lane rule is greedy rather than optimal. A plan that re-shuffles
    // itself as a property types stops being a picture of their building.
    const existing = [loc("a", "chiller"), loc("b", "freezer"), loc("c", "dry")];
    const before = layoutFloorPlan([room("r1", existing)], footprintOf);
    const after = layoutFloorPlan(
      [room("r1", [...existing, loc("d", "kegs"), loc("e", "wine")])],
      footprintOf,
    );

    const moved: string[] = [];
    for (const was of before.rooms[0]!.locations) {
      const now = after.rooms[0]!.locations.find((l) => l.id === was.id)!;
      if (now.x !== was.x || now.y !== was.y || now.lane !== was.lane) moved.push(was.id);
    }
    expect(moved).toEqual([]);
  });

  it("never overlaps two locations sharing a lane", () => {
    const out = layoutFloorPlan(
      [
        room("r1", [loc("a", "chiller", "L"), loc("b", "dry", "S"), loc("c", "wine", "L")]),
        room("r2", [loc("d", "kegs", "M"), loc("e", "linen", "L"), loc("f", "store", "S")]),
      ],
      footprintOf,
    );

    const overlaps: string[] = [];
    for (const r of out.rooms) {
      for (const lane of [0, 1] as const) {
        const inLane = r.locations.filter((l) => l.lane === lane).sort((p, q) => p.x - q.x);
        for (let i = 1; i < inLane.length; i++) {
          const prev = inLane[i - 1]!;
          const next = inLane[i]!;
          if (next.x < prev.x + prev.w) overlaps.push(`${r.id}:${prev.id}->${next.id}`);
        }
      }
    }
    expect(overlaps).toEqual([]);
  });

  it("never overlaps two rooms, whatever they contain", () => {
    const out = layoutFloorPlan(
      [
        room("r1", [loc("a", "wine", "L")]),
        room("r2", []),
        room("r3", [loc("b", "dry", "S"), loc("c", "dry", "S"), loc("d", "dry", "S")]),
      ],
      footprintOf,
    );
    const gaps: string[] = [];
    for (let i = 1; i < out.rooms.length; i++) {
      const prev = out.rooms[i - 1]!;
      const next = out.rooms[i]!;
      if (next.x < prev.x + prev.w) gaps.push(`${prev.id}->${next.id}`);
    }
    expect(gaps).toEqual([]);
  });

  it("keeps an empty room wide enough to read as a room", () => {
    // A property adds "Beverage Cellar" and types nothing in it yet. A sliver would look
    // like a rendering fault at the exact moment they are deciding whether this works.
    const out = layoutFloorPlan([room("empty", [])], footprintOf);
    expect(out.rooms[0]!.w).toBeGreaterThan(4.6);
  });

  it("holds every location inside its own room's footprint", () => {
    const out = layoutFloorPlan(
      [room("r1", [loc("a", "chiller", "L"), loc("b", "wine", "L"), loc("c", "store", "L")])],
      footprintOf,
    );
    const r = out.rooms[0]!;
    const escaped = r.locations.filter((l) => l.x < r.x || l.x + l.w > r.x + r.w);
    expect(escaped).toEqual([]);
  });

  it("frames a lone small room without collapsing the building", () => {
    const out = layoutFloorPlan([room("r1", [loc("a", "dry", "S")])], footprintOf);
    expect(out.buildingWidth).toBeGreaterThanOrEqual(24);
    expect(out.buildingDepth).toBeGreaterThan(0);
  });

  it("lays out nothing at all without throwing", () => {
    const out = layoutFloorPlan([], footprintOf);
    expect(out.rooms).toEqual([]);
    expect(out.buildingWidth).toBeGreaterThanOrEqual(24);
  });
});
