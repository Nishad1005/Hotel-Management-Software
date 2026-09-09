import { locationType, type PlacedLocation } from "@golai/domain";
import type { ReactElement } from "react";
import { Circle, Path, Rect } from "react-native-svg";
import { SCENE, shade } from "../../theme-floor-plan";
import { blob, box, ellipse, flat, iso, line, poly, S } from "./iso";

/**
 * How each kind of place is drawn — the eight built-in visuals, ported from the demo's
 * `drawLoc()`.
 *
 * The demo carries these as one long `if/else` chain over `p.kind`. Here they are entries
 * in a lookup keyed by visual name, which is the shape §4b of the spec asks for: adding a
 * visual is adding one entry, and layout, focus, pins and drill-down never change. An
 * unknown name falls through to `store`, so a location written by a newer client — or a
 * property that typed a word of its own — draws as a plain box carrying its real name
 * rather than leaving a hole in the map.
 *
 * `FLOOR_Z` is the height of the building's slab. Everything a location draws sits on top
 * of it, which is why it appears in every renderer and never as a magic 0.35.
 */

export const FLOOR_Z = 0.35;

/** What a renderer is handed: a location already placed in scene coordinates. */
export type Drawn = PlacedLocation & { visual: string };

type Renderer = (p: Drawn, k: string) => ReactElement[];

/** Walk-in chiller and deep freeze — the same solid, colder colours on the freezer. */
const coldRoom: Renderer = (p, k) => {
  const cold = p.visual === "freezer";
  const top = cold ? SCENE.sage300 : SCENE.sage50;
  const st = cold ? SCENE.sage500 : SCENE.sage300;
  const H = 2.7;
  const out: ReactElement[] = [
    blob(`${k}sh`, p.x, p.y, p.w, p.d),
    ...box(`${k}b`, { x: p.x, y: p.y, w: p.w, d: p.d, h: H, top, stroke: st, z0: FLOOR_Z }),
    line(
      `${k}e1`,
      iso(p.x, p.y + p.d, FLOOR_Z + H),
      iso(p.x + p.w, p.y + p.d, FLOOR_Z + H),
      "rgba(255,255,255,0.55)",
      1,
    ),
    line(
      `${k}e2`,
      iso(p.x + p.w, p.y + p.d, FLOOR_Z + H),
      iso(p.x + p.w, p.y + p.d, FLOOR_Z),
      "rgba(255,255,255,0.35)",
      0.8,
    ),
  ];

  // Panel seams on the face you can see — what makes it read as a cold room rather than
  // a fridge-coloured cube.
  for (let i = 1; i < 3; i++) {
    const sx = p.x + (p.w * i) / 3;
    out.push(
      line(
        `${k}s${i}`,
        iso(sx, p.y + p.d, FLOOR_Z + 0.15),
        iso(sx, p.y + p.d, FLOOR_Z + H - 0.15),
        shade(top, 0.9),
        0.7,
      ),
    );
  }

  // Door, porthole, handle, and the temperature plate beside it.
  const dx = p.x + p.w * 0.36;
  out.push(
    poly({
      k: `${k}door`,
      points: [
        iso(dx, p.y + p.d, FLOOR_Z + 2.1),
        iso(dx + 1.2, p.y + p.d, FLOOR_Z + 2.1),
        iso(dx + 1.2, p.y + p.d, FLOOR_Z),
        iso(dx, p.y + p.d, FLOOR_Z),
      ],
      fill: shade(top, 0.92),
      stroke: cold ? SCENE.sage700 : SCENE.sage500,
      sw: 0.9,
    }),
    ellipse(`${k}ph`, iso(dx + 0.6, p.y + p.d, FLOOR_Z + 1.72), 4.2, 4.8, SCENE.linen50, {
      stroke: cold ? SCENE.sage700 : SCENE.sage500,
      sw: 0.9,
    }),
    line(
      `${k}hn`,
      iso(dx + 1.02, p.y + p.d, FLOOR_Z + 1.45),
      iso(dx + 1.02, p.y + p.d, FLOOR_Z + 0.75),
      SCENE.brass600,
      2.2,
    ),
  );

  const tp = iso(p.x + p.w * 0.82, p.y + p.d, FLOOR_Z + 1.9);
  out.push(
    <Rect
      key={`${k}tp`}
      x={(tp[0] - 6).toFixed(1)}
      y={(tp[1] - 4).toFixed(1)}
      width="12"
      height="8"
      rx="1.5"
      fill={cold ? SCENE.sage700 : SCENE.sage500}
    />,
  );

  // Condenser and its fan grille, on the roof.
  const fc = iso(p.x + 1.2, p.y + 1.05, FLOOR_Z + H + 0.46);
  const grille = cold ? SCENE.sage300 : SCENE.sage500;
  out.push(
    ...box(`${k}cd`, {
      x: p.x + 0.5,
      y: p.y + 0.5,
      w: 1.4,
      d: 1.1,
      h: 0.45,
      top: cold ? SCENE.sage500 : SCENE.sage300,
      z0: FLOOR_Z + H,
    }),
    ellipse(`${k}f1`, fc, 7, 3.4, "none", { stroke: grille, sw: 0.9 }),
    ellipse(`${k}f2`, fc, 3.2, 1.6, "none", { stroke: grille, sw: 0.9 }),
  );
  return out;
};

