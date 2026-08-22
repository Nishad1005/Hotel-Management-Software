/**
 * Design tokens.
 *
 * Two things drive everything here.
 *
 * FIRST, this app has two audiences with opposite needs. A security officer at a gate
 * at night wears gloves and reads the screen in direct sun; a manager building the item
 * master sits at a desk and wants to see forty rows at once. The first version applied
 * the gate's sizing everywhere, which made the admin screens look clumsy and made every
 * element shout at the same volume. Hence two densities: `field` and `desk`. Gate and
 * dock screens use field. Masters, lists and settings use desk.
 *
 * SECOND, this is an operations tool, but it is also the thing a managing director
 * judges in ten seconds. The first palette was industrial slate on cold grey, following
 * the system theme, which meant it rendered near-black and read as unfinished. It is
 * now warm, light and soft: an off-white page, white cards raised above it, terracotta
 * for action. Colour still stays scarce, so that when something IS coloured — expiring,
 * blocked, rejected — it means something.
 */

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/**
 * Interactive sizing, by context.
 *
 * `field` is above the 44pt/48dp platform minimum on purpose — gloves, torchlight, a
 * moving vehicle. `desk` sits at the platform minimum, which is correct for a mouse
 * and a keyboard and lets a list actually be a list.
 */
export const touch = {
  field: 60,
  fieldLarge: 84,
  desk: 44,
  deskCompact: 36,
} as const;

/**
 * The size ramp.
 *
 * It was 34/24/18/16/15/14/12/11 — eight roles, of which the bottom five spanned five
 * pixels. `body` and `label` were 1px apart, `subheading` and `body` were 1px apart,
 * `caption` and `micro` were 1px apart. You cannot build hierarchy out of a 6% size step,
 * so the screens compensated with colour instead: 46 status pills doing six different
 * jobs, and a customer's onboarding progress conveyed by how many of them were green.
 *
 * More damning, a count of every `type.*` reference in the app found **57% of them at 11
 * or 12 pixels**. The de facto body text of an operations product used in gloves, at
 * night, in direct sun was 12px.
 *
 * So this is six real sizes wearing eight names: 32 / 22 / 17 / 15 / 13 / 11. `label` and
 * `caption` deliberately share 13 — the difference between a field label and a row's
 * metadata was always weight and colour, never size — and `subheading` collapses onto
 * `heading`. The names are all kept so that changing these numbers touches no call site;
 * the duplicates are retired as screens migrate to `text` below.
 */
export const type = {
  display: 32,
  title: 22,
  heading: 17,
  /** @deprecated Sat 1px from `body`. Use `heading`, or `body` at semibold. */
  subheading: 17,
  body: 15,
  label: 13,
  caption: 13,
  /** Uppercase eyebrows only. 11px cannot carry content — see `text.overline`. */
  micro: 11,
} as const;

/**
 * Where the app is being looked at.
 *
 * Two values, not five. There is one decision — is there room for a sidebar — and one
 * secondary one for whether a list can afford columns. A `sm/md/lg/xl/2xl` ladder is a
 * web-framework habit that would be applied inconsistently across twenty-five screens.
 */
export const breakpoints = {
  /** Below this the app is a single column with a drawer; at or above it, a sidebar. */
  expanded: 1024,
  /** Above this a list row can spread its metadata into real columns. */
  wide: 1440,
} as const;

export const weight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  heavy: "800",
} as const;

/**
 * Typography — Inter, one family across every weight.
 *
 * It was drawn for user interfaces at small sizes: tall x-height, unambiguous 1/l/I,
 * and genuine tabular figures. That last one matters more here than it sounds, because
 * this app is mostly numbers in columns — quantities, temperatures, days remaining,
 * item codes.
 *
 * `font()` returns fontWeight alongside fontFamily deliberately. If the font has not
 * loaded — slow first paint, a cache miss, a native build without the asset — the
 * weight still applies and the screen degrades to the system face, instead of
 * flattening to a single undifferentiated weight.
 */
export const fontFamily = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  heavy: "Inter_800ExtraBold",
} as const;

export type WeightName = keyof typeof fontFamily;

export function font(w: WeightName) {
  return { fontFamily: fontFamily[w], fontWeight: weight[w] } as const;
}

/**
 * Numbers in columns must not jog sideways as digits change.
 *
 * Deliberately not `as const`. React Native's `TextStyle` declares `fontVariant` as a
 * mutable array, so a readonly tuple does not satisfy it — the token typechecked at no
 * call site at all, and every one of them inlined the literal instead. A token nobody
 * can use is not a token.
 */
