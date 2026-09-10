import type { ReactElement } from "react";
import { Ellipse, Path, Polygon } from "react-native-svg";
import { SCENE, shade } from "../../theme-floor-plan";

/**
 * Isometric projection and the primitives everything in the scene is drawn from.
 *
 * Ported from the reference demo, which builds SVG by string concatenation. These return
 * React elements instead, so every one needs a `k` (key) — the single mechanical cost of
 * the port, and the reason each helper takes one as its first field.
 *
 * The projection is a 2:1-ish dimetric: x and y both run diagonally, z is straight up.
 * `S` is scene-units-to-pixels; nothing else in the renderer may convert between the two,
 * so changing the scale here changes it everywhere and cannot leave one shape behind.
 */

const CX = 0.866;
const CY = 0.5;
/** Scene units to SVG units. The demo's `S`. */
export const S = 26;

export type Pt = readonly [number, number];

export const iso = (x: number, y: number, z = 0): Pt => [
  (x - y) * CX * S,
  (x + y) * CY * S - z * S,
];

const pts = (a: readonly Pt[]) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
const n1 = (v: number) => v.toFixed(1);

export interface PolyProps {
  k: string;
  points: readonly Pt[];
  fill: string;
  stroke?: string | undefined;
  sw?: number;
  dash?: string | undefined;
  opacity?: number | undefined;
}

export function poly({
  k,
  points,
  fill,
  stroke,
  sw = 0.8,
  dash,
  opacity,
}: PolyProps): ReactElement {
  return (
    <Polygon
      key={k}
      points={pts(points)}
      fill={fill}
      {...(stroke ? { stroke, strokeWidth: sw, strokeLinejoin: "round" as const } : {})}
      {...(dash ? { strokeDasharray: dash } : {})}
      {...(opacity !== undefined ? { opacity } : {})}
    />
  );
}

export function line(
  k: string,
  a: Pt,
  b: Pt,
  stroke: string,
  sw = 1,
  extra?: { dash?: string; opacity?: number },
): ReactElement {
  return (
    <Path
      key={k}
      d={`M ${n1(a[0])} ${n1(a[1])} L ${n1(b[0])} ${n1(b[1])}`}
      fill="none"
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(extra?.dash ? { strokeDasharray: extra.dash } : {})}
      {...(extra?.opacity !== undefined ? { opacity: extra.opacity } : {})}
    />
  );
}

export function curve(
  k: string,
  d: string,
  stroke: string,
  sw = 1,
  extra?: { opacity?: number },
): ReactElement {
  return (
    <Path
      key={k}
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(extra?.opacity !== undefined ? { opacity: extra.opacity } : {})}
    />
  );
}

export function ellipse(
  k: string,
  c: Pt,
  rx: number,
  ry: number,
  fill: string,
  extra?: { stroke?: string; sw?: number; opacity?: number; filter?: string },
): ReactElement {
  return (
    <Ellipse
      key={k}
      cx={n1(c[0])}
      cy={n1(c[1])}
      rx={n1(rx)}
      ry={n1(ry)}
      fill={fill}
      {...(extra?.stroke ? { stroke: extra.stroke, strokeWidth: extra.sw ?? 0.8 } : {})}
      {...(extra?.opacity !== undefined ? { opacity: extra.opacity } : {})}
      {...(extra?.filter ? { filter: extra.filter } : {})}
    />
  );
}

export interface BoxProps {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  top: string;
  left?: string;
  right?: string;
  stroke?: string;
  z0?: number;
}

/**
 * A solid: the top face and the two faces you can see.
 *
 * The left and right faces default to shaded versions of the top, which is what turns a
 * flat fill into something that reads as a box. When `top` is a gradient reference the
 * shading cannot be computed, so the faces fall back to the gradient itself and the
 * caller is expected to pass its own `left` and `right` — the wine vault is the only
 * thing in the scene that does.
 */
export function box(k: string, p: BoxProps): ReactElement[] {
  const { x, y, w, d, h, top, z0 = 0 } = p;
  const grad = top.startsWith("url");
  const left = p.left ?? (grad ? top : shade(top, 0.93));
  const right = p.right ?? (grad ? top : shade(top, 0.84));
  const stroke = p.stroke ?? (grad ? SCENE.forest950 : shade(top, 0.78));

  const A = iso(x, y, z0 + h);
  const B = iso(x + w, y, z0 + h);
  const C = iso(x + w, y + d, z0 + h);
  const D = iso(x, y + d, z0 + h);
  const Cb = iso(x + w, y + d, z0);
  const Db = iso(x, y + d, z0);
  const Bb = iso(x + w, y, z0);

  return [
    poly({ k: `${k}t`, points: [A, B, C, D], fill: top, stroke }),
    poly({ k: `${k}l`, points: [D, C, Cb, Db], fill: left, stroke }),
    poly({ k: `${k}r`, points: [C, B, Bb, Cb], fill: right, stroke }),
  ];
}

/** A flat quad on the ground plane (or just above it). */
export function flat(
  k: string,
  x: number,
  y: number,
  w: number,
  d: number,
  fill: string,
  stroke?: string | undefined,
  sw = 0.8,
  z = 0.02,
  dash?: string | undefined,
): ReactElement {
  return poly({
    k,
    points: [iso(x, y, z), iso(x + w, y, z), iso(x + w, y + d, z), iso(x, y + d, z)],
    fill,
    stroke,
    sw,
    dash,
  });
}

/** The soft contact shadow under a solid. */
export function blob(
  k: string,
  x: number,
  y: number,
  w: number,
  d: number,
  z = 0.012,
  op = 1,
): ReactElement {
  return ellipse(
    k,
    iso(x + w / 2, y + d / 2, z),
    (w + d) * CX * S * 0.42,
    (w + d) * CY * S * 0.34,
    SCENE.shadow,
    {
      opacity: op,
      filter: "url(#soft)",
    },
  );
}
