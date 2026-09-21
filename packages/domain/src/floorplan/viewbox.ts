/**
 * The viewBox engine's arithmetic — pan, zoom, clamps, the level-of-detail ladder, focus,
 * and hit-testing. Ported from the reference demo's `zoomBy`, `fitBoxAspect`, `zoomToRoom`,
 * `focusHexPath`, `detailMode` and `updateOverlays`.
 *
 * Everything here is a pure function of its arguments, which is what lets it be tested
 * without a screen. The small ones carry a `"worklet"` directive: it is an inert string to
 * TypeScript and to the tests, and the marker Reanimated's compiler looks for so the same
 * function can run on the UI thread during a gesture. One implementation, tested once,
 * used in both places (CLAUDE.md 16).
 *
 * ## One deliberate generalisation of the demo
 *
 * The demo measures zoom against `BASE.w` and converts pixels with `rect.width / VB.w`.
 * Both assume the scene is width-limited in its container, which is true of the demo's
 * portrait stage and false of a landscape dashboard card — there the scene is
 * height-limited, letterboxed left and right, and a cursor-anchored zoom computed from the
 * width would drift away from the cursor.
 *
 * So the view box here always has the CONTAINER's aspect ratio (`fitToAspect`), which
 * makes the scale uniform and exact: drawing units per pixel is `w / viewportWidth` on
 * both axes. Every threshold the demo states against `BASE.w` is stated against the fitted
 * width instead — which is what the spec itself calls "fit width". In a width-limited
 * container the two are the same number, so the demo's behaviour is reproduced exactly
 * where the demo's assumption holds, and corrected where it does not.
 */

import { iso, type Pt } from "./projection";
import type { PlacedLocation, PlacedRoom } from "./layout";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Zoom limits, as multiples of the fitted width. Spec §3. */
export const ZOOM_MIN = 0.16;
export const ZOOM_MAX = 1.15;
/** Below this the plates give way to pins, and focus engages. Spec §5. */
export const DETAIL_BELOW = 0.6;
/** Below this the "Whole property" pill shows. Spec §5. */
export const BACK_PILL_BELOW = 0.92;
/** Fly-to duration in milliseconds; ease-in-out cubic. Spec §3. */
export const FLY_MS = 420;

/** One notch of the wheel, a double-tap, and the +/− buttons — the demo's factors. */
export const WHEEL_STEP = 1.18;
export const DOUBLE_TAP_FACTOR = 1 / 1.7;
export const BUTTON_STEP = 1.35;

/** A pin is kept alive this many PIXELS outside the viewport, so it does not pop at the edge. */
export const PIN_MARGIN_PX = 60;

/**
 * Grows a box, about its centre, until it has the given aspect ratio.
 *
 * The demo's `fitBoxAspect`, against the container rather than the scene. It only ever
 * grows: shrinking would crop the thing the caller asked to see.
 */
export function fitToAspect(b: Box, aspect: number): Box {
  "worklet";
  if (!(aspect > 0) || !(b.w > 0) || !(b.h > 0)) return b;
  if (b.w / b.h > aspect) {
    const nh = b.w / aspect;
    return { x: b.x, y: b.y - (nh - b.h) / 2, w: b.w, h: nh };
  }
  const nw = b.h * aspect;
  return { x: b.x - (nw - b.w) / 2, y: b.y, w: nw, h: b.h };
}

export function clampWidth(w: number, fitW: number): number {
  "worklet";
  return Math.max(fitW * ZOOM_MIN, Math.min(fitW * ZOOM_MAX, w));
}

/**
 * Zooms by `factor` (< 1 zooms in) keeping the point under the cursor where it is.
 *
 * `fx`/`fy` are the cursor's position as a fraction of the viewport. The clamp is applied
 * to the width BEFORE the anchor arithmetic, so hitting a limit stops the zoom cleanly
 * instead of sliding the view sideways against an invisible wall.
 */
export function zoomAt(vb: Box, factor: number, fx: number, fy: number, fitW: number): Box {
  "worklet";
  const px = vb.x + fx * vb.w;
  const py = vb.y + fy * vb.h;
  const nw = clampWidth(vb.w * factor, fitW);
  const k = nw / vb.w;
  return { x: px - (px - vb.x) * k, y: py - (py - vb.y) * k, w: nw, h: vb.h * k };
}

