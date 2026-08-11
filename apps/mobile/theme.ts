/**
 * Design tokens.
 *
 * Tuned for the two places this app is used: a security gate at night and a wet
 * receiving dock in daylight. That drives most of the unusual numbers here.
 *
 * - Touch targets start at 64, well above the 44pt/48dp platform minimum, because
 *   the user is wearing gloves and may be holding a torch.
 * - Text and surfaces are high contrast in both themes, because the screen is read
 *   in direct sun and in darkness on the same shift.
 * - Colour never carries meaning alone; every state also has an icon or a label.
 */

import { useColorScheme } from "react-native";

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/** Minimum interactive height. Gloves, not thumbs on a sofa. */
export const touch = {
  min: 64,
  large: 88,
} as const;

export const type = {
  display: 44,
  title: 28,
  heading: 20,
  body: 17,
  label: 15,
  caption: 13,
} as const;

/**
 * Both themes implement this contract, so a token added to one must be added to the
 * other. Deriving the type from the light palette instead would let dark drift.
 */
export interface Palette {
  background: string;
  surface: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  danger: string;
  dangerSurface: string;
}

const light: Palette = {
  background: "#F5F6F7",
  surface: "#FFFFFF",
  surfaceSunken: "#E9EBED",
  border: "#C9CDD2",
  borderStrong: "#8A9099",
  text: "#14171A",
  textMuted: "#565D66",
  accent: "#0B5FFF",
  accentText: "#FFFFFF",
  success: "#0F7A3D",
  successSurface: "#DFF3E7",
  warning: "#8A5300",
  warningSurface: "#FCEFD6",
  danger: "#B3261E",
  dangerSurface: "#FBE4E2",
};

const dark: Palette = {
  background: "#0E1113",
  surface: "#1A1E21",
  surfaceSunken: "#25292D",
  border: "#3A4046",
  borderStrong: "#69717A",
  text: "#F2F4F6",
  textMuted: "#AEB6BE",
  accent: "#5C9BFF",
  accentText: "#0E1113",
  success: "#5FD68C",
  successSurface: "#123122",
  warning: "#FFC46B",
  warningSurface: "#33260C",
  danger: "#FF8A80",
  dangerSurface: "#3A1614",
};

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}
