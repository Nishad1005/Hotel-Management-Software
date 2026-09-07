/**
 * Design tokens — "Estate Heritage".
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
 * judges in ten seconds. The palette went industrial slate → warm terracotta → this:
 * deep forest structure, brass accents, warm linen ground, a serif for the editorial
 * layer. The through-line across all three is unchanged and is the actual rule — a warm
 * light page, white cards raised above it, and **colour kept scarce** so that when
 * something IS coloured (expiring, blocked, rejected) it means something. Estate
 * Heritage adds a register of luxury; it does not add permission to badge everything.
 *
 * ## Brass is not an ink
 *
 * The one trap in this palette, measured rather than assumed. Brass at its brand values
 * — `#DCB879`, `#C5A059` — reaches 1.9:1 and 2.5:1 on white. It is a *material*: a
 * hairline, a fill, an indicator on a dark rail. Where brass has to carry a word, the
 * ink is `brass` (#7A5F22, 5.2:1 on its own tint); where it only has to be seen,
 * `brassLine` (#9A7B38) clears the 3:1 that WCAG asks of a graphic. Reaching for the
 * bright brass because it looks more like brass is how this palette gets an
 * illegible screen, so the two are named apart.
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
  desk: 44,
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
 * So this is five sizes where there were eight: 32 / 22 / 17 / 15 / 13. `label` and
 * `caption` share 13 in `text` below — the difference between a field label and a row's
 * metadata was always weight and colour, never size.
 *
 * `subheading` and `micro` are gone. They survived the first pass as aliases so that
 * migrating a screen would not also mean editing its every call site; every screen has
 * migrated, so the aliases have no callers left. **Nothing new should reference this
 * object.** It exists for the handful of `TextInput`s that genuinely need a bare
 * `fontSize`; everything with words in it says `role` on `Text` instead.
 */
