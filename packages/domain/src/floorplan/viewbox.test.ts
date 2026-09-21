import { describe, expect, it } from "vitest";

import {
  BACK_PILL_BELOW,
  DETAIL_BELOW,
  ZOOM_MAX,
  ZOOM_MIN,
  anchorInView,
  carryView,
  fitToAspect,
  focusDimPath,
  focusHex,
  hitTest,
  isDetail,
  iso,
  layoutFloorPlan,
  locationType,
  nearestRoomIndex,
  panFrom,
  plateAnchor,
  pointInPolygon,
  projectToScreen,
  roomFlyBox,
  roomFocusCentre,
  screenToWorld,
  showsBackPill,
  zoomAt,
  type Box,
  type LayoutLocationInput,
} from "./index";

const FLOOR_Z = 0.35;
const footprintOf = (l: LayoutLocationInput) => locationType(l.visual).footprint(l.size ?? "M");
const heightOf = (l: LayoutLocationInput) => locationType(l.visual).pinZ;

const loc = (id: string, visual: string) => ({ id, name: id, visual, size: null });
const layout = layoutFloorPlan(
  [
    {
      id: "kitchen",
      name: "Main Kitchen Store",
      locations: [loc("chill", "chiller"), loc("dry", "dry")],
    },
    { id: "cellar", name: "Beverage Cellar", locations: [loc("wine", "wine")] },
  ],
  footprintOf,
);
const [kitchen, cellar] = layout.rooms as [(typeof layout.rooms)[0], (typeof layout.rooms)[0]];

const FIT: Box = { x: -1000, y: -400, w: 2000, h: 1000 };
const W = 1000; // viewport width in pixels; aspect 2:1 matches FIT

describe("fitting a frame to the container", () => {
  it("grows the short side about the centre and never shrinks the other", () => {
    const wide = fitToAspect({ x: 0, y: 0, w: 100, h: 100 }, 2);
    expect(wide).toEqual({ x: -50, y: 0, w: 200, h: 100 });
    const tall = fitToAspect({ x: 0, y: 0, w: 100, h: 100 }, 0.5);
    expect(tall).toEqual({ x: 0, y: -50, w: 100, h: 200 });
  });

  it("leaves a degenerate box alone instead of producing NaN", () => {
    // A container measured at zero height on first layout is ordinary, not exceptional.
    const b = { x: 1, y: 2, w: 100, h: 50 };
    expect(fitToAspect(b, 0)).toBe(b);
    expect(fitToAspect(b, Number.NaN)).toBe(b);
  });
});

describe("zooming", () => {
  it("keeps the point under the cursor exactly where it was", () => {
    // The definition of cursor-anchored zoom, and the thing the demo's width-only pixel
    // conversion gets wrong in a height-limited container.
    const fx = 0.3;
    const fy = 0.8;
    const before = [FIT.x + fx * FIT.w, FIT.y + fy * FIT.h];
    const vb = zoomAt(FIT, 0.5, fx, fy, FIT.w);
    const after = [vb.x + fx * vb.w, vb.y + fy * vb.h];
    expect(after[0]).toBeCloseTo(before[0]!, 9);
    expect(after[1]).toBeCloseTo(before[1]!, 9);
    expect(vb.w).toBe(1000);
  });

  it("preserves the aspect ratio, which is what keeps the pixel scale uniform", () => {
    const vb = zoomAt(FIT, 0.37, 0.1, 0.9, FIT.w);
    expect(vb.w / vb.h).toBeCloseTo(FIT.w / FIT.h, 9);
  });

  it("stops at both limits without sliding the view", () => {
    const inMax = zoomAt(FIT, 0.0001, 0.5, 0.5, FIT.w);
    expect(inMax.w).toBeCloseTo(FIT.w * ZOOM_MIN, 9);
    const outMax = zoomAt(FIT, 1000, 0.5, 0.5, FIT.w);
    expect(outMax.w).toBeCloseTo(FIT.w * ZOOM_MAX, 9);
    // Pressing against a limit is a no-op, not a drift.
    const again = zoomAt(inMax, 0.5, 0.2, 0.2, FIT.w);
    expect(again).toEqual(inMax);
  });
});

describe("panning", () => {
  it("moves the world with the finger, scaled by the current zoom", () => {
    const zoomed = zoomAt(FIT, 0.5, 0.5, 0.5, FIT.w); // 1 drawing unit per pixel
    const moved = panFrom(zoomed, 100, -40, W);
    expect(moved.x).toBeCloseTo(zoomed.x - 100, 9);
    expect(moved.y).toBeCloseTo(zoomed.y + 40, 9);
    expect(moved.w).toBe(zoomed.w);
  });
});

describe("the level-of-detail ladder", () => {
  it("switches at the spec's thresholds and not before", () => {
    expect(isDetail(FIT.w * DETAIL_BELOW, FIT.w)).toBe(false);
    expect(isDetail(FIT.w * DETAIL_BELOW - 0.001, FIT.w)).toBe(true);
    expect(showsBackPill(FIT.w * BACK_PILL_BELOW, FIT.w)).toBe(false);
    expect(showsBackPill(FIT.w * BACK_PILL_BELOW - 0.001, FIT.w)).toBe(true);
    expect(isDetail(FIT.w, FIT.w)).toBe(false);
  });

  it("keeps a pin alive a fixed number of PIXELS past the edge, at any zoom", () => {
    // 60px is 120 units at overview and 30 units zoomed 4x — the margin is in screen
    // space, like everything else about an overlay.
    expect(anchorInView(FIT.x - 100, 0, FIT, W)).toBe(true);
    expect(anchorInView(FIT.x - 130, 0, FIT, W)).toBe(false);
    const close: Box = { x: 0, y: 0, w: 500, h: 250 };
    expect(anchorInView(-25, 10, close, W)).toBe(true);
    expect(anchorInView(-35, 10, close, W)).toBe(false);
  });
});

