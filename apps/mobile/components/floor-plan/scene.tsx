import {
  DEFAULT_PLAN_SIZE,
  layoutFloorPlan,
  locationType,
  type LayoutRoomInput,
  type PlanSize,
} from "@golai/domain";
import type { ReactElement } from "react";
import {
  Circle,
  Defs,
  FeGaussianBlur,
  Filter,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from "react-native-svg";
import { SCENE, shade, type SceneEnv } from "../../theme-floor-plan";
import { blob, box, curve, ellipse, flat, iso, line, poly, S, type Pt } from "./iso";
import { FLOOR_Z, drawLocation, type Drawn } from "./visuals";

/**
 * The world layer — the whole isometric scene, ported from the demo's `buildScene()`.
 *
 * **Overlays are not here.** Room name plates and reading pins live in screen space and
 * arrive in LFP-3; nothing in this file draws text, which is the mechanical form of the
 * spec's rule that a label must never scale with the world. If text appears in this file
 * later, that rule has been broken.
 *
 * Draw order is the whole trick and there is no z-buffer: ground, then grounds furniture,
 * then the building shell, then rooms, then their contents, then the things that stand in
 * front. Moving a block changes what occludes what, so the sequence below is the drawing,
 * not an arrangement of code.
 */

/** Room floor tints, cycled. Four values so adjacent bays never share one. */
const ROOM_TINTS = [1.2, 1.24, 1.17, 1.27];

const WALL_H = 3.3;
const WALL_T = 0.45;

export interface SceneResult {
  elements: ReactElement[];
  /** The viewBox that frames the whole property, in SVG units. */
  base: { x: number; y: number; w: number; h: number };
}

function sceneDefs(env: SceneEnv): ReactElement {
  return (
    <Defs key="defs">
      <Filter id="soft" x="-60%" y="-60%" width="220%" height="220%">
        <FeGaussianBlur stdDeviation="4" />
      </Filter>
      <Filter id="softer" x="-80%" y="-80%" width="260%" height="260%">
        <FeGaussianBlur stdDeviation="10" />
      </Filter>
      <Filter id="glow" x="-120%" y="-120%" width="340%" height="340%">
        <FeGaussianBlur stdDeviation="7" />
      </Filter>
      <LinearGradient id="waterG" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor={env.waterA} />
        <Stop offset="1" stopColor={env.waterB} />
      </LinearGradient>
      <RadialGradient id="groundG" cx="42%" cy="30%" r="85%">
        <Stop offset="0" stopColor={env.g1} />
        <Stop offset="0.55" stopColor={env.g2} />
        <Stop offset="1" stopColor={env.g3} />
      </RadialGradient>
      <RadialGradient id="floorG" cx="45%" cy="35%" r="80%">
        <Stop offset="0" stopColor="#FFFFFF" />
        <Stop offset="1" stopColor="#F4F0E7" />
      </RadialGradient>
      <LinearGradient id="vTop" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor={SCENE.forest700} />
        <Stop offset="1" stopColor={SCENE.forest800} />
      </LinearGradient>
      <LinearGradient id="vLeft" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={SCENE.forest700} />
        <Stop offset="1" stopColor={SCENE.forest900} />
      </LinearGradient>
      <LinearGradient id="vRight" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={SCENE.forest900} />
        <Stop offset="1" stopColor={SCENE.forest950} />
      </LinearGradient>
      <LinearGradient id="glassG" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={env.glassA} />
        <Stop offset="1" stopColor={env.glassB} />
      </LinearGradient>
    </Defs>
  );
}

const lawn = (k: string, env: SceneEnv, x: number, y: number, r: number) =>
  ellipse(k, iso(x, y, 0.008), r * S * 1.7, r * S * 0.85, env.lawnFill, {
    opacity: env.lawnOp,
    filter: "url(#soft)",
  });

function shrub(k: string, env: SceneEnv, x: number, y: number, sc = 1): ReactElement[] {
  const base = iso(x, y);
  const out: ReactElement[] = [ellipse(`${k}s`, base, 10 * sc, 4.5 * sc, SCENE.shadow)];
  const lobes: [number, number, number, string][] = [
    [-0.25, 0.1, 7, env.s1],
    [0.25, -0.05, 8, env.s2],
    [0, 0.22, 6, env.s3],
  ];
  lobes.forEach(([dx, dy, r, c], i) =>
    out.push(ellipse(`${k}l${i}`, iso(x + dx, y + dy, 0.35 * sc), r * sc, r * 0.78 * sc, c)),
  );
  out.push(
    ellipse(`${k}h`, iso(x + 0.1, y - 0.1, 0.5 * sc), 3 * sc, 2 * sc, env.sHl, { opacity: 0.9 }),
  );
  return out;
}

function palm(k: string, env: SceneEnv, x: number, y: number, h = 3.6, r = 1.6): ReactElement[] {
  const base = iso(x, y, 0);
  const top = iso(x, y, h);
  const out: ReactElement[] = [
    ellipse(`${k}s`, base, 16, 7, SCENE.shadow, { filter: "url(#soft)" }),
    curve(
      `${k}t`,
      `M ${base[0].toFixed(1)} ${base[1].toFixed(1)} Q ${(base[0] + 3).toFixed(1)} ${((base[1] + top[1]) / 2).toFixed(1)} ${top[0].toFixed(1)} ${top[1].toFixed(1)}`,
      env.trunk,
      4,
    ),
  ];
  // Trunk rings, which is what stops it reading as a green stick.
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    const px = base[0] + (top[0] - base[0]) * t + 2.4 * (1 - t);
    const py = base[1] + (top[1] - base[1]) * t;
    out.push(
      curve(
        `${k}r${i}`,
        `M ${(px - 2.4).toFixed(1)} ${py.toFixed(1)} L ${(px + 2.4).toFixed(1)} ${(py - 1).toFixed(1)}`,
        env.ring,
        1,
      ),
    );
  }
  // Two rings of fronds, the inner one offset and smaller, so the crown has depth.
  for (let k2 = 0; k2 < 2; k2++) {
    for (let ang = k2 * 22; ang < 360; ang += 45) {
      const a = (ang * Math.PI) / 180;
      const rr = r * (k2 ? 0.62 : 1);
      const ex = top[0] + Math.cos(a) * rr * S * 0.95;
      const ey = top[1] + Math.sin(a) * rr * S * 0.48 - k2 * 3;
      const mx = top[0] + Math.cos(a) * rr * S * 0.5;
      const my = top[1] + Math.sin(a) * rr * S * 0.24 - 9;
      out.push(
        curve(
          `${k}f${k2}_${ang}`,
          `M ${top[0].toFixed(1)} ${top[1].toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`,
          k2 ? env.frondA : env.frondB,
          k2 ? 2.4 : 3.2,
        ),
      );
    }
  }
  const coconuts: [number, number][] = [
    [-3, 1],
    [3, 2],
    [0, 3.5],
  ];
  coconuts.forEach(([ox, oy], i) =>
    out.push(
      <Circle
        key={`${k}n${i}`}
        cx={(top[0] + ox).toFixed(1)}
        cy={(top[1] + oy).toFixed(1)}
        r="1.9"
        fill={SCENE.brass600}
      />,
    ),
  );
  return out;
}

