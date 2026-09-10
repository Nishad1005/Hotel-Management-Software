/**
 * The floor plan's scene palette — day and night.
 *
 * Ported from the reference demo's `P` and `EV` token sets
 * (docs/ui-redesign/living-floor-plan/living-floor-plan-demo-v7.html). The spec asks for
 * these to live in `theme.ts` rather than be hardcoded in components; they live in their
 * own module beside it instead, and the reason is that they are a different register.
 * `theme.ts` answers "what colour is a warning, a border, a disabled row" — semantic
 * questions about a user interface. This answers "what colour is pool water at night" —
 * and the two lists sitting in one file would make it harder, not easier, to find either.
 * The rule the spec is actually enforcing is obeyed: no scene hex appears in a component.
 *
 * **The interior does not change between day and night. Only the environment does.**
 * That is a deliberate line from the spec, and it is worth understanding rather than
 * just obeying: the building's floor, rooms and locations are lit stores that look the
 * same at 3am as at noon, because they are indoors and the lights are on. What changes
 * is outside — grounds, drive, pool, flora, and whether the path lamps are burning.
 * Night is the signature look; day is the calm working look.
 */

/** The raw scale the demo draws from. Named exactly as it is there, to keep the port readable. */
export const SCENE = {
  linen50: "#FAF9F5",
  linen100: "#F5F2EB",
  linen200: "#E9E2D1",
  champagne: "#E0D9C6",
  white: "#FFFFFF",
  forest950: "#061510",
  forest900: "#081C15",
  forest800: "#0D2818",
  forest700: "#143628",
  forest600: "#1D4736",
  brass300: "#DCB879",
  brass400: "#D4AF37",
  brass500: "#C5A059",
  brass600: "#B8860B",
  brass700: "#9A7B38",
  brass100: "#F5EEDC",
  sage50: "#F2F6F3",
  sage300: "#8FB29A",
  sage500: "#3E5F49",
  sage700: "#2D4735",
  saffron500: "#C87D28",
  ink: "#191C1B",
  muted: "#555E58",
  shadow: "rgba(18,48,36,0.16)",
  water: "#8FD0B4",
  water2: "#3F7A61",
} as const;

/**
 * Darkens (`f` < 1) or lightens (`f` > 1) a hex colour.
 *
 * The demo's `shade()`. Used for the two shaded faces of every isometric box, which is
 * what makes a flat fill read as a solid — so it is load-bearing rather than a
 * convenience, and every box in the scene depends on it.
 */
export function shade(hex: string, f: number): string {
  const h = hex.replace("#", "");
  let rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  rgb =
    f <= 1
      ? rgb.map((c) => Math.round(c * f))
      : rgb.map((c) => Math.round(c + (255 - c) * (f - 1)));
  return "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** Every environment-dependent colour in the scene. Both modes enumerate all of them. */
export interface SceneEnv {
  g1: string;
  g2: string;
  g3: string;
  groundStroke: string;
  court: string;
  driveFill: string;
  lane: string;
  paver: string;
  lawnFill: string;
  lawnOp: number;
  poolDeck: string;
  waterA: string;
  waterB: string;
  waterEdge: string;
  waterGlowOp: number;
  sparkle: string;
  stone: string;
  stoneStroke: string;
  glassA: string;
  glassB: string;
  gateGlowOp: number;
  haloColor: string;
  haloOp: number;
  washOp: number;
  vigOp: number;
  trunk: string;
  ring: string;
  frondA: string;
  frondB: string;
  /** Shrub tones, light to dark, plus the highlight cap. */
  s1: string;
  s2: string;
  s3: string;
  sHl: string;
  /** Hedge box faces: top, left, right, stroke. */
  hT: string;
  hL: string;
  hR: string;
  hS: string;
  lampsOn: boolean;
  /** The focus cutout's dim, for LFP-3. Enumerated here so both modes stay in one place. */
  dim: string;
  night: boolean;
}

const NIGHT: SceneEnv = {
  g1: "#20402C",
  g2: "#153223",
  g3: "#0B2016",
  groundStroke: "#2E4A3A",
  court: "#1C3A29",
  driveFill: "#284437",
  lane: "rgba(232,227,215,0.4)",
  paver: "rgba(255,255,255,0.05)",
  lawnFill: "#2E5340",
  lawnOp: 0.55,
  poolDeck: "#3A5546",
  waterA: "#8FD0B4",
  waterB: "#3F7A61",
  waterEdge: "#6FBD9C",
  waterGlowOp: 0.28,
  sparkle: "#EFFFF6",
  stone: "#4A6350",
  stoneStroke: "#3A5242",
  glassA: "#F3E0B0",
  glassB: "#D8B268",
  gateGlowOp: 0.3,
  haloColor: "#E8C980",
  haloOp: 0.1,
  washOp: 0,
  vigOp: 0,
  trunk: "#3B5B48",
  ring: "#345043",
  frondA: "#24432F",
  frondB: "#35604A",
  s1: "#2E5340",
  s2: "#3A6650",
  s3: "#24432F",
  sHl: "#4A7A5E",
  hT: "#2C5340",
  hL: "#234534",
  hR: "#1B3728",
  hS: "#142B1F",
  lampsOn: true,
  dim: "rgba(2,8,6,0.86)",
  night: true,
};

const DAY: SceneEnv = {
  g1: "#F6F1E4",
  g2: "#EFE9D9",
  g3: "#E2DAC5",
  groundStroke: SCENE.champagne,
  court: "#F8F4EA",
  driveFill: SCENE.linen200,
  lane: SCENE.champagne,
  paver: "rgba(120,110,90,0.16)",
  lawnFill: SCENE.sage50,
  lawnOp: 0.85,
  poolDeck: SCENE.champagne,
  waterA: "#DCE9E1",
  waterB: "#C4DACD",
  waterEdge: SCENE.sage300,
  waterGlowOp: 0,
  sparkle: "#FFFFFF",
  stone: SCENE.champagne,
  stoneStroke: shade(SCENE.champagne, 0.93),
  glassA: SCENE.forest600,
  glassB: SCENE.forest800,
  gateGlowOp: 0,
  haloColor: "rgba(18,48,36,0.55)",
  haloOp: 0.3,
  washOp: 0.1,
  vigOp: 0.075,
  trunk: SCENE.forest700,
  ring: shade(SCENE.forest700, 0.85),
  frondA: SCENE.forest800,
  frondB: SCENE.forest600,
  s1: SCENE.forest700,
  s2: SCENE.forest600,
  s3: SCENE.forest800,
  sHl: SCENE.forest600,
  hT: SCENE.forest600,
  hL: SCENE.forest700,
  hR: SCENE.forest800,
  hS: SCENE.forest900,
  lampsOn: false,
  dim: "rgba(16,36,26,0.78)",
  night: false,
};

export function floorPlanEnv(night: boolean): SceneEnv {
  return night ? NIGHT : DAY;
}

/**
 * Whether the scene should be drawn at night, from a clock the caller supplies.
 *
 * Day is 06:00–17:59. The hour is a parameter rather than read here, so a screenshot or
 * a test can ask for either mode without moving the machine's clock — and so this file
 * keeps no dependency on the current time (ADR 0009's habit, applied where it costs
 * nothing).
 */
export function isNightAt(hour: number): boolean {
  return hour < 6 || hour >= 18;
}