describe("overlays live in screen space", () => {
  it("round-trips a point between the drawing and the screen", () => {
    const vb = zoomAt(FIT, 0.41, 0.63, 0.27, FIT.w);
    const [sx, sy] = projectToScreen(123.4, -56.7, vb, W);
    const [wx, wy] = screenToWorld(sx, sy, vb, W);
    expect(wx).toBeCloseTo(123.4, 9);
    expect(wy).toBeCloseTo(-56.7, 9);
  });

  it("moves an anchor on screen as the zoom changes — and that is ALL that changes", () => {
    // The projection returns a position and nothing else. There is no scale in its
    // output for a label to inherit, which is the mechanical form of spec §3.
    const a = projectToScreen(0, 0, FIT, W);
    const b = projectToScreen(0, 0, zoomAt(FIT, 0.5, 0, 0, FIT.w), W);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(b[0]).not.toBeCloseTo(a[0], 3);
  });

  it("anchors a plate in the corridor in front of its room, never over the contents", () => {
    const [, ay] = plateAnchor(kitchen);
    const frontEdgeY = iso(kitchen.x + kitchen.w / 2, kitchen.y + kitchen.d, 0)[1];
    expect(ay).toBeGreaterThan(frontEdgeY);
  });
});

describe("focus", () => {
  const centres = layout.rooms.flatMap((r) => [...roomFocusCentre(r)]);

  it("goes to the room nearest the middle of the view", () => {
    const onKitchen = fitToAspect(roomFlyBox(kitchen), 2);
    const onCellar = fitToAspect(roomFlyBox(cellar), 2);
    expect(nearestRoomIndex(centres, onKitchen)).toBe(0);
    expect(nearestRoomIndex(centres, onCellar)).toBe(1);
  });

  it("answers -1 for a property with no rooms rather than inventing one", () => {
    expect(nearestRoomIndex([], FIT)).toBe(-1);
  });

  it("flies to a frame that contains the whole room, with headroom for its pins", () => {
    const box = roomFlyBox(kitchen);
    const corners = [
      iso(kitchen.x, kitchen.y, 0),
      iso(kitchen.x + kitchen.w, kitchen.y + kitchen.d, 0),
      iso(kitchen.x + kitchen.w / 2, kitchen.y, 4.5),
    ];
    const outside = corners.filter(
      (c) => c[0] < box.x || c[0] > box.x + box.w || c[1] < box.y || c[1] > box.y + box.h,
    );
    expect(outside).toEqual([]);
  });

  it("cuts a six-sided hole that contains the room's floor and not its neighbour's", () => {
    const hex = focusHex(kitchen);
    expect(hex).toHaveLength(6);
    expect(pointInPolygon(iso(kitchen.x + kitchen.w / 2, kitchen.y + kitchen.d / 2, 0), hex)).toBe(
      true,
    );
    expect(pointInPolygon(iso(cellar.x + cellar.w / 2, cellar.y + cellar.d / 2, 0), hex)).toBe(
      false,
    );
  });

  it("draws the dim as two subpaths, so even-odd leaves the room lit", () => {
    const d = focusDimPath(kitchen, { x: -500, y: -300, w: 2000, h: 1100 });
    expect(d.match(/M /g)).toHaveLength(2);
    expect(d.match(/Z/g)).toHaveLength(2);
  });
});

describe("what a tap lands on", () => {
  const chill = kitchen.locations.find((l) => l.id === "chill")!;

  it("finds the location under the point, and names its room", () => {
    const onTop = iso(chill.x + chill.w / 2, chill.y + chill.d / 2, FLOOR_Z + 2);
    expect(hitTest(layout.rooms, onTop, heightOf, FLOOR_Z)).toEqual({
      kind: "location",
      locationId: "chill",
      roomId: "kitchen",
    });
  });

  it("falls through to the room's floor where nothing stands", () => {
    // Front of the room, by the doorway — floor, with no location near it.
    const bare = iso(kitchen.x + kitchen.w - 0.6, kitchen.y + kitchen.d - 0.5, FLOOR_Z);
    expect(hitTest(layout.rooms, bare, heightOf, FLOOR_Z)).toEqual({
      kind: "room",
      roomId: "kitchen",
    });
  });

  it("answers null out on the grounds", () => {
    expect(hitTest(layout.rooms, iso(-12, 10, 0), heightOf, FLOOR_Z)).toBeNull();
  });
});

describe("carrying the view across a change of frame", () => {
  it("keeps the overview an overview when the container is resized", () => {
    const next: Box = { x: -1200, y: -500, w: 2400, h: 1200 };
    expect(carryView(FIT, FIT, next)).toEqual(next);
  });

  it("keeps a zoomed view zoomed, so typing a room name does not throw the user out", () => {
    const zoomed = zoomAt(FIT, 0.3, 0.4, 0.6, FIT.w);
    const next: Box = { x: FIT.x - 50, y: FIT.y, w: FIT.w + 100, h: (FIT.w + 100) / 2 };
    const carried = carryView(zoomed, FIT, next);
    expect(carried.w / next.w).toBeCloseTo(zoomed.w / FIT.w, 9);
    expect(carried.w / carried.h).toBeCloseTo(next.w / next.h, 9);
  });
});