export const tabular: { fontVariant: ["tabular-nums"] } = { fontVariant: ["tabular-nums"] };

/**
 * Text styles — a role, not a size.
 *
 * This is the token that was missing, and its absence is why the app looks the way it
 * does. `type` gave you a number; everything else — weight, line height, tracking — had
 * to be reassembled by hand at every call site. So it was: **192 of 203 `<Text>` elements
 * declared their own typography**, 38 line heights were hand-typed across six values, and
 * thirteen different letter-spacings floated loose. The same "section label" role was
 * tracked at 0.9 inside the design system and 1.2 in seven screens — two design languages
 * shipping side by side, and nobody could see it because nobody could see them together.
 *
 * A role bundles all five decisions. `<Text role="label">` is now a complete instruction.
 *
 * Line heights are absolute, not multipliers: React Native's `lineHeight` is in pixels,
 * and a ratio would round differently per size and reintroduce the drift this replaces.
 */
export interface TextStyleToken {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  weight: WeightName;
  /**
   * Always present, never optional. An optional member here would be `"uppercase" |
   * undefined` at the one call site that reads it, which `exactOptionalPropertyTypes`
   * rejects — and working around that with a conditional spread is how a primitive used
   * on every row starts collecting special cases.
   */
  textTransform: "none" | "uppercase";
}

export const text = {
  /** The one big figure on a tile. Never a sentence. */
  display: {
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.8,
    weight: "heavy",
    textTransform: "none",
  },
  /** Screen titles. */
  title: {
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.4,
    weight: "bold",
    textTransform: "none",
  },
  /** Card headings, and the figure at the end of a list row. */
  heading: {
    fontSize: 17,
    lineHeight: 24,
    letterSpacing: -0.2,
    weight: "semibold",
    textTransform: "none",
  },
  /** Prose, field values, button labels, the name in a list row. The workhorse. */
  body: {
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
    weight: "regular",
    textTransform: "none",
  },
  /** The metadata line under a name. The 15 → 13 gap is what makes a list scannable. */
  label: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
    weight: "regular",
    textTransform: "none",
  },
  /** Tertiary — hints, and a third line only where one is genuinely conditional. */
  caption: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
    weight: "regular",
    textTransform: "none",
  },
  /**
   * Uppercase section labels and pills, and nothing else.
   *
   * 11px is not a content size. It was used as one 32 times, which is where "compensate
   * with colour" came from — you cannot make 11px carry meaning any other way. It earns
   * its place here only because uppercase, weight and tracking do the work instead.
   */
  overline: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    weight: "bold",
    textTransform: "uppercase",
  },
} as const satisfies Record<string, TextStyleToken>;

export type TextRole = keyof typeof text;

export interface Palette {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  /** Structure: headers, chrome, the product's own voice. */
  primary: string;
  onPrimary: string;
  /**
   * A block of the product's own colour, for sign-in and anywhere else a full-width
   * band carries the brand.
   *
   * Deliberately the SAME deep slate in both themes, unlike `primary`, which flips to a
   * near-white in dark mode because it is a foreground colour. Using `primary` as a
   * background produced a pale band across a near-black page with a hard seam through
   * the middle — a brand band is brand-coloured regardless of the reader's theme.
   */
  brand: string;
  onBrand: string;
  onBrandMuted: string;
  /** Action and stock-in-hand. The only saturated colour in ordinary use. */
  accent: string;
  onAccent: string;
  accentSurface: string;
  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  danger: string;
  dangerSurface: string;
  /** Focus ring. Web keyboard navigation is not optional. */
  focus: string;
  shadow: string;
}

/**
 * Warm, light, and soft.
 *
 * The first version was industrial slate on a cold grey, following the system theme —
 * which meant it rendered near-black on most machines and read as grim. This is the
 * deliberate opposite: a warm off-white page, white cards that sit above it, and
 * terracotta for action.
 *
 * The warmth is in the neutrals, not just the accent. A cold grey under a warm accent
 * looks like an accident; every neutral here carries a little red so the whole thing
 * agrees with itself.
 */