/** Drags the view by a pixel delta measured from where the drag began. */
export function panFrom(start: Box, dxPx: number, dyPx: number, viewportW: number): Box {
  "worklet";
  const unitsPerPx = start.w / viewportW;
  return { x: start.x - dxPx * unitsPerPx, y: start.y - dyPx * unitsPerPx, w: start.w, h: start.h };
}

export function isDetail(w: number, fitW: number): boolean {
  "worklet";
  return w < fitW * DETAIL_BELOW;
}

export function showsBackPill(w: number, fitW: number): boolean {
  "worklet";
  return w < fitW * BACK_PILL_BELOW;
}

/**
 * Where a drawing-space anchor lands on screen, in pixels.
 *
 * This is the whole of the rule that a label never scales with the world: overlays are
 * positioned by this and sized by nothing. Exact because the view box is aspect-locked to
 * the viewport, so one scale serves both axes.
 */
export function projectToScreen(ax: number, ay: number, vb: Box, viewportW: number): Pt {
  "worklet";
  const pxPerUnit = viewportW / vb.w;
  return [(ax - vb.x) * pxPerUnit, (ay - vb.y) * pxPerUnit];
}

/** The inverse: a screen pixel back to drawing space. Used by taps. */
export function screenToWorld(px: number, py: number, vb: Box, viewportW: number): Pt {
  "worklet";
  const unitsPerPx = vb.w / viewportW;
  return [vb.x + px * unitsPerPx, vb.y + py * unitsPerPx];
}

/** Whether an anchor is inside the view, with the pin margin converted from pixels. */
export function anchorInView(ax: number, ay: number, vb: Box, viewportW: number): boolean {
  "worklet";
  const m = (PIN_MARGIN_PX * vb.w) / viewportW;
  return ax > vb.x - m && ax < vb.x + vb.w + m && ay > vb.y - m && ay < vb.y + vb.h + m;
}

/**
 * Index of the room whose centre is nearest the middle of the view, or -1 with no rooms.
 *
 * `centres` is a flat [x0, y0, x1, y1, …] array rather than objects, so it can be captured
 * by a worklet as plain numbers and compared on every frame of a pan without allocating.
 */
export function nearestRoomIndex(centres: readonly number[], vb: Box): number {
  "worklet";
  const cx = vb.x + vb.w / 2;
  const cy = vb.y + vb.h / 2;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i + 1 < centres.length; i += 2) {
    const dx = centres[i]! - cx;
    const dy = centres[i + 1]! - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) {
      bestD = d2;
      best = i / 2;
    }
  }
  return best;
}

/** The point focus measures to: the room's centre, lifted to mid-height. The demo's `rc`. */
export function roomFocusCentre(r: PlacedRoom): Pt {
  return iso(r.x + r.w / 2, r.y + r.d / 2, 1.5);
}

/** Where a room's name plate is anchored: the corridor in front of it, never over its contents. */
export function plateAnchor(r: PlacedRoom): Pt {
  return iso(r.x + r.w / 2, r.y + r.d + 1.15, 0);
}

/** The frame a fly-to lands on. The demo's `zoomToRoom` box, before aspect fitting. */
export function roomFlyBox(r: PlacedRoom): Box {
  const cs = [
    iso(r.x, r.y, 0),
    iso(r.x + r.w, r.y, 0),
    iso(r.x + r.w, r.y + r.d, 0),
    iso(r.x, r.y + r.d, 0),
    iso(r.x + r.w / 2, r.y, 4.5),
    iso(r.x + r.w / 2, r.y + r.d, 0),
  ];
  const xs = cs.map((c) => c[0]);
  const ys = cs.map((c) => c[1]);
  const pad = 30;
  // More room above than below: the pins stand over the locations and need the headroom.
  const padTop = 68;
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX - pad,
    y: minY - padTop,
    w: Math.max(...xs) - minX + pad * 2,
    h: Math.max(...ys) - minY + padTop + pad,
  };
}

/**
 * The six-point silhouette of a room's box, as seen — the hole in the focus dim.
 *
 * Padded 0.7 units and 4.3 high, per spec §5. An isometric box's outline is a hexagon:
 * two top corners, the right edge down, the two front floor corners, the left edge up.
 */
