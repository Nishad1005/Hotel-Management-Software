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
 * SECOND, this is an operations tool, not a consumer app. Industrial slate for
 * structure, a single green for action and stock-in-hand. Colour is used sparingly so
 * that when something IS coloured — expiring, blocked, rejected — it means something.
 */

import { useColorScheme } from "react-native";

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
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
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

export const type = {
  display: 34,
  title: 24,
  heading: 18,
  subheading: 16,
  body: 15,
  label: 14,
  caption: 12,
  micro: 11,
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

/** Numbers in columns must not jog sideways as digits change. */
export const tabular = { fontVariant: ["tabular-nums"] } as const;

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

const light: Palette = {
  background: "#F1F5F9",
  surface: "#FFFFFF",
  surfaceRaised: "#FFFFFF",
  surfaceSunken: "#E9EEF4",
  border: "#DEE5EC",
  borderStrong: "#94A3B8",
  text: "#0F172A",
  textMuted: "#5A6B7F",
  textFaint: "#8A99AB",
  primary: "#1E293B",
  onPrimary: "#FFFFFF",
  brand: "#16233A",
  onBrand: "#F8FAFC",
  onBrandMuted: "#A9BAD1",
  accent: "#047857",
  onAccent: "#FFFFFF",
  accentSurface: "#E7F5EF",
  success: "#047857",
  successSurface: "#E7F5EF",
  warning: "#9A5B00",
  warningSurface: "#FDF3E2",
  danger: "#C22F26",
  dangerSurface: "#FCECEA",
  focus: "#0F62D6",
  shadow: "#0F172A",
};

const dark: Palette = {
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

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === "dark";
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
    1: { opacity: 0.06, radius: 3, offset: 1, elevation: 1 },
    2: { opacity: 0.1, radius: 12, offset: 4, elevation: 4 },
  }[level];
  return {
    shadowColor: palette.shadow,
    shadowOpacity: config.opacity,
    shadowRadius: config.radius,
    shadowOffset: { width: 0, height: config.offset },
    elevation: config.elevation,
  };
}
