/**
 * The isometric projection — scene units to drawing units.
 *
 * It lived in the renderer until the gesture engine needed it too: focus hulls, fly-to
 * frames and hit-testing are all questions about where a room lands on the drawing, and a
 * second copy of three constants is exactly how a tap ends up selecting the room next to
 * the one under the finger. One definition, here, and the renderer imports it.
 *
 * A 2:1-ish dimetric: x and y both run diagonally, z is straight up. Nothing else may
 * convert scene units to drawing units, so changing the scale here changes it everywhere.
 */

export const ISO_CX = 0.866;
export const ISO_CY = 0.5;
/** Scene units to drawing (SVG user) units. The demo's `S`. */
export const ISO_SCALE = 26;

export type Pt = readonly [number, number];

export function iso(x: number, y: number, z = 0): Pt {
  return [(x - y) * ISO_CX * ISO_SCALE, (x + y) * ISO_CY * ISO_SCALE - z * ISO_SCALE];
}