export function focusHex(r: PlacedRoom): Pt[] {
  const p = 0.7;
  const H = 4.3;
  return [
    iso(r.x - p, r.y - p, H),
    iso(r.x + r.w + p, r.y - p, H),
    iso(r.x + r.w + p, r.y - p, 0),
    iso(r.x + r.w + p, r.y + r.d + p, 0),
    iso(r.x - p, r.y + r.d + p, 0),
    iso(r.x - p, r.y + r.d + p, H),
  ];
}

/**
 * The dim as one even-odd path: everything, minus the focused room's silhouette.
 *
 * The outer rectangle is the scene frame grown by a wide margin rather than the current
 * view, so panning with focus on never reveals an undimmed edge.
 */
export function focusDimPath(r: PlacedRoom, base: Box): string {
  const m = 4000;
  const o = { x: base.x - m, y: base.y - m, w: base.w + m * 2, h: base.h + m * 2 };
  const hex = focusHex(r)
    .map((c) => `${c[0].toFixed(1)} ${c[1].toFixed(1)}`)
    .join(" L ");
  return (
    `M ${o.x} ${o.y} L ${o.x + o.w} ${o.y} L ${o.x + o.w} ${o.y + o.h} L ${o.x} ${o.y + o.h} Z ` +
    `M ${hex} Z`
  );
}

export function pointInPolygon(pt: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const crosses = a[1] > pt[1] !== b[1] > pt[1];
    if (crosses && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

/** The outline of a footprint raised to `height`, as drawn — a location's tappable shape. */
export function boxHull(
  x: number,
  y: number,
  w: number,
  d: number,
  z0: number,
  height: number,
): Pt[] {
  const top = z0 + height;
  return [
    iso(x, y, top),
    iso(x + w, y, top),
    iso(x + w, y, z0),
    iso(x + w, y + d, z0),
    iso(x, y + d, z0),
    iso(x, y + d, top),
  ];
}

export type Hit =
  | { kind: "location"; locationId: string; roomId: string }
  | { kind: "room"; roomId: string }
  | null;

/**
 * What is under a point in drawing space.
 *
 * Locations before rooms, and later-drawn locations before earlier ones, because that is
 * the order they occlude each other in: the thing you can see is the thing you tapped.
 * Done with arithmetic rather than per-shape press handlers so that one code path serves
 * a mouse, a finger and both platforms, and so a drag can never be mistaken for a press.
 */
export function hitTest(
  rooms: readonly PlacedRoom[],
  pt: Pt,
  heightOf: (l: PlacedLocation) => number,
  floorZ: number,
): Hit {
  for (let ri = rooms.length - 1; ri >= 0; ri--) {
    const r = rooms[ri]!;
    for (let li = r.locations.length - 1; li >= 0; li--) {
      const l = r.locations[li]!;
      if (pointInPolygon(pt, boxHull(l.x, l.y, l.w, l.d, floorZ, heightOf(l)))) {
        return { kind: "location", locationId: l.id, roomId: r.id };
      }
    }
  }
  for (let ri = rooms.length - 1; ri >= 0; ri--) {
    const r = rooms[ri]!;
    const floor: Pt[] = [
      iso(r.x, r.y, floorZ),
      iso(r.x + r.w, r.y, floorZ),
      iso(r.x + r.w, r.y + r.d, floorZ),
      iso(r.x, r.y + r.d, floorZ),
    ];
    if (pointInPolygon(pt, floor)) return { kind: "room", roomId: r.id };
  }
  return null;
}

/**
 * Carries a view across a change of frame — a resized container, a room added.
 *
 * The demo's `render(preserve)`: the view is remembered relative to the old frame and
 * restored relative to the new one, so typing a room's name while zoomed into it does not
 * throw the user back out to the overview on every keystroke.
 */
export function carryView(vb: Box, fromFit: Box, toFit: Box): Box {
  if (!(fromFit.w > 0) || !(fromFit.h > 0)) return toFit;
  const relW = vb.w / fromFit.w;
  const w = clampWidth(relW * toFit.w, toFit.w);
  return {
    x: toFit.x + ((vb.x - fromFit.x) / fromFit.w) * toFit.w,
    y: toFit.y + ((vb.y - fromFit.y) / fromFit.h) * toFit.h,
    w,
    h: (w * toFit.h) / toFit.w,
  };
}
