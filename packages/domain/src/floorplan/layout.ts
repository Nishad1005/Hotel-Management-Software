/**
 * Auto-layout — where every room and location sits, derived, never stored.
 *
 * Ported from `layoutAll()` in the reference demo (docs/ui-redesign/living-floor-plan/
 * living-floor-plan-demo-v7.html). The arithmetic is the demo's; the names and the
 * reasons are added here.
 *
 * **No coordinate this file produces may ever be written to the database** (ADR 0017).
 * That is the point of computing it: a property adds a room and the plan re-assembles,
 * with no migration and nobody re-drawing anything. The moment a position is persisted,
 * adding a room becomes an editing job.
 *
 * This module knows nothing about hotels, or about what a "chiller" is. It is handed a
 * function that turns a location into a rectangle and it packs rectangles — which is why
 * a factory's racks or a parts counter reuse it without a line changing.
 */

import type { Footprint, PlanSize } from "./registry";

/** How the caller's location looks to the packer. Anything else it carries is ignored. */
export interface LayoutLocationInput {
  id: string;
  name: string;
  /** Free-form; only meaningful to the footprint resolver the caller supplies. */
  visual: string | null;
  size: PlanSize | null;
}

export interface LayoutRoomInput {
  id: string;
  name: string;
  locations: LayoutLocationInput[];
}

export interface PlacedLocation extends LayoutLocationInput {
  roomId: string;
  /** Along the corridor, in scene units, from the building's origin. */
  x: number;
  /** Into the building. */
  y: number;
  w: number;
  d: number;
  /** 0 = front lane, 1 = back lane. Kept because draw order depends on it. */
  lane: 0 | 1;
}

export interface PlacedRoom {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  locations: PlacedLocation[];
}

export interface Layout {
  rooms: PlacedRoom[];
  /** Building extents, so a caller can frame the whole thing without measuring. */
  buildingWidth: number;
  buildingDepth: number;
}

/** Scene-unit constants, all from the demo. Named so a later change is a decision. */
const FIRST_ROOM_X = 1.4;
const ROOM_Y = 0.9;
const ROOM_DEPTH = 10.4;
/** Clear space between two locations in the same lane. */
const LANE_GAP = 0.9;
/** Inset from the room's edge to its contents. */
const ROOM_PADDING = 0.8;
/** Front lane to back lane. */
const LANE_PITCH = 5.2;
/** Added to the widest lane to get the room's own width. */
const ROOM_MARGIN = 1.6;
/** Clear space between two rooms. */
const ROOM_GAP = 1.0;
/** A room narrower than this looks like a mistake rather than a small room. */
const MIN_LANE_EXTENT = 4.6;
/** Grounds beyond the last room. */
const BUILDING_MARGIN = 6.4;
const MIN_BUILDING_WIDTH = 24;
const BUILDING_DEPTH = 15.4;

export type FootprintResolver = (location: LayoutLocationInput) => Footprint;

/**
 * Packs rooms left to right as bays off a shared corridor, and locations into two lanes
 * within each room.
 *
 * Each location goes into whichever lane is currently shorter. That is a greedy rule and
 * it is not optimal — it can leave one lane longer than a perfect packing would — but it
 * is *stable*, which matters more here: adding a location must not re-shuffle the ones
 * already placed, or the plan would rearrange itself under a property mid-setup and stop
 * being a picture of their building.
 */
export function layoutFloorPlan(
  rooms: readonly LayoutRoomInput[],
  footprintOf: FootprintResolver,
): Layout {
  const placed: PlacedRoom[] = [];
  let x = FIRST_ROOM_X;

  for (const room of rooms) {
    const lanes: PlacedLocation[][] = [[], []];
    // How far along each lane is filled so far.
    const filled: [number, number] = [0, 0];

    for (const location of room.locations) {
      const fp = footprintOf(location);
      // Ties go to the front lane, so a room's first location is always visible rather
      // than tucked behind another.
      const lane: 0 | 1 = filled[0] <= filled[1] ? 0 : 1;
      lanes[lane]!.push({
        ...location,
        roomId: room.id,
        lane,
        w: fp.w,
        d: fp.d,
        x: x + ROOM_PADDING + filled[lane],
        y: ROOM_Y + ROOM_PADDING + lane * LANE_PITCH,
      });
      filled[lane] += fp.w + LANE_GAP;
    }

    // The trailing gap after the last location in a lane is not part of the room.
    const widestLane = Math.max(filled[0], filled[1], MIN_LANE_EXTENT) - LANE_GAP;
    const innerWidth = widestLane + ROOM_MARGIN;
    const roomWidth = innerWidth + ROOM_MARGIN;

    placed.push({
      id: room.id,
      name: room.name,
      x,
      y: ROOM_Y,
      w: roomWidth,
      d: ROOM_DEPTH,
      // Front lane first, so a painter's-algorithm renderer draws back to front correctly
      // by reversing rather than by sorting.
      locations: [...lanes[0]!, ...lanes[1]!],
    });

    x += innerWidth + ROOM_MARGIN + ROOM_GAP;
  }

  return {
    rooms: placed,
    buildingWidth: Math.max(x + BUILDING_MARGIN, MIN_BUILDING_WIDTH),
    buildingDepth: BUILDING_DEPTH,
  };
}

/** v1 caps, enforced in the setup UI. Not database constraints — see ADR 0017. */
export const MAX_ROOMS = 4;
export const MAX_LOCATIONS = 10;