export const type = {
  display: 32,
  title: 22,
  heading: 17,
  body: 15,
  label: 13,
  caption: 13,
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
 * Typography — two families, one job each.
 *
 * **Plus Jakarta Sans** carries everything functional: data, vendor names, quantities,
 * statuses, timestamps, buttons. It is a geometric humanist grotesque with a tall
 * x-height and genuine tabular figures, and that last property matters more here than
 * it sounds, because this app is mostly numbers in columns.
 *
 * **Playfair Display** carries the editorial layer only: screen titles and the single
 * large figure on a tile. It is a high-contrast display serif — magnificent at 32px,
 * fragile at 13 — so it is deliberately confined to the two roles that are always large
 * and never dense.
 *
 * `font()` returns fontWeight alongside fontFamily deliberately. If the font has not
 * loaded — slow first paint, a cache miss, a native build without the asset — the
 * weight still applies and the screen degrades to the system face, instead of
 * flattening to a single undifferentiated weight.
 */
export const fontFamily = {
  sans: {
    regular: "PlusJakartaSans_400Regular",
    medium: "PlusJakartaSans_500Medium",
    semibold: "PlusJakartaSans_600SemiBold",
    bold: "PlusJakartaSans_700Bold",
    heavy: "PlusJakartaSans_800ExtraBold",
  },
  /**
   * Playfair carries no 500, and its 400 is too fine to hold a page title against a
   * linen ground, so the lighter three weights all resolve to 600 — the weight the
   * design system specifies for every serif role it has. `bold` and `heavy` reach for
   * 700 so a serif `display` still outweighs a serif `title`.
   */
  serif: {
    regular: "PlayfairDisplay_600SemiBold",
    medium: "PlayfairDisplay_600SemiBold",
    semibold: "PlayfairDisplay_600SemiBold",
    bold: "PlayfairDisplay_700Bold",
    heavy: "PlayfairDisplay_700Bold",
  },
} as const;

export type FamilyName = keyof typeof fontFamily;
export type WeightName = keyof (typeof fontFamily)["sans"];

/**
 * Defaults to sans, because the overwhelming majority of call sites are functional text
 * and an explicit `"sans"` at every one of them would be noise. The serif is opted into,
 * which is the correct default for a family that must stay scarce.
 */
export function font(w: WeightName, family: FamilyName = "sans") {
  return { fontFamily: fontFamily[family][w], fontWeight: weight[w] } as const;
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
   * Which of the two families this role is set in. Present on every role for the same
   * reason `textTransform` is: a role is a complete instruction, and an optional family
   * would mean every call site deciding what "unset" means.
   */
  family: FamilyName;
  /**
   * Always present, never optional. An optional member here would be `"uppercase" |
   * undefined` at the one call site that reads it, which `exactOptionalPropertyTypes`
   * rejects — and working around that with a conditional spread is how a primitive used
   * on every row starts collecting special cases.
   */
  textTransform: "none" | "uppercase";
}

export const text = {
  /**
   * The one big figure on a tile. Never a sentence.
   *
   * Serif, and the clearest case for it: the design system calls this `title-metric` and
   * makes it the signature of the whole identity. Lighter than the old `heavy` because
   * Playfair at 32px carries authority through contrast rather than mass — the extra
   * weight only muddied its thin strokes.
   */
  display: {
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.6,
    weight: "bold",
    family: "serif",
    textTransform: "none",
  },
  /** Screen titles. The other serif role, and the last one. */
  title: {
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
    weight: "semibold",
    family: "serif",
    textTransform: "none",
  },
  /**
   * Card headings, and the figure at the end of a list row.
   *
   * Sans, against the brief's first suggestion of Playfair here, and the reason is the
   * second half of that sentence: this role sets *figures in a column*. Playfair has no
   * tabular figures, so every quantity in every list would jog sideways as its digits
   * changed — and 17px is also where the brief itself flags the serif as a risk on
   * Android. Both point the same way, so the serif stops at `title`.
   */
  heading: {
    fontSize: 17,
    lineHeight: 24,
    letterSpacing: -0.2,
    weight: "semibold",
    family: "sans",
    textTransform: "none",
  },
  /** Prose, field values, button labels, the name in a list row. The workhorse. */
  body: {
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
    weight: "regular",
    family: "sans",
    textTransform: "none",
  },
  /** The metadata line under a name. The 15 → 13 gap is what makes a list scannable. */
  label: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
    weight: "regular",
    family: "sans",
    textTransform: "none",
  },
  /** Tertiary — hints, and a third line only where one is genuinely conditional. */
  caption: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
    weight: "regular",
    family: "sans",
    textTransform: "none",
  },
  /**
   * Uppercase section labels, technical badges and pills, and nothing else.
   *
   * 11px is not a content size. It was used as one 32 times, which is where "compensate
   * with colour" came from — you cannot make 11px carry meaning any other way. It earns
   * its place here only because uppercase, weight and tracking do the work instead.
   *
   * This IS the design system's `label-caps`, retuned to its tracking (0.12em ≈ 1.3 at
   * 11px) rather than added beside the existing role as a second one. Two uppercase
   * 11px roles separated by 0.4 of tracking and one weight step would be precisely the
   * near-duplicate this ramp was collapsed from eight sizes to five to eliminate, and
   * the next author would have no way to choose between them. Kept at 11px, not the
   * system's 10.5 — this is read in gloves.
   */
  overline: {
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.3,
    weight: "semibold",
    family: "sans",
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
  /**
   * Brass, in the three forms it can legibly take. See the note at the top of this file:
   * the bright brass of the brand is a material, not an ink, and these are named so that
   * choosing wrongly is harder than choosing rightly.
   */
  /** Brass that carries a word. Clears AA on every light ground including its own tint. */
  brass: string;
  /** Brass that only has to be seen: hairlines, focus rings, indicators. 3:1 class. */
  brassLine: string;
  /** The brass chip ground, and any panel that wants warmth without state. */
  brassSurface: string;
  /** Brass on a dark rail, where the bright brand value is finally legible. */
  brassOnBrand: string;
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
 * Estate Heritage — linen ground, forest structure, brass detail.
 *
 * The warmth is in the neutrals, not just the accent. Every surface here carries a
 * little yellow-red so the linen reads as unbleached cloth rather than dirty white, and
 * so the forest and brass sitting on it agree with it rather than fighting it. A cold
 * grey under a warm accent looks like an accident.
 *
 * Every value below was measured, not eyeballed, against all four grounds an ink can
 * land on — its own tinted surface, the page, a card, and a sunken input — because the
 * last two palettes each shipped a colour that passed on the page and failed on the
 * surface it was actually used on.
 */
const light: Palette = {
  background: "#FAF9F5",
  surface: "#FFFFFF",
  surfaceRaised: "#FFFFFF",
  surfaceSunken: "#F5F2EB",
  border: "#E8E3D7",
  borderStrong: "#A39E93",
  text: "#191C1B",
  textMuted: "#555E58",
  /**
   * The third ink, and the one that moves between surfaces — placeholders and glyphs
   * inside `surfaceSunken` inputs as well as on cards and the page.
   *
   * `#646D67` clears 4.5:1 on all three (page 5.08, card 5.35, sunken 4.79). The
   * palette's own `outline` (#A39E93) is the obvious-looking choice here and reaches
   * only 2.39:1 on a sunken input — it is a border colour, and using it as a third ink
   * is exactly the mistake the previous two palettes made in turn.
   *
   * It remains decoration only. The palette has room for three text colours at most;
   * hierarchy comes from size, weight and space.
   */
  textFaint: "#646D67",
  primary: "#0D2818",
  onPrimary: "#FAF9F5",
  brand: "#081C15",
  onBrand: "#FAF9F5",
  /** 6.8:1 on the forest rail — a muted voice, still a legible one. */
  onBrandMuted: "#8FA69A",
  /**
   * Action is forest, not brass.
   *
   * The obvious reading of a brass-accented identity is a brass button, and it does not
   * survive contact with a contrast checker: brass on white is 2.5:1, so a brass button
   * needs dark text on it and stops looking like brass. The design system agrees —
   * primary actions are `forest-800` with linen text and a brass *edge*. Brass stays a
   * detail, which is what makes it read as metal rather than as paint.
   */
  accent: "#0D2818",
  onAccent: "#FAF9F5",
  /** Warm rather than green: a tinted panel should not read as a forest button. */
  accentSurface: "#F5EEDC",
  brass: "#7A5F22",
  brassLine: "#9A7B38",
  brassSurface: "#F5EEDC",
  brassOnBrand: "#C5A059",
  /**
   * Sage for health, saffron for urgency, and the system's own error red.
   *
   * Each ink is the design system's `-700` step rather than its `-500`: the 500s are
   * specified for *borders at 30% opacity*, and reading them as text colours puts
   * saffron at 3.07:1 on its own chip. The 700s clear AA on all four grounds.
   */
  success: "#2D4735",
  successSurface: "#F2F6F3",
  warning: "#9C5914",
  warningSurface: "#FEF7ED",
  danger: "#BA1A1A",
  dangerSurface: "#FFDAD6",
  /**
   * The keyboard focus indicator, and the one place brass earns a functional job.
   *
   * The previous palette needed three different focus colours because its ring had no
   * single background: a near-black ring was 14.88:1 on a card and 1.00:1 on the
   * terracotta button — invisible on the app's primary action. Brass is unusual in
   * clearing the 3:1 of WCAG 2.4.11 on *both* ends of this palette: 3.99:1 on a card,
   * 3.57:1 on a sunken input, and 3.95:1 on the forest button itself. One ring,
   * everywhere, which is one fewer thing to get wrong per control.
   *
   * Two pixels wide and only ever drawn on focus.
   */
  focus: "#9A7B38",
  /** Green-tinted, per the design system: warm ambient occlusion, never muddy grey. */
  shadow: "#143628",
};

/**
 * Kept, exported, and not currently selected.
 *
 * Exported rather than deleted because the gate device at night is a real requirement
 * (PRD section 4 Gate 0a), and a palette that is deleted has to be invented again from
 * nothing. It is cold slate with a mint accent, so it needs rebuilding before it is
 * switched on — the two themes have to agree about the brand, and the gap just widened:
 * light is now forest and brass, and this is still the industrial slate that light was
 * two identities ago. Rebuilding it is a deliberate piece of work, not a find-replace,
 * and it belongs with whoever specifies the night-shift device.
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
  // Present so the palette satisfies its own interface, not because they have been
  // designed — see the note above. On a dark ground the bright brand brass is finally
  // the legible one, which is the only thing about this group that is already right.
  brass: "#DCB879",
  brassLine: "#C5A059",
  brassSurface: "#2A2113",
  brassOnBrand: "#DCB879",
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
  // Softer and wider than before, and tinted forest by `palette.shadow`: the design
  // system asks for `0 2px 14px rgba(20,54,40,.03)` on a card, which is barely a shadow
  // at all — the separation is meant to come from the champagne hairline, with the
  // shadow only keeping the card from looking pasted on. Level 2 stays heavier because
  // it lifts modals and drawers off the page entirely.
  const config = {
    1: { opacity: 0.04, radius: 14, offset: 2, elevation: 2 },
    2: { opacity: 0.08, radius: 28, offset: 8, elevation: 8 },
  }[level];
  return {
    shadowColor: palette.shadow,
    shadowOpacity: config.opacity,
    shadowRadius: config.radius,
    shadowOffset: { width: 0, height: config.offset },
    elevation: config.elevation,
  };
}