const light: Palette = {
  background: "#FAF7F4",
  surface: "#FFFFFF",
  surfaceRaised: "#FFFFFF",
  surfaceSunken: "#F4EFE9",
  border: "#ECE4DB",
  borderStrong: "#C9BCAE",
  text: "#1F1B18",
  textMuted: "#736A62",
  /**
   * Was `#A69C93`, which is **2.52:1** against this background — WCAG AA wants 4.5:1 for
   * normal text. It was used 51 times, usually at 11px, in a product whose own brief says
   * it must be read in direct sun with cold hands.
   *
   * Solving for the lightest warm grey that still passes lands on almost exactly
   * `textMuted`, and that is the real finding: **this palette has room for two text
   * colours, not three.** So the third tier is gone as a visual device — hierarchy comes
   * from size, weight and space now, which is what `text` above is for. The token stays
   * only so the 51 call sites keep compiling; they collapse onto `textMuted` as screens
   * migrate, and then it goes.
   */
  textFaint: "#7A7068",
  primary: "#33241D",
  onPrimary: "#FFFFFF",
  brand: "#33241D",
  onBrand: "#FDFBF9",
  onBrandMuted: "#C4B3A6",
  accent: "#C2410C",
  onAccent: "#FFFFFF",
  accentSurface: "#FCEFE7",
  success: "#15803D",
  successSurface: "#E9F5EC",
  // Pushed towards yellow rather than orange, because the accent is already terracotta
  // and a warning that shares its hue stops being a warning.
  warning: "#A16207",
  warningSurface: "#FBF3DF",
  danger: "#CC2936",
  dangerSurface: "#FDECEE",
  // Blue on purpose: a focus ring that matches the brand is a focus ring nobody sees.
  focus: "#2563EB",
  shadow: "#4A342A",
};

/**
 * Kept, exported, and not currently selected.
 *
 * Exported rather than deleted because the gate device at night is a real requirement
 * (PRD section 4 Gate 0a), and a palette that is deleted has to be invented again from
 * nothing. It is cold slate, so it needs rebuilding warm before it is switched on — the
 * two themes have to agree about the brand, and right now they do not.
 */
export const darkPalette: Palette = {
  // Lifted as a set. The previous values put the page at #0A0F18 and cards at #141C28
  // — a 10-point step that reads as one flat surface on most screens, so every card
  // dissolved into the page and the whole app looked like unstyled boxes. Cards now sit
  // clearly above the page, and the border does real work rather than being a rumour.
  background: "#0B121C",
  surface: "#1B2634",
  surfaceRaised: "#22303F",
  surfaceSunken: "#141E2B",
  border: "#31404F",
  borderStrong: "#64748B",
  text: "#F1F5F9",
  textMuted: "#A8B7C7",
  textFaint: "#78889B",
  primary: "#E2E8F0",
  onPrimary: "#0A0F18",
  brand: "#16233A",
  onBrand: "#F8FAFC",
  onBrandMuted: "#A9BAD1",
  accent: "#2DD4A0",
  onAccent: "#04211A",
  accentSurface: "#0C2A22",
  success: "#2DD4A0",
  successSurface: "#0C2A22",
  warning: "#F5B944",
  warningSurface: "#2B1F06",
  danger: "#FF7A70",
  dangerSurface: "#2E1310",
  focus: "#6AA6FF",
  shadow: "#000000",
};

/**
 * Always light, deliberately.
 *
 * Following the system theme meant the app rendered near-black on most machines, and a
 * desaturated dark operations tool reads as unfinished rather than serious. Every
 * business tool this will be compared against — Linear, Stripe, Notion, a Shopify
 * admin — is light by default.
 *
 * `dark` is kept and maintained because the gate device at night is a real case, and
 * because a palette that has never been rendered rots. It becomes reachable behind a
 * setting, not behind whatever the reader's laptop happens to be set to.
 */
export function usePalette(): Palette {
  return light;
}

export function useIsDark(): boolean {
  return false;
}

/**
 * Elevation. Deliberately restrained: two levels, not five.
 *
 * A shadow here separates a surface from the page, it does not decorate. On web these
 * become box-shadow; on native, elevation.
 */
export function elevation(level: 0 | 1 | 2, palette: Palette) {
  if (level === 0) return {};
  const config = {
    1: { opacity: 0.05, radius: 8, offset: 2, elevation: 2 },
    2: { opacity: 0.09, radius: 24, offset: 8, elevation: 8 },
  }[level];
  return {
    shadowColor: palette.shadow,
    shadowOpacity: config.opacity,
    shadowRadius: config.radius,
    shadowOffset: { width: 0, height: config.offset },
    elevation: config.elevation,
  };
}