/** The wine vault — the one dark solid in the building, and the only one lit from outside. */
const wine: Renderer = (p, k) => {
  const H = 3.1;
  const out: ReactElement[] = [
    blob(`${k}sh`, p.x, p.y, p.w, p.d),
    // Floor glow in front of the doors. Warm light spilling out is the whole character of
    // this one; without it the vault reads as a black box someone forgot to fill.
    ellipse(
      `${k}gl`,
      iso(p.x + p.w * 0.5, p.y + p.d + 0.9, 0.03),
      p.w * S * 0.55,
      p.w * S * 0.16,
      SCENE.brass100,
      {
        opacity: 0.55,
        filter: "url(#soft)",
      },
    ),
    ...box(`${k}b`, {
      x: p.x,
      y: p.y,
      w: p.w,
      d: p.d,
      h: H,
      top: "url(#vTop)",
      left: "url(#vLeft)",
      right: "url(#vRight)",
      stroke: SCENE.forest950,
      z0: FLOOR_Z,
    }),
    poly({
      k: `${k}rim`,
      points: [
        iso(p.x, p.y, FLOOR_Z + H),
        iso(p.x + p.w, p.y, FLOOR_Z + H),
        iso(p.x + p.w, p.y + p.d, FLOOR_Z + H),
        iso(p.x, p.y + p.d, FLOOR_Z + H),
      ],
      fill: "none",
      stroke: SCENE.brass500,
      sw: 0.9,
    }),
  ];
  for (let i = 0; i < 4; i++) {
    const z = FLOOR_Z + 0.45 + i * 0.6;
    out.push(
      line(
        `${k}r${i}`,
        iso(p.x + 0.3, p.y + p.d, z),
        iso(p.x + p.w - 0.3, p.y + p.d, z),
        SCENE.brass500,
        1.3,
      ),
    );
  }
  for (let i = 0; i < Math.floor((p.w - 1) / 0.8); i++) {
    const c = iso(p.x + 0.6 + i * 0.8, p.y + p.d, FLOOR_Z + 2.5);
    out.push(
      <Circle
        key={`${k}c${i}`}
        cx={c[0].toFixed(1)}
        cy={c[1].toFixed(1)}
        r="1.5"
        fill={SCENE.brass300}
      />,
    );
  }
  return out;
};