function lamp(k: string, x: number, y: number): ReactElement[] {
  const b = iso(x, y, 0);
  const t = iso(x, y, 1.5);
  return [
    ellipse(`${k}g`, b, 40, 17, "#E8C980", { opacity: 0.14, filter: "url(#glow)" }),
    line(`${k}p`, b, t, "#0A1A12", 1.6),
    <Circle key={`${k}b`} cx={t[0].toFixed(1)} cy={t[1].toFixed(1)} r="3.1" fill="#F3E0B0" />,
    ellipse(`${k}h`, t, 7, 7, "#F3E0B0", { opacity: 0.35, filter: "url(#soft)" }),
  ];
}

/**
 * Builds the entire scene.
 *
 * Pure: same rooms and same environment give the same elements, with no clock read and no
 * state. That is what lets the caller memoise on a hash of the data, and what lets a
 * screenshot ask for night at ten in the morning.
 */
export function buildScene(
  rooms: readonly LayoutRoomInput[],
  env: SceneEnv,
  selectedId?: string | null,
): SceneResult {
  const layout = layoutFloorPlan(rooms, (l) =>
    locationType(l.visual).footprint((l.size ?? DEFAULT_PLAN_SIZE) as PlanSize),
  );
  const BW = layout.buildingWidth;
  const BD = layout.buildingDepth;
  const E: ReactElement[] = [sceneDefs(env)];

  // --- the ground ---------------------------------------------------------
  const gx = -15.2;
  const gy = -7.6;
  const gw = BW + 21.8;
  const gd = 27.6;
  E.push(flat("ground", gx, gy, gw, gd, "url(#groundG)", env.groundStroke, 1.2, 0));
  E.push(
    lawn("lw1", env, -11, 10, 4.2),
    lawn("lw2", env, 6, BD + 3.5, 3.4),
    lawn("lw3", env, BW + 3, 7, 3.2),
    lawn("lw4", env, BW - 5, BD + 3, 3),
  );
  E.push(flat("court", -1.8, -1.8, BW + 4, BD + 5, env.court, undefined, 0, 0.01));

  // --- the drive ----------------------------------------------------------
  E.push(
    flat("drive", -16, -4.6, BW + 11.5, 3.4, env.driveFill, shade(env.driveFill, 0.85), 0.8, 0.02),
  );
  for (let x0 = -15, i = 0; x0 < BW - 6; x0 += 3, i++) {
    E.push(line(`lane${i}`, iso(x0, -2.95, 0.03), iso(x0 + 1.4, -2.95, 0.03), env.lane, 1.6));
  }
  for (let x0 = -15.2, i = 0; x0 < BW - 5; x0 += 1.6, i++) {
    E.push(line(`pav${i}`, iso(x0, -4.5, 0.025), iso(x0, -1.3, 0.025), env.paver, 0.5));
  }

  // --- the pool -----------------------------------------------------------
  E.push(flat("deck", -13.5, 7.5, 7.4, 5.2, env.poolDeck, shade(env.poolDeck, 0.88), 0.8, 0.03));
  E.push(
    ellipse("wglow", iso(-9.8, 10.1, 0.05), 105, 46, "#7FC4A6", {
      opacity: env.waterGlowOp,
      filter: "url(#glow)",
    }),
  );
  E.push(flat("water", -12.8, 8.1, 6, 4, "url(#waterG)", env.waterEdge, 0.8, 0.05));
  E.push(
    line("wr1", iso(-11.6, 8.9, 0.06), iso(-8.4, 8.9, 0.06), shade(SCENE.water2, 0.92), 1.1),
    line("wr2", iso(-11.2, 10.1, 0.06), iso(-8.0, 10.1, 0.06), shade(SCENE.water2, 0.92), 1.1),
    line("wsp1", iso(-12.1, 9.4, 0.07), iso(-11.3, 9.4, 0.07), env.sparkle, 1.4, { opacity: 0.9 }),
    line("wsp2", iso(-9.4, 10.8, 0.07), iso(-8.7, 10.8, 0.07), "#FFFFFF", 1.2, { opacity: 0.7 }),
    // Ladder
    line("ld1", iso(-7.05, 8.5, 0.55), iso(-7.05, 8.5, -0.1), SCENE.brass500, 1.4),
    line("ld2", iso(-7.05, 9.1, 0.55), iso(-7.05, 9.1, -0.1), SCENE.brass500, 1.4),
    line("ld3", iso(-7.05, 8.5, 0.35), iso(-7.05, 9.1, 0.35), SCENE.brass500, 1.1),
    line("ld4", iso(-7.05, 8.5, 0.1), iso(-7.05, 9.1, 0.1), SCENE.brass500, 1.1),
  );
  [13.4, 14.6].forEach((ly, i) =>
    E.push(
      ...box(`lg${i}`, {
        x: -12.4,
        y: ly,
        w: 1.9,
        d: 0.8,
        h: 0.35,
        top: SCENE.brass100,
        stroke: SCENE.brass500,
        z0: 0,
      }),
    ),
  );
  const up = iso(-9.6, 13.9, 0);
  const ut = iso(-9.6, 13.9, 2.6);
  // The canopy is two quadratics meeting at the rim, so it is a path rather than a polygon.
  E.push(
    ellipse("umbs", up, 12, 5, SCENE.shadow),
    line("umbp", up, ut, SCENE.brass700, 1.6),
    <Path
      key="umbc"
      d={`M ${(ut[0] - 24).toFixed(1)} ${(ut[1] + 6).toFixed(1)} Q ${ut[0].toFixed(1)} ${(ut[1] - 16).toFixed(1)} ${(ut[0] + 24).toFixed(1)} ${(ut[1] + 6).toFixed(1)} Q ${ut[0].toFixed(1)} ${(ut[1] - 2).toFixed(1)} ${(ut[0] - 24).toFixed(1)} ${(ut[1] + 6).toFixed(1)} Z`}
      fill={SCENE.forest700}
      stroke={SCENE.forest900}
      strokeWidth="0.8"
    />,
    curve(
      "umbr",
      `M ${(ut[0] - 12).toFixed(1)} ${(ut[1] + 1.2).toFixed(1)} Q ${ut[0].toFixed(1)} ${(ut[1] - 12).toFixed(1)} ${(ut[0] + 12).toFixed(1)} ${(ut[1] + 1.2).toFixed(1)}`,
      SCENE.brass300,
      1,
    ),
  );

  // --- path lamps, at night only -----------------------------------------
  if (env.lampsOn) {
    const spots: [number, number][] = [
      [-7.5, -0.4],
      [2.5, -0.4],
      [12, -0.4],
      [-6.3, 7.0],
      [-14.2, 12.9],
    ];
    spots.forEach(([lx, ly], i) => E.push(...lamp(`lamp${i}`, lx, ly)));
  }

  // --- gatehouse ----------------------------------------------------------
  const GX = -12.5;
  const GY = -1.2;
  E.push(
    blob("gsh", GX, GY, 3.1, 3.1),
    flat("gpad", GX + 1.0, GY + 2.8, 1.0, 1.6, SCENE.linen200, undefined, 0, 0.025),
  );
  for (let i = 0; i < 5; i++) {
    E.push(
      ellipse(`stone${i}`, iso(GX + 4.5 + i * 1.7, 1.2 + i * 0.35, 0.028), 7, 3.2, env.stone, {
        stroke: env.stoneStroke,
        sw: 0.6,
      }),
    );
  }
  E.push(
    ...box("ghouse", { x: GX, y: GY, w: 2.8, d: 2.8, h: 2.6, top: SCENE.white }),
    ...box("groof", {
      x: GX - 0.25,
      y: GY - 0.25,
      w: 3.3,
      d: 3.3,
      h: 0.35,
      top: SCENE.forest800,
      z0: 2.6,
    }),
    ellipse("gglow", iso(GX + 1.4, GY + 2.8, 1.5), 34, 20, "#F3E0B0", {
      opacity: env.gateGlowOp,
      filter: "url(#glow)",
    }),
    poly({
      k: "gwin",
      points: [
        iso(GX + 0.4, GY + 2.8, 1.9),
        iso(GX + 2.4, GY + 2.8, 1.9),
        iso(GX + 2.4, GY + 2.8, 1.1),
        iso(GX + 0.4, GY + 2.8, 1.1),
      ],
      fill: "url(#glassG)",
      stroke: SCENE.brass500,
      sw: 0.9,
    }),
    poly({
      k: "gside",
      points: [
        iso(GX + 2.8, GY + 0.6, 2.05),
        iso(GX + 2.8, GY + 1.5, 2.05),
        iso(GX + 2.8, GY + 1.5, 0),
        iso(GX + 2.8, GY + 0.6, 0),
      ],
      fill: SCENE.forest800,
      stroke: SCENE.brass500,
    }),
    ...box("gpost", { x: GX + 3.6, y: -1.4, w: 0.35, d: 0.35, h: 1.3, top: SCENE.forest900 }),
  );
  const aA = iso(GX + 3.77, -1.2, 1.25);
  const aB = iso(GX + 3.77, -4.6, 1.05);
  E.push(
    line("barr", aA, aB, SCENE.brass500, 4.5),
    line("barrs", aA, aB, SCENE.forest900, 4.5, { dash: "6 6" }),
  );

  // --- the reefer at the dock --------------------------------------------
  const dockX = BW - 9.6;
  const TX = dockX - 0.2;
  const TY = -6.4;
  E.push(
    blob("tsh", TX, TY + 0.6, 4, 5.6),
    ...box("apron", { x: dockX - 0.6, y: -1.6, w: 6.2, d: 1.6, h: 0.3, top: SCENE.linen200 }),
    ...box("tbody", {
      x: TX,
      y: TY + 2.1,
      w: 3.4,
      d: 4.5,
      h: 3.5,
      top: SCENE.white,
      left: shade(SCENE.white, 0.97),
      right: shade(SCENE.white, 0.9),
      stroke: SCENE.champagne,
      z0: 0.55,
    }),
    ...box("troof", {
      x: TX + 0.05,
      y: TY + 2.15,
      w: 3.3,
      d: 4.4,
      h: 0.12,
      top: SCENE.sage300,
      z0: 4.05,
    }),
  );
  for (let i = 1; i < 5; i++) {
    const ry = TY + 2.1 + i * 0.9;
    E.push(
      line(
        `trib${i}`,
        iso(TX + 3.4, ry, 0.7),
        iso(TX + 3.4, ry, 3.9),
        shade(SCENE.white, 0.86),
        0.6,
      ),
    );
  }
  E.push(
    line("tstripe", iso(TX + 3.4, TY + 2.4, 3.6), iso(TX + 3.4, TY + 6.5, 3.6), SCENE.sage500, 4),
  );
  const bc = iso(TX + 3.4, TY + 3.4, 2.5);
  E.push(
    <Circle
      key="tbadge"
      cx={bc[0].toFixed(1)}
      cy={bc[1].toFixed(1)}
      r="6"
      fill={SCENE.sage50}
      stroke={SCENE.sage500}
      strokeWidth="1"
    />,
    curve(
      "tsnow",
      `M ${(bc[0] - 3).toFixed(1)} ${bc[1].toFixed(1)} L ${(bc[0] + 3).toFixed(1)} ${bc[1].toFixed(1)} M ${bc[0].toFixed(1)} ${(bc[1] - 3).toFixed(1)} L ${bc[0].toFixed(1)} ${(bc[1] + 3).toFixed(1)} M ${(bc[0] - 2.1).toFixed(1)} ${(bc[1] - 2.1).toFixed(1)} L ${(bc[0] + 2.1).toFixed(1)} ${(bc[1] + 2.1).toFixed(1)} M ${(bc[0] - 2.1).toFixed(1)} ${(bc[1] + 2.1).toFixed(1)} L ${(bc[0] + 2.1).toFixed(1)} ${(bc[1] - 2.1).toFixed(1)}`,
      SCENE.sage500,
      0.9,
    ),
    ...box("tcab", { x: TX + 0.5, y: TY, w: 2.4, d: 2.0, h: 1.8, top: SCENE.forest800, z0: 0.55 }),
    ...box("tglass", {
      x: TX + 0.7,
      y: TY + 0.2,
      w: 2.0,
      d: 1.1,
      h: 0.75,
      top: "url(#glassG)",
      left: SCENE.forest700,
      right: SCENE.forest800,
      stroke: SCENE.forest900,
      z0: 2.4,
    }),
    <Circle
      key="thl"
      cx={iso(TX + 2.9, TY + 0.25, 1.0)[0].toFixed(1)}
      cy={iso(TX + 2.9, TY + 0.25, 1.0)[1].toFixed(1)}
      r="2"
      fill={SCENE.brass300}
    />,
  );
  [TY + 0.9, TY + 3.4, TY + 5.6].forEach((wy, i) => {
    const wc = iso(TX + 3.42, wy, 0.52);
    E.push(
      ellipse(`tw${i}a`, [wc[0], wc[1] - 2], 8.5, 6, SCENE.forest950, { opacity: 0.25 }),
      ellipse(`tw${i}b`, wc, 7, 4.8, SCENE.forest950),
      ellipse(`tw${i}c`, wc, 2.6, 1.8, SCENE.muted),
    );
  });

  // --- the building -------------------------------------------------------
  E.push(
    ellipse("halo", iso(BW * 0.5, BD * 0.5, 0), BW * S * 0.72, BW * S * 0.3, env.haloColor, {
      opacity: env.haloOp,
      filter: "url(#softer)",
    }),
    ...box("slab", {
      x: 0,
      y: 0,
      w: BW,
      d: BD,
      h: FLOOR_Z,
      top: "url(#floorG)",
      left: SCENE.linen200,
      right: shade(SCENE.linen200, 0.92),
      stroke: SCENE.champagne,
    }),
  );
  for (let x0 = 3, i = 0; x0 < BW; x0 += 3, i++) {
    E.push(
      line(
        `tx${i}`,
        iso(x0, 0.3, FLOOR_Z + 0.01),
        iso(x0, BD - 0.3, FLOOR_Z + 0.01),
        SCENE.champagne,
        0.5,
        { opacity: 0.75 },
      ),
    );
  }
  for (let y0 = 3, i = 0; y0 < BD; y0 += 3, i++) {
    E.push(
      line(
        `ty${i}`,
        iso(0.3, y0, FLOOR_Z + 0.01),
        iso(BW - 0.3, y0, FLOOR_Z + 0.01),
        SCENE.champagne,
        0.5,
        { opacity: 0.75 },
      ),
    );
  }
  E.push(
    flat(
      "runner",
      1.0,
      BD - 3.6,
      BW - 2.0,
      2.0,
      shade(SCENE.linen100, 1.08),
      shade(SCENE.linen200, 0.98),
      0.6,
      FLOOR_Z + 0.012,
    ),
    line(
      "runnerc",
      iso(1.6, BD - 2.6, FLOOR_Z + 0.02),
      iso(BW - 1.6, BD - 2.6, FLOOR_Z + 0.02),
      SCENE.champagne,
      0.8,
      { dash: "7 6" },
    ),
  );

  // Walls, with the dock opening cut out of the back one.
  const wallY0 = (k: string, x0: number, x1: number) =>
    box(k, {
      x: x0,
      y: 0,
      w: x1 - x0,
      d: WALL_T,
      h: WALL_H,
      top: SCENE.linen200,
      left: shade(SCENE.linen200, 1.06),
      right: shade(SCENE.linen200, 0.88),
      z0: FLOOR_Z,
    });
  E.push(
    ...wallY0("wallA", 0, dockX),
    ...wallY0("wallB", dockX + 5, BW),
    ...box("capA", {
      x: -0.1,
      y: -0.1,
      w: dockX + 0.2,
      d: WALL_T + 0.2,
      h: 0.14,
      top: SCENE.champagne,
      z0: FLOOR_Z + WALL_H,
    }),
    ...box("capB", {
      x: dockX + 4.9,
      y: -0.1,
      w: BW - dockX - 4.8,
      d: WALL_T + 0.2,
      h: 0.14,
      top: SCENE.champagne,
      z0: FLOOR_Z + WALL_H,
    }),
    ...box("lintel", {
      x: dockX,
      y: 0,
      w: 5.0,
      d: WALL_T,
      h: 0.55,
      top: SCENE.linen200,
      z0: FLOOR_Z + 2.75,
    }),
    poly({
      k: "dockdoor",
      points: [
        iso(dockX + 0.15, WALL_T, FLOOR_Z + 2.75),
        iso(dockX + 4.85, WALL_T, FLOOR_Z + 2.75),
        iso(dockX + 4.85, WALL_T, FLOOR_Z + 1.7),
        iso(dockX + 0.15, WALL_T, FLOOR_Z + 1.7),
      ],
      fill: SCENE.forest700,
      stroke: SCENE.forest900,
    }),
  );
  for (let i = 1; i < 3; i++) {
    const z = FLOOR_Z + 1.7 + i * 0.35;
    E.push(
      line(
        `dockslat${i}`,
        iso(dockX + 0.15, WALL_T, z),
        iso(dockX + 4.85, WALL_T, z),
        SCENE.forest900,
        0.7,
      ),
    );
  }
  [dockX + 0.1, dockX + 4.9].forEach((xx, i) =>
    E.push(
      line(
        `dockj${i}`,
        iso(xx, WALL_T, FLOOR_Z),
        iso(xx, WALL_T, FLOOR_Z + 2.75),
        SCENE.brass500,
        2,
      ),
    ),
  );
  E.push(
    ...box("wallL", {
      x: 0,
      y: 0,
      w: WALL_T,
      d: BD,
      h: WALL_H,
      top: SCENE.linen200,
      left: shade(SCENE.linen200, 1.06),
      right: shade(SCENE.linen200, 0.88),
      z0: FLOOR_Z,
    }),
    ...box("capL", {
      x: -0.1,
      y: -0.1,
      w: WALL_T + 0.2,
      d: BD + 0.2,
      h: 0.14,
      top: SCENE.champagne,
      z0: FLOOR_Z + WALL_H,
    }),
    line(
      "brassA",
      iso(0, 0, FLOOR_Z + WALL_H + 0.16),
      iso(BW, 0, FLOOR_Z + WALL_H + 0.16),
      SCENE.brass500,
      1.6,
    ),
    line(
      "brassB",
      iso(0, 0, FLOOR_Z + WALL_H + 0.16),
      iso(0, BD, FLOOR_Z + WALL_H + 0.16),
      SCENE.brass500,
      1.6,
    ),
    // Ambient occlusion where wall meets floor. Cheap, and the thing that stops the
    // interior looking like flat shapes pasted on a slab.
    line(
      "aoA",
      iso(0.55, WALL_T + 0.12, FLOOR_Z + 0.03),
      iso(BW - 0.4, WALL_T + 0.12, FLOOR_Z + 0.03),
      "rgba(20,54,40,0.10)",
      3,
    ),
    line(
      "aoB",
      iso(WALL_T + 0.12, 0.55, FLOOR_Z + 0.03),
      iso(WALL_T + 0.12, BD - 0.4, FLOOR_Z + 0.03),
      "rgba(20,54,40,0.10)",
      3,
    ),
  );

  // --- rooms, then their contents ----------------------------------------
  layout.rooms.forEach((r, i) => {
    const LW = 1.5;
    const lowWall = (k: string, x: number, y: number, w: number, d: number) =>
      box(k, {
        x,
        y,
        w,
        d,
        h: LW,
        top: shade(SCENE.linen200, 1.04),
        left: shade(SCENE.linen200, 0.98),
        right: shade(SCENE.linen200, 0.88),
        z0: FLOOR_Z,
      });
    E.push(
      flat(
        `rf${i}`,
        r.x,
        r.y,
        r.w,
        r.d,
        shade(SCENE.linen100, ROOM_TINTS[i % ROOM_TINTS.length]!),
        SCENE.champagne,
        0.8,
        FLOOR_Z + 0.015,
      ),
      flat(
        `ri${i}`,
        r.x + 0.22,
        r.y + 0.22,
        r.w - 0.44,
        r.d - 0.44,
        "none",
        "rgba(20,54,40,0.07)",
        1.6,
        FLOOR_Z + 0.02,
      ),
      // Three low walls and a gap: the gap is the doorway onto the corridor.
      ...lowWall(`rw${i}a`, r.x, r.y + r.d - 0.28, r.w * 0.34, 0.28),
      ...lowWall(
        `rw${i}b`,
        r.x + r.w * 0.34 + 1.6,
        r.y + r.d - 0.28,
        r.w - (r.w * 0.34 + 1.6),
        0.28,
      ),
      ...lowWall(`rw${i}c`, r.x, r.y, 0.28, r.d - 0.28),
      ...lowWall(`rw${i}d`, r.x + r.w - 0.28, r.y, 0.28, r.d - 0.28),
    );
  });

  layout.rooms.forEach((r) => {
    for (const l of r.locations) {
      E.push(
        ...drawLocation(
          { ...l, visual: l.visual ?? "store" } as Drawn,
          `loc${l.id}`,
          l.id === selectedId,
        ),
      );
    }
  });

  // Pergola frames and a potted plant at each doorway, drawn after the contents so they
  // read as standing in front of them.
  layout.rooms.forEach((r, i) => {
    const zc = FLOOR_Z + 3.15;
    const inset = 0.45;
    const corners: [number, number][] = [
      [r.x + inset, r.y + inset],
      [r.x + r.w - inset, r.y + inset],
      [r.x + r.w - inset, r.y + r.d - inset],
      [r.x + inset, r.y + r.d - inset],
    ];
    corners.forEach(([cx, cy], j) =>
      E.push(line(`pg${i}_${j}`, iso(cx, cy, FLOOR_Z), iso(cx, cy, zc), SCENE.brass700, 1.7)),
    );
    const top = corners.map(([cx, cy]) => iso(cx, cy, zc));
    E.push(
      poly({ k: `pgt${i}`, points: top, fill: "none", stroke: SCENE.forest800, sw: 2 }),
      poly({ k: `pgt2${i}`, points: top, fill: "none", stroke: "rgba(220,184,121,0.55)", sw: 0.8 }),
    );
    const px = r.x + r.w * 0.34 + 0.6;
    E.push(
      ...box(`pot${i}`, {
        x: px,
        y: r.y + r.d - 1.15,
        w: 0.62,
        d: 0.62,
        h: 0.5,
        top: SCENE.brass300,
        stroke: SCENE.brass700,
        z0: FLOOR_Z,
      }),
      ...shrub(`pshr${i}`, env, px + 0.31, r.y + r.d - 0.84, 0.52),
    );
  });

  for (let sx = 2.5, i = 0; sx < BW - 1; sx += 5.5, i++) {
    const sc = iso(sx, WALL_T + 0.06, FLOOR_Z + 2.5);
    E.push(
      <Circle
        key={`sconce${i}a`}
        cx={sc[0].toFixed(1)}
        cy={sc[1].toFixed(1)}
        r="3.2"
        fill={SCENE.brass100}
        opacity="0.85"
      />,
      <Circle
        key={`sconce${i}b`}
        cx={sc[0].toFixed(1)}
        cy={sc[1].toFixed(1)}
        r="1.5"
        fill={SCENE.brass500}
      />,
    );
  }

  E.push(
    ...box("pallet", {
      x: dockX - 2.6,
      y: BD - 3.1,
      w: 1.7,
      d: 1.4,
      h: 0.26,
      top: SCENE.brass700,
      z0: FLOOR_Z,
    }),
    ...box("palletl", {
      x: dockX - 2.45,
      y: BD - 2.95,
      w: 1.35,
      d: 1.1,
      h: 0.85,
      top: SCENE.brass100,
      stroke: SCENE.brass500,
      z0: FLOOR_Z + 0.26,
    }),
    ...box("trolley", {
      x: dockX + 1.2,
      y: 4.2,
      w: 1.4,
      d: 1.0,
      h: 0.5,
      top: SCENE.forest600,
      z0: FLOOR_Z,
    }),
    ...box("trolleyl", {
      x: dockX + 1.35,
      y: 4.35,
      w: 1.1,
      d: 0.7,
      h: 0.65,
      top: SCENE.white,
      stroke: SCENE.champagne,
      z0: FLOOR_Z + 0.5,
    }),
  );

  // --- flora, in front of the building -----------------------------------
  const hedge = (k: string, x: number, y: number, w: number, d: number) =>
    box(k, { x, y, w, d, h: 0.9, top: env.hT, left: env.hL, right: env.hR, stroke: env.hS });
  E.push(...hedge("hgA", -2.8, BD + 1.6, 9, 1.2), ...hedge("hgB", BW + 2, 9, 1.2, 8));
  const shrubs: [number, number, number][] = [
    [-14.2, 2.6, 1],
    [-6.4, 13.2, 0.9],
    [2.2, BD + 2.6, 1.05],
    [BW + 3.4, 13.6, 0.95],
    [BW - 2.5, BD + 2.4, 0.9],
  ];
  shrubs.forEach(([sx, sy, sc], i) => E.push(...shrub(`shr${i}`, env, sx, sy, sc)));
  const palms: [number, number, number][] = [
    [-10.2, 12.6, 3.8],
    [6.0, BD + 3.6, 3.4],
    [BW - 5, BD + 3.2, 3.9],
    [BW + 4.4, 5.6, 3.3],
    [-14.6, 5.2, 3.6],
  ];
  palms.forEach(([px, py, ph], i) => E.push(...palm(`palm${i}`, env, px, py, ph)));

  // --- light pass ---------------------------------------------------------
  const sun = iso(BW * 0.22, 1.5, 0);
  E.push(
    ellipse("sun", [sun[0], sun[1] - 30], BW * S * 0.75, BW * S * 0.34, "#FFFDF7", {
      opacity: env.washOp,
      filter: "url(#softer)",
    }),
  );
  const vg = iso(BW * 0.72, BD + 7, 0);
  E.push(
    ellipse("vig", [vg[0], vg[1] + 22], BW * S * 0.85, BW * S * 0.3, SCENE.forest900, {
      opacity: env.vigOp,
      filter: "url(#softer)",
    }),
  );

  // --- the frame ----------------------------------------------------------
  // Corners include the building's roof height, or a tall wall clips off the top.
  const corners: Pt[] = [
    iso(gx, gy),
    iso(gx + gw, gy),
    iso(gx, gy + gd),
    iso(gx + gw, gy + gd),
    iso(BW, 0, 9),
    iso(0, 0, 9),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minx = Math.min(...xs) - 8;
  const miny = Math.min(...ys) - 34;

  return {
    elements: E,
    base: { x: minx, y: miny, w: Math.max(...xs) - minx + 16, h: Math.max(...ys) - miny + 10 },
  };
}