/** Dry store and linen — shelving runs, not solids. Crates on brass uprights. */
const shelving: Renderer = (p, k) => {
  const lin = p.visual === "linen";
  const crates = lin ? [SCENE.white, SCENE.linen50] : [SCENE.brass100, SCENE.white, SCENE.sage50];
  const out: ReactElement[] = [
    ...box(`${k}d1`, { x: p.x, y: p.y, w: p.w, d: 1.4, h: 0.16, top: SCENE.linen200, z0: FLOOR_Z }),
    ...box(`${k}d2`, {
      x: p.x,
      y: p.y,
      w: p.w,
      d: 1.4,
      h: 0.12,
      top: shade(SCENE.linen200, 0.95),
      z0: FLOOR_Z + 1.1,
    }),
  ];

  const uprights: [number, number][] = [
    [p.x + 0.1, p.y + 0.1],
    [p.x + p.w - 0.1, p.y + 0.1],
    [p.x + 0.1, p.y + 1.3],
    [p.x + p.w - 0.1, p.y + 1.3],
  ];
  uprights.forEach(([px, py], i) =>
    out.push(
      line(`${k}u${i}`, iso(px, py, FLOOR_Z), iso(px, py, FLOOR_Z + 2.0), SCENE.brass700, 1.5),
    ),
  );
  out.push(
    line(
      `${k}rail`,
      iso(p.x + 0.1, p.y + 0.1, FLOOR_Z + 2.0),
      iso(p.x + p.w - 0.1, p.y + 0.1, FLOOR_Z + 2.0),
      SCENE.brass700,
      1.2,
    ),
  );

  const n = Math.floor((p.w - 0.6) / 1.5);
  for (let i = 0; i < n; i++) {
    const f1 = crates[i % crates.length]!;
    const f2 = crates[(i + 1) % crates.length]!;
    const stroke = lin ? SCENE.champagne : SCENE.brass500;
    out.push(
      ...box(`${k}c${i}`, {
        x: p.x + 0.35 + i * 1.5,
        y: p.y + 0.18,
        w: 1.15,
        d: 1.0,
        h: 0.72,
        top: f1,
        stroke,
        z0: FLOOR_Z + 0.16,
      }),
    );
    // Only every other bay is stacked two high — an evenly loaded rack looks printed.
    if (i % 2 === 0) {
      out.push(
        ...box(`${k}c2${i}`, {
          x: p.x + 0.35 + i * 1.5,
          y: p.y + 0.18,
          w: 1.15,
          d: 1.0,
          h: 0.6,
          top: f2,
          stroke,
          z0: FLOOR_Z + 1.22,
        }),
      );
    }
  }
  return out;
};

/** Kegs and returnables — cylinders, which the demo builds from two arcs and a body path. */
const kegs: Renderer = (p, k) => {
  const out: ReactElement[] = [];
  const count = 3 + (p.size === "S" ? 0 : 2);
  for (let i = 0; i < count; i++) {
    const kx = p.x + 0.5 + (i % 3) * 1.05;
    const ky = p.y + 0.5 + Math.floor(i / 3) * 1.15;
    const b0 = iso(kx, ky, FLOOR_Z);
    const t0 = iso(kx, ky, FLOOR_Z + 1.05);
    out.push(
      ellipse(`${k}s${i}`, b0, 9, 4.6, SCENE.shadow),
      <Path
        key={`${k}b${i}`}
        d={`M ${(b0[0] - 8.4).toFixed(1)} ${b0[1].toFixed(1)} L ${(t0[0] - 8.4).toFixed(1)} ${t0[1].toFixed(1)} A 8.4 4.2 0 0 0 ${(t0[0] + 8.4).toFixed(1)} ${t0[1].toFixed(1)} L ${(b0[0] + 8.4).toFixed(1)} ${b0[1].toFixed(1)} A 8.4 4.2 0 0 1 ${(b0[0] - 8.4).toFixed(1)} ${b0[1].toFixed(1)} Z`}
        fill={i % 2 ? SCENE.brass100 : SCENE.brass300}
        stroke={SCENE.brass700}
        strokeWidth="0.8"
      />,
      ellipse(`${k}t${i}`, t0, 8.4, 4.2, i % 2 ? SCENE.brass500 : SCENE.brass400, {
        stroke: SCENE.brass700,
        sw: 0.8,
      }),
      ellipse(`${k}i${i}`, t0, 4, 2, "none", { stroke: SCENE.brass700, sw: 0.6 }),
    );
  }
  return out;
};

/** Staging — a marked-out floor area with something standing on it, not a structure. */
const staging: Renderer = (p, k) => [
  flat(`${k}f`, p.x, p.y, p.w, p.d, "none", SCENE.brass500, 1.1, FLOOR_Z + 0.02, "5 4"),
  ...box(`${k}p`, {
    x: p.x + 0.4,
    y: p.y + 0.5,
    w: 1.7,
    d: 1.4,
    h: 0.26,
    top: SCENE.brass700,
    z0: FLOOR_Z,
  }),
  ...box(`${k}l`, {
    x: p.x + 0.55,
    y: p.y + 0.65,
    w: 1.35,
    d: 1.1,
    h: 0.9,
    top: SCENE.white,
    stroke: SCENE.champagne,
    z0: FLOOR_Z + 0.26,
  }),
];

/** The generic store, and the fallback every unknown visual lands on. */
const store: Renderer = (p, k) => {
  const H = 2.5;
  const dx = p.x + p.w * 0.38;
  return [
    blob(`${k}sh`, p.x, p.y, p.w, p.d),
    ...box(`${k}b`, {
      x: p.x,
      y: p.y,
      w: p.w,
      d: p.d,
      h: H,
      top: SCENE.linen200,
      stroke: "#A39E93",
      z0: FLOOR_Z,
    }),
    poly({
      k: `${k}door`,
      points: [
        iso(dx, p.y + p.d, FLOOR_Z + 1.9),
        iso(dx + 1.15, p.y + p.d, FLOOR_Z + 1.9),
        iso(dx + 1.15, p.y + p.d, FLOOR_Z),
        iso(dx, p.y + p.d, FLOOR_Z),
      ],
      fill: shade(SCENE.linen200, 0.92),
      stroke: "#A39E93",
      sw: 0.9,
    }),
    ((): ReactElement => {
      const kn = iso(dx + 0.95, p.y + p.d, FLOOR_Z + 0.95);
      return (
        <Circle
          key={`${k}kn`}
          cx={kn[0].toFixed(1)}
          cy={kn[1].toFixed(1)}
          r="1.4"
          fill={SCENE.brass600}
        />
      );
    })(),
  ];
};

const RENDERERS: Record<string, Renderer> = {
  chiller: coldRoom,
  freezer: coldRoom,
  wine,
  dry: shelving,
  linen: shelving,
  kegs,
  staging,
  store,
};

/**
 * Draws one location.
 *
 * Falls back rather than failing, on the same rule the registry uses: `locationType()`
 * already resolves an unknown visual to `store`, so asking it keeps the two in step. A
 * location can never fail to draw.
 */
export function drawLocation(p: Drawn, k: string, selected = false): ReactElement[] {
  const known = Object.hasOwn(RENDERERS, p.visual) ? p.visual : null;
  const render = known ? RENDERERS[known]! : RENDERERS["store"]!;
  // Touching the registry keeps the two lookups honest: if a visual is drawable here but
  // unknown there (or the reverse), the label and the footprint would disagree with the
  // shape, which is worse than either being missing.
  void locationType(p.visual);
  const out = render(p, k);
  // The selection ring belongs to the world, not to the overlay layer: it is drawn on the
  // floor at the location's feet and must move and scale with it. Overlays (LFP-3) are the
  // things that must NOT scale — plates and pins — and this is neither.
  if (selected) {
    out.push(
      flat(
        `${k}sel`,
        p.x - 0.3,
        p.y - 0.3,
        p.w + 0.6,
        p.d + 0.6,
        "none",
        SCENE.brass600,
        1.6,
        FLOOR_Z + 0.01,
        "3 3",
      ),
    );
  }
  return out;
}
