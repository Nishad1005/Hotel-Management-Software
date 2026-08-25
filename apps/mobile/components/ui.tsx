import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEscape } from "../lib/escape";
import { useIsExpanded } from "../lib/responsive";
import {
  elevation,
  font,
  radius,
  space,
  tabular,
  text as textStyles,
  touch,
  type,
  type Palette,
  type TextRole,
  usePalette,
} from "../theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
export type Density = "field" | "desk";

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

/**
 * Which palette slot the words are painted in.
 *
 * Named rather than passed as a colour, and that is the point: once screens say
 * `tone="muted"` instead of `color: p.textMuted`, the palette is honoured by
 * construction rather than by discipline. A colour cannot drift into a screen that has no
 * way to name one.
 */
export type TextTone =
  | "default"
  | "muted"
  | "faint"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "onAccent"
  | "onBrand"
  | "onBrandMuted";

const TONE_KEY: Record<TextTone, keyof Palette> = {
  default: "text",
  muted: "textMuted",
  faint: "textFaint",
  accent: "accent",
  success: "success",
  warning: "warning",
  danger: "danger",
  onAccent: "onAccent",
  onBrand: "onBrand",
  onBrandMuted: "onBrandMuted",
};

export interface TextOwnProps {
  /**
   * Required, and there is deliberately no `size` prop.
   *
   * Overriding the weight is legitimate — a semibold body is a list row's name.
   * Overriding the size is how eight sizes came back the first time.
   */
  role?: TextRole;
  tone?: TextTone;
  /** Overrides the role's default weight. */
  weight?: Parameters<typeof font>[0];
  /** Tabular figures, so a column of numbers does not jog sideways as digits change. */
  numeric?: boolean;
  align?: TextStyle["textAlign"];
  /** `numberOfLines`, spelled shorter because it is used on nearly every row. */
  lines?: number;
  /** Layout only — margins and flex. Typography belongs to `role`, `tone` and `weight`. */
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
}

/**
 * `role` is omitted from React Native's own props deliberately.
 *
 * RN added `role` as the ARIA-style accessibility prop, so intersecting the two collapsed
 * ours to `"heading"` — the single member the two unions happen to share, and a
 * bewildering error to read. Accessibility semantics stay available through
 * `accessibilityRole`, which every call site in this app already uses.
 */
export type TextProps = TextOwnProps & Omit<RNTextProps, "style" | "numberOfLines" | "role">;

/**
 * A word, styled by what it is rather than by how it looks.
 *
 * Before this existed, 192 of the app's 203 text elements hand-declared their own font
 * size, weight and colour — so there were 13 letter-spacings, six line heights, and more
 * than half of all type sitting at 11 or 12 pixels. Every one of those call sites was
 * already writing `fontSize` + `font()` + `color`, which is exactly `role` + `weight` +
 * `tone`; that is what makes replacing them mechanical rather than a judgement per line.
 *
 * Every prop has a default. With `exactOptionalPropertyTypes` on, optional props force
 * the `{...(x ? { x } : {})}` spread that already litters several screens, and a
 * typography primitive used on every row is the last place that should be necessary.
 */
export function Text({
  role = "body",
  tone = "default",
  weight,
  numeric = false,
  align,
  lines,
  style,
  children,
  ...rest
}: TextProps) {
  const p = usePalette();
  const token = textStyles[role];

  return (
    <RNText
      {...rest}
      {...(lines === undefined ? {} : { numberOfLines: lines })}
      style={[
        {
          fontSize: token.fontSize,
          lineHeight: token.lineHeight,
          letterSpacing: token.letterSpacing,
          color: p[TONE_KEY[tone]],
          textTransform: token.textTransform,
          ...font(weight ?? token.weight),
          ...(numeric ? tabular : {}),
          ...(align === undefined ? {} : { textAlign: align }),
        },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}

const heightFor = (d: Density) => (d === "field" ? touch.field : touch.desk);

/**
 * Press feedback changes colour only — never a transform that moves layout bounds. A
 * control that shifts under a thumb reads as a mis-tap.
 *
 * The focus ring is separate and must never be dropped: on web this app is driven by
 * keyboard at least as often as by touch, and an invisible focus state makes it
 * unusable without a mouse.
 */
function interactive(pressed: boolean, focused: boolean, hovered: boolean, p: Palette): ViewStyle {
  return {
    // Hover is weaker than press: it says "this responds", press says "you hit it".
    ...(hovered && !pressed ? { backgroundColor: p.surfaceSunken } : {}),
    ...(pressed ? { backgroundColor: p.border } : {}),
    ...(focused ? { borderColor: p.focus, borderWidth: 2 } : {}),
    // react-native-web does not set a pointer cursor from onPress alone.
    cursor: "pointer",
  } as ViewStyle;
}

/** Shared hover/focus plumbing, so no interactive component forgets either. */
function useInteractionState() {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return {
    hovered,
    focused,
    handlers: {
      onHoverIn: () => setHovered(true),
      onHoverOut: () => setHovered(false),
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
  };
}

/**
 * A tappable glyph, with the states a tappable thing needs.
 *
 * There was no such primitive, so roughly thirty raw `Pressable`s were hand-rolled across
 * the screens and every one of them quietly skipped the hover, focus and pointer-cursor
 * plumbing that `interactive()` right above provides. Two of those were the back chevron
 * and the close button — which appear on *every* screen and every modal, and so were the
 * app's most-used controls while looking, to a mouse, entirely inert.
 *
 * That is an accessibility regression rather than a cosmetic one: `usePalette`'s own note
 * says keyboard navigation on web "is not optional".
 */
export function IconButton({
  icon,
  label,
  onPress,
  size = 22,
  tone = "default",
  disabled = false,
}: {
  icon: IoniconName;
  /** Spoken, not shown. An icon-only control is unusable without it. */
  label: string;
  onPress: () => void;
  size?: number;
  tone?: "default" | "muted" | "accent" | "danger" | "onBrand";
  disabled?: boolean;
}) {
  const p = usePalette();
  const { hovered, focused, handlers } = useInteractionState();

  const colour =
    tone === "accent"
      ? p.accent
      : tone === "danger"
        ? p.danger
        : tone === "muted"
          ? p.textMuted
          : tone === "onBrand"
            ? p.onBrand
            : p.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={8}
      {...handlers}
      style={({ pressed }) =>
        ({
          width: touch.desk,
          height: touch.desk,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.md,
          backgroundColor: disabled
            ? "transparent"
            : pressed
              ? p.border
              : hovered
                ? p.surfaceSunken
                : "transparent",
          borderWidth: focused ? 2 : 0,
          borderColor: p.focus,
          cursor: disabled ? "not-allowed" : "pointer",
        }) as ViewStyle
      }
    >
      {/*
        Muted ink rather than `opacity: 0.4`, which took the glyph to 2.47:1 — under the
        3:1 that a meaningful icon needs. A disabled control still has to be readable;
        that is what tells you which control is unavailable.
      */}
      <Ionicons name={icon} size={size} color={disabled ? p.textMuted : colour} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

export function Header({
  title,
  subtitle,
  onBack,
  right,
  onBrand = false,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  /**
   * Painted for the brand band rather than the page surface.
   *
   * Exactly one screen needs it — the vendor console, which is a different product from
   * the one below it, and looking different is how somebody holding both kinds of access
   * knows which they are in.
   */
  onBrand?: boolean;
}) {
  const router = useRouter();

  /**
   * A back chevron only when there is genuinely something behind you.
   *
   * Every screen passes `onBack`, which was right when the chevron was the *only* way to
   * leave a screen. With a sidebar it is not, and on web a link opened or reloaded
   * directly — `/receipts/{id}` mailed to the accountant — has an empty history, so the
   * chevron was offering a journey that did not exist. `canGoBack()` is the question
   * actually being asked.
   */
  const showBack = !!onBack && router.canGoBack();

  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.lg }}>
      {showBack && onBack ? (
        <View style={{ marginLeft: -space.sm, marginRight: space.xs }}>
          <IconButton
            icon="chevron-back"
            label="Back"
            size={24}
            tone={onBrand ? "onBrand" : "default"}
            onPress={onBack}
          />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text role="title" tone={onBrand ? "onBrand" : "default"} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text
            role="label"
            tone={onBrand ? "onBrandMuted" : "muted"}
            style={{ marginTop: space.xxs }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/**
 * The frame every screen wears: a header band, a content column, and an optional
 * sticky footer.
 *
 * This was copy-pasted twenty-five times, and the copies had drifted — four different top
 * paddings, four incompatible ways of reserving room at the bottom of the scroll, and
 * seven hand-built action bars that each decided their own height and inset. That is not
 * untidiness; it is why the screens do not look like one product.
 *
 * The band's top inset is the subtle part. On a phone the shell draws a top bar which has
 * already consumed the status bar, so adding it again here would push every title down by
 * the height of the notch. Only the desktop layout, where the content pane starts at the
 * very top of the window, needs it.
 */
export function Screen({
  title,
  subtitle,
  onBack,
  actions,
  band,
  footer,
  children,
  wide = false,
  scroll = true,
  onBrand = false,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  /** Right of the title — an add button, a filter. */
  actions?: ReactNode;
  /** Under the title, inside the band — a search field, a segmented control. */
  band?: ReactNode;
  /** Pinned to the bottom, above the safe area. The screen's commit action. */
  footer?: ReactNode;
  children: ReactNode;
  /** 1080px instead of the 720px reading measure, for grids and tables. */
  wide?: boolean;
  /** Off when the child scrolls itself — a FlatList, a split pane. */
  scroll?: boolean;
  /** The brand band. See `Header`'s `onBrand` — one screen uses it. */
  onBrand?: boolean;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const expanded = useIsExpanded();

  const body = (
    <Page wide={wide}>
      {children}
      {/* Enough room to scroll the last row clear of a sticky footer. */}
      {scroll ? <View style={{ height: footer ? space.xxl : space.xl }} /> : null}
    </Page>
  );

  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <View
        style={[
          {
            backgroundColor: onBrand ? p.brand : p.surface,
            paddingTop: (expanded ? insets.top : 0) + space.lg,
            paddingHorizontal: space.lg,
            paddingBottom: band ? space.md : space.sm,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: onBrand ? p.brand : p.border,
          },
          elevation(1, p),
        ]}
      >
        <Page wide={wide}>
          <Header
            title={title}
            onBrand={onBrand}
            {...(subtitle === undefined ? {} : { subtitle })}
            {...(onBack === undefined ? {} : { onBack })}
            {...(actions === undefined ? {} : { right: actions })}
          />
          {band}
        </Page>
      </View>

      {scroll ? (
        <ScrollView
          contentContainerStyle={{
            padding: space.lg,
            paddingBottom: footer ? space.lg : insets.bottom + space.lg,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, padding: space.lg }}>{body}</View>
      )}

      {footer ? (
        <View
          style={[
            {
              backgroundColor: p.surface,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: p.border,
              paddingHorizontal: space.lg,
              paddingTop: space.md,
              paddingBottom: space.md + insets.bottom,
            },
            elevation(2, p),
          ]}
        >
          <Page wide={wide}>{footer}</Page>
        </View>
      ) : null}
    </View>
  );
}

/**
 * What just happened, and its number.
 *
 * Seven screens ended in a success panel and all seven were built separately — different
 * circle sizes, different eyebrow tracking, one that centred its caption and one that did
 * not, and only some of them making the document number selectable. The number is the
 * whole point of these screens: it is what gets written onto a challan by hand, read down
 * a phone, or pasted into an email, so it is `selectable`, tabular and the largest thing
 * on the page.
 */
export function Result({
  icon = "checkmark",
  tone = "good",
  eyebrow,
  value,
  caption,
  children,
  actions,
}: {
  icon?: IoniconName;
  tone?: "good" | "warn";
  /** The state reached — "Issued", "Recorded", "Posted". */
  eyebrow: string;
  /** The document number. */
  value: string;
  caption?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const colour = tone === "warn" ? p.warning : p.success;
  const surface = tone === "warn" ? p.warningSurface : p.successSurface;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: p.background }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        padding: space.lg,
        paddingBottom: insets.bottom + space.lg,
      }}
    >
      <Page>
        <Card>
          <View style={{ alignItems: "center", marginBottom: space.lg }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: radius.xl,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: surface,
              }}
            >
              <Ionicons name={icon} size={30} color={colour} />
            </View>
            <Text role="overline" tone="muted" style={{ marginTop: space.lg }}>
              {eyebrow}
            </Text>
            <Text role="title" weight="heavy" numeric selectable style={{ marginTop: space.xs }}>
              {value}
            </Text>
            {caption ? (
              <Text role="label" tone="muted" align="center" style={{ marginTop: space.xs }}>
                {caption}
              </Text>
            ) : null}
          </View>
          {children}
        </Card>
        {actions ? <View style={{ marginTop: space.xl }}>{actions}</View> : null}
      </Page>
    </ScrollView>
  );
}

export function Section({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ marginBottom: space.xl }}>
      {title ? (
        <Text
          accessibilityRole="header"
          role="overline"
          tone="muted"
          style={{ marginBottom: hint ? space.xxs : space.sm }}
        >
          {title}
        </Text>
      ) : null}
      {hint ? (
        <Text role="caption" tone="muted" style={{ marginBottom: space.sm }}>
          {hint}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/** A raised container. Groups rows into one object rather than scattered cards. */
export function Card({ children, padded = true }: { children: ReactNode; padded?: boolean }) {
  const p = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: p.surfaceRaised,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: p.border,
          overflow: "hidden",
          ...(padded ? { padding: space.lg } : {}),
        },
        elevation(1, p),
      ]}
    >
      {children}
    </View>
  );
}

/**
 * Constrains content on wide screens. Full-width text is unreadable on a laptop.
 *
 * 720px is a reading measure — right for a form, a receipt or a column of prose, and it is
 * what every screen has used. It is wrong for a grid of figures, which has no measure to
 * respect and simply wants the room, so a dashboard can ask for `wide` instead.
 *
 * `wide` is 1200, not the 1080 it started at. With a 264px sidebar beside it, 1080 left a
 * 1440px laptop with a visible gutter on the right and nothing in it.
 */
export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <View style={{ width: "100%", maxWidth: wide ? 1200 : 720, alignSelf: "center" }}>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Rows and actions
// ---------------------------------------------------------------------------

export function Row({
  icon,
  label,
  value,
  onPress,
  density = "desk",
  selected,
  trailing,
  divider,
  tint,
}: {
  icon?: IoniconName;
  label: string;
  value?: string;
  onPress?: () => void;
  density?: Density;
  selected?: boolean;
  trailing?: ReactNode;
  divider?: boolean;
  tint?: "accent" | "danger";
}) {
  const p = usePalette();
  const { hovered, focused, handlers } = useInteractionState();
  const iconColour = selected ? p.accent : tint === "danger" ? p.danger : p.textMuted;

  const body = (
    <>
      {icon ? (
        <View
          style={{
            width: density === "field" ? 40 : 32,
            height: density === "field" ? 40 : 32,
            borderRadius: radius.sm,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: selected ? p.accentSurface : p.surfaceSunken,
            marginRight: space.md,
          }}
        >
          <Ionicons name={icon} size={density === "field" ? 22 : 18} color={iconColour} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          role={density === "field" ? "heading" : "body"}
          weight="semibold"
          tone={tint === "danger" ? "danger" : "default"}
          lines={1}
        >
          {label}
        </Text>
        {value ? (
          <Text role="caption" tone="muted" lines={1} style={{ marginTop: 1 }}>
            {value}
          </Text>
        ) : null}
      </View>
      {trailing ??
        (selected ? (
          <Ionicons name="checkmark" size={20} color={p.accent} />
        ) : onPress ? (
          <Ionicons name="chevron-forward" size={18} color={p.textFaint} />
        ) : null)}
    </>
  );

  const style: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    minHeight: heightFor(density),
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
    borderBottomColor: p.border,
  };

  if (!onPress) return <View style={style}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}. ${value}` : label}
      {...handlers}
      style={({ pressed }) => [style, interactive(pressed, focused, hovered, p)]}
    >
      {body}
    </Pressable>
  );
}

/**
 * The one button, with a real hierarchy behind it.
 *
 * `tone="neutral"` was used 32 times against `accent`'s 27 — so most buttons in the app
 * were a filled grey slab, the same height and weight as the orange one, whose only job
 * was being "not the primary". Two same-sized filled rectangles side by side is not a
 * hierarchy; it is a choice presented twice.
 *
 * Neutral now maps to an OUTLINE, which is what a secondary action has always wanted to
 * be: same footprint, obviously subordinate, and it stops competing for the eye. The prop
 * name is unchanged on purpose — thirty-two call sites get a real secondary button
 * without being edited, and `variant` is there for new code that wants to say so
 * directly.
 */
export type ButtonVariant = "solid" | "outline" | "ghost";

export function PrimaryButton({
  label,
  icon,
  onPress,
  disabled,
  tone = "accent",
  variant,
  loading = false,
  density = "desk",
}: {
  label: string;
  icon?: IoniconName;
  onPress: () => void;
  disabled?: boolean;
  tone?: "accent" | "neutral" | "danger";
  /** Defaults from `tone`: neutral is an outline, accent and danger are solid. */
  variant?: ButtonVariant;
  /**
   * Shows a spinner and blocks the press.
   *
   * Screens were faking this by swapping the label to "Staging…", which loses the button
   * width, reads as a state change rather than progress, and leaves the control pressable
   * while the request is in flight.
   */
  loading?: boolean;
  density?: Density;
}) {
  const p = usePalette();
  const { hovered, focused, handlers } = useInteractionState();

  const shape: ButtonVariant = variant ?? (tone === "neutral" ? "outline" : "solid");
  const accentColour = tone === "danger" ? p.danger : tone === "neutral" ? p.text : p.accent;
  const inert = disabled || loading;

  /**
   * Disabled is a colour, not a transparency.
   *
   * `opacity: 0.4` on the whole control composited white-on-terracotta down to **1.87:1**
   * against the page — worse than any static pair in the palette, and the reason the
   * button was described as "pale salmon, looks permanently disabled". Group opacity does
   * that: it fades the label and the fill towards the background together, so the two
   * converge and the contrast collapses. The measurement never showed it because the
   * palette was only ever checked as token-against-token.
   *
   * A stated disabled surface instead — sunken fill, muted ink — reads as deliberately
   * off at 4.63:1 rather than half-rendered.
   */
  const bg = inert
    ? p.surfaceSunken
    : shape === "solid"
      ? accentColour
      : shape === "outline"
        ? p.surface
        : "transparent";
  const fg = inert ? p.textMuted : shape === "solid" ? p.onAccent : accentColour;

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inert, busy: loading }}
      {...handlers}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          minHeight: heightFor(density),
          borderRadius: radius.md,
          paddingHorizontal: space.xl,
          backgroundColor: pressed && shape !== "solid" && !inert ? p.surfaceSunken : bg,
          // Press and hover still dip the whole control, because there the label and the
          // fill are both legible at either end of the range. Disabled does not.
          opacity: inert ? 1 : pressed ? 0.85 : hovered ? 0.94 : 1,
          // The focus ring replaces the outline rather than stacking on it, so an
          // outlined button does not gain a second border when tabbed to.
          borderWidth: focused ? 2 : shape === "outline" || inert ? StyleSheet.hairlineWidth : 0,
          borderColor: focused ? p.focus : p.borderStrong,
          cursor: inert ? "not-allowed" : "pointer",
        } as ViewStyle,
        shape === "solid" && !inert ? elevation(1, p) : {},
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} style={{ marginRight: space.sm }} />
      ) : icon ? (
        <Ionicons name={icon} size={18} color={fg} />
      ) : null}
      <Text weight="semibold" style={{ color: fg, marginLeft: icon && !loading ? space.sm : 0 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ChoiceTile({
  icon,
  label,
  selected,
  onPress,
  disabled = false,
  hint,
}: {
  icon: IoniconName;
  label: string;
  selected: boolean;
  onPress: () => void;
  /**
   * Shown, but not offered.
   *
   * Hiding an unbuilt option would be tidier and worse: the guard cannot tell whether
   * the app lacks the feature or they have missed it, and the first thing they do is
   * look for it again. Greyed out with a reason answers the question once.
   */
  disabled?: boolean;
  hint?: string;
}) {
  const p = usePalette();
  const { hovered, focused, handlers } = useInteractionState();
  const live = !disabled;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      {...(live ? handlers : {})}
      style={({ pressed }) =>
        ({
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: space.lg,
          paddingHorizontal: space.sm,
          borderRadius: radius.md,
          borderWidth: selected || (focused && live) ? 2 : StyleSheet.hairlineWidth,
          borderColor:
            focused && live
              ? p.focus
              : selected
                ? p.accent
                : hovered && live
                  ? p.borderStrong
                  : p.border,
          // A sunken fill says unavailable where `opacity: 0.45` said 2.92:1.
          backgroundColor: !live
            ? p.surfaceSunken
            : selected
              ? p.accentSurface
              : pressed || hovered
                ? p.surfaceSunken
                : p.surface,
          cursor: live ? "pointer" : "not-allowed",
        }) as ViewStyle
      }
    >
      <Ionicons name={icon} size={22} color={selected && live ? p.accent : p.textMuted} />
      <Text
        role="label"
        weight="semibold"
        tone={!live ? "muted" : selected ? "accent" : "default"}
        align="center"
        style={{ marginTop: space.xs }}
      >
        {label}
      </Text>
      {hint ? (
        <Text role="caption" tone="muted" align="center" style={{ marginTop: 2 }}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Large stepper — a gloved-hands control, so it keeps field sizing everywhere. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 9999,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
}) {
  const p = usePalette();
  const button = (dir: -1 | 1, icon: IoniconName, label: string) => {
    const next = value + dir;
    const disabled = next < min || next > max;
    return (
      <Pressable
        onPress={() => onChange(next)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        style={({ pressed }) => ({
          width: touch.field,
          height: touch.field,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.md,
          backgroundColor: disabled ? p.surfaceSunken : pressed ? p.surfaceSunken : p.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: p.border,
        })}
      >
        {/* 26px of glyph at `opacity: 0.35` was 2.17:1. The floor of a stepper is a
            control a gloved hand has to find, not one that fades out. */}
        <Ionicons name={icon} size={26} color={disabled ? p.textMuted : p.text} />
      </Pressable>
    );
  };

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: p.surfaceSunken,
        borderRadius: radius.lg,
        padding: space.xs,
      }}
    >
      {button(-1, "remove", "One fewer")}
      <Text
        accessibilityLiveRegion="polite"
        role="display"
        weight="bold"
        numeric
        align="center"
        style={{ flex: 1 }}
      >
        {value}
      </Text>
      {button(1, "add", "One more")}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize = "none",
  hint,
  error,
  suffix,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "numeric" | "decimal-pad";
  autoCapitalize?: "none" | "characters" | "words" | "sentences";
  hint?: string;
  error?: string;
  suffix?: string;
}) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text role="label" weight="semibold" style={{ marginBottom: space.xs }}>
        {label}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderWidth: focused || error ? 2 : StyleSheet.hairlineWidth,
          borderColor: error ? p.danger : focused ? p.focus : p.border,
          borderRadius: radius.md,
          backgroundColor: p.surface,
          paddingRight: suffix ? space.md : 0,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? ""}
          placeholderTextColor={p.textFaint}
          secureTextEntry={secureTextEntry ?? false}
          keyboardType={keyboardType ?? "default"}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={label}
          style={
            {
              flex: 1,
              minHeight: touch.desk,
              paddingHorizontal: space.md,
              fontSize: type.body,
              color: p.text,
              // Web only: the browser's own outline would sit outside our border.
              outlineStyle: "none",
            } as never
          }
        />
        {suffix ? (
          <Text role="label" tone="muted" weight="medium">
            {suffix}
          </Text>
        ) : null}
      </View>
      {hint && !error ? (
        <Text role="caption" tone="muted" style={{ marginTop: space.xs }}>
          {hint}
        </Text>
      ) : null}
      {error ? <FieldError message={error} /> : null}
    </View>
  );
}

export function Toggle({
  label,
  hint,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const p = usePalette();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: touch.desk,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: value ? p.accent : p.border,
        backgroundColor: value ? p.accentSurface : p.surface,
        marginBottom: space.sm,
        opacity: disabled ? 0.65 : 1,
      }}
    >
      <View style={{ flex: 1, marginRight: space.md }}>
        <Text weight="semibold">{label}</Text>
        {hint ? (
          <Text role="caption" tone="muted" style={{ marginTop: space.xxs }}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled ?? false}
        accessibilityLabel={label}
        trackColor={{ true: p.accent, false: p.borderStrong }}
      />
    </View>
  );
}

/**
 * The band's search box.
 *
 * Two screens had built this by hand and the copies had already diverged — a 16px glyph
 * against a 17px one, and only one of them offering a way to clear the field. It belongs
 * in the header band rather than the scroll, because a filter that scrolls away is a
 * filter you cannot tell is still applied.
 */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  label = "Search",
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  label?: string;
}) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderWidth: focused ? 2 : StyleSheet.hairlineWidth,
        borderColor: focused ? p.focus : p.border,
        borderRadius: radius.md,
        backgroundColor: p.surfaceSunken,
        paddingHorizontal: space.md,
      }}
    >
      <Ionicons name="search" size={17} color={p.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={p.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={
          {
            flex: 1,
            minHeight: touch.desk,
            paddingHorizontal: space.sm,
            fontSize: textStyles.body.fontSize,
            color: p.text,
            outlineStyle: "none",
          } as never
        }
      />
      {value ? (
        <IconButton
          icon="close-circle"
          label="Clear the search"
          size={17}
          onPress={() => onChangeText("")}
        />
      ) : null}
    </View>
  );
}

export interface Choice {
  id: string;
  label: string;
  sublabel?: string;
}

export function SelectRow({
  label,
  value,
  placeholder,
  choices,
  onSelect,
  error,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  choices: Choice[];
  onSelect: (id: string) => void;
  error?: string;
}) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const selected = choices.find((c) => c.id === value);
  const filtered = query.trim()
    ? choices.filter((c) =>
        (c.label + " " + (c.sublabel ?? "")).toLowerCase().includes(query.toLowerCase()),
      )
    : choices;

  return (
    <View style={{ marginBottom: space.lg }}>
      <Text role="label" weight="semibold" style={{ marginBottom: space.xs }}>
        {label}
      </Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${selected ? selected.label : placeholder}`}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          minHeight: touch.desk,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderWidth: focused || error ? 2 : StyleSheet.hairlineWidth,
          borderColor: error ? p.danger : focused ? p.focus : p.border,
          backgroundColor: pressed ? p.surfaceSunken : p.surface,
        })}
      >
        <Text tone={selected ? "default" : "muted"} style={{ flex: 1 }}>
          {selected ? selected.label : placeholder}
        </Text>
        {selected?.sublabel ? (
          <Text role="caption" tone="muted" style={{ marginRight: space.sm }}>
            {selected.sublabel}
          </Text>
        ) : null}
        <Ionicons name="chevron-down" size={18} color={p.textFaint} />
      </Pressable>
      {error ? <FieldError message={error} /> : null}

      <Dialog
        visible={open}
        title={label}
        onClose={() => setOpen(false)}
        {...(choices.length > 8
          ? {
              header: (
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search"
                  placeholderTextColor={p.textFaint}
                  accessibilityLabel="Search options"
                  style={
                    {
                      minHeight: touch.desk,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderRadius: radius.md,
                      paddingHorizontal: space.md,
                      marginTop: space.sm,
                      fontSize: type.body,
                      backgroundColor: p.surfaceSunken,
                      borderColor: p.border,
                      color: p.text,
                      outlineStyle: "none",
                    } as never
                  }
                />
              ),
            }
          : {})}
      >
        <Card padded={false}>
          {filtered.map((c, i) => (
            <Row
              key={c.id}
              label={c.label}
              {...(c.sublabel ? { value: c.sublabel } : {})}
              selected={c.id === value}
              divider={i < filtered.length - 1}
              onPress={() => {
                onSelect(c.id);
                setQuery("");
                setOpen(false);
              }}
            />
          ))}
          {filtered.length === 0 ? (
            <View style={{ padding: space.lg }}>
              <Text tone="muted" align="center">
                Nothing matches “{query.trim()}”.
              </Text>
            </View>
          ) : null}
        </Card>
      </Dialog>
    </View>
  );
}

export function CloseButton({ onPress }: { onPress: () => void }) {
  return <IconButton icon="close" label="Close" onPress={onPress} />;
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

/**
 * The dimmed ground behind an overlay. Warm, because every neutral in this palette is.
 *
 * Exported so the shell's drawer and every dialog dim the page by the same amount — two
 * overlays that disagree about how dark "behind" is look like a bug the moment one opens
 * over the other.
 */
export const SCRIM = "rgba(31, 27, 24, 0.55)";

/**
 * Something on top, sized to the screen it is on.
 *
 * Every overlay in this app was a full-screen `animationType="slide"` `Modal`, which is
 * the right thing on a phone and absurd on a laptop: choosing one of six reject reasons
 * took over 1440×900, and a twelve-line goods receipt meant twelve of those takeovers in a
 * row. There was also no Escape and no click-outside anywhere, so on a keyboard the only
 * way out was to find a small × with the mouse.
 *
 * So: a centred panel with a backdrop when there is room, the familiar bottom sheet when
 * there is not. Same component, same props, one decision.
 *
 * Deliberately not an anchored popover. That needs trigger measurement, viewport
 * collision and close-on-scroll, and it is the most expensive item in the plan for a
 * fraction of the gain — this removes the takeover, which was the actual complaint.
 */
export function Dialog({
  visible,
  title,
  onClose,
  children,
  header,
  footer,
  scroll = true,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Extra band content under the title — a search field, a filter row. */
  header?: ReactNode;
  footer?: ReactNode;
  /** Off when the child is itself a list that scrolls. */
  scroll?: boolean;
}) {
  const p = usePalette();
  const expanded = useIsExpanded();
  const insets = useSafeAreaInsets();

  useEscape(visible, onClose);

  const body = scroll ? (
    <ScrollView contentContainerStyle={{ padding: space.lg }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1 }}>{children}</View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType={expanded ? "fade" : "slide"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        style={{
          flex: 1,
          justifyContent: expanded ? "center" : "flex-end",
          alignItems: "center",
          padding: expanded ? space.xl : 0,
        }}
      >
        {/*
         * The backdrop is a sibling under the panel rather than its parent, so a press
         * that lands on the panel is never also a press on the backdrop. Wrapping the
         * panel in a Pressable is the usual way to write this and the usual way to make a
         * dialog close when you click its own heading.
         */}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]}
        />
        <View
          // Screen readers stop at the panel instead of wandering into the page behind it.
          accessibilityViewIsModal
          style={[
            {
              width: "100%",
              maxWidth: expanded ? 560 : undefined,
              maxHeight: expanded ? "88%" : "90%",
              backgroundColor: p.background,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              borderBottomLeftRadius: expanded ? radius.lg : 0,
              borderBottomRightRadius: expanded ? radius.lg : 0,
              overflow: "hidden",
            },
            elevation(2, p),
          ]}
        >
          <View
            style={{
              paddingHorizontal: space.lg,
              paddingTop: space.md,
              paddingBottom: header ? space.md : space.xs,
              backgroundColor: p.surface,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: p.border,
            }}
          >
            {/* The grab handle is a phone affordance and a distraction on a desktop. */}
            {expanded ? null : (
              <View
                style={{
                  alignSelf: "center",
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: p.border,
                  marginBottom: space.sm,
                }}
              />
            )}
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text role="heading" accessibilityRole="header" style={{ flex: 1 }} lines={1}>
                {title}
              </Text>
              <CloseButton onPress={onClose} />
            </View>
            {header}
          </View>

          {body}

          {footer ? (
            <View
              style={{
                paddingHorizontal: space.lg,
                paddingTop: space.md,
                paddingBottom: space.md + (expanded ? 0 : insets.bottom),
                backgroundColor: p.surface,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: p.border,
              }}
            >
              {footer}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

/**
 * One line that says what just happened, or what is about to.
 *
 * Distinct from `Notice`, which is a block that fills an empty screen. This is the strip
 * that appears above a list after a put-away posts, or when the outbox is behind — a
 * pattern that had been rebuilt seven times with its own padding, its own icon size and
 * its own idea of which surface tint goes with which colour.
 *
 * `accessibilityLiveRegion` matters more than it looks: the storekeeper who just scanned
 * a bin is looking at the scanner, not the screen, and a confirmation nobody is told about
 * is a confirmation that did not happen.
 */
export function Banner({
  icon,
  tone = "info",
  children,
}: {
  icon: IoniconName;
  tone?: "good" | "warn" | "bad" | "info";
  children: ReactNode;
}) {
  const p = usePalette();
  const colour =
    tone === "good"
      ? p.success
      : tone === "warn"
        ? p.warning
        : tone === "bad"
          ? p.danger
          : p.accent;
  const surface =
    tone === "good"
      ? p.successSurface
      : tone === "warn"
        ? p.warningSurface
        : tone === "bad"
          ? p.dangerSurface
          : p.accentSurface;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        backgroundColor: surface,
        borderRadius: radius.md,
        padding: space.md,
        marginBottom: space.lg,
      }}
    >
      <Ionicons name={icon} size={18} color={colour} />
      <Text role="label" weight="semibold" style={{ flex: 1, color: colour }}>
        {children}
      </Text>
    </View>
  );
}

/**
 * The shape of what is coming, while it is coming.
 *
 * A spinner says "wait"; a skeleton says "wait, and here is where the four figures and the
 * eleven rows will be". On a hotel's connection that difference is several seconds of the
 * screen not appearing to be broken, and it removes the layout jump that a spinner
 * guarantees — the spinner occupies 148px and the content that replaces it does not.
 *
 * The pulse is opacity on a plain block with no text in it, which is the one place group
 * opacity is safe: there is nothing to read, so there is no contrast to lose.
 *
 * Not yet wired into any screen. It lands with the per-screen sweep; building it here
 * means the sweep is mechanical rather than twenty separate judgements about what a
 * loading receipt list should look like.
 */
export function Skeleton({
  width = "100%",
  height = 16,
  radius: r = radius.sm,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(pulse, {
          toValue: 0.5,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== "web",
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      // Hidden from screen readers. A reader announcing eleven placeholder blocks is
      // worse than silence; the region that replaces them announces itself.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: r, backgroundColor: p.surfaceSunken, opacity: pulse },
        style,
      ]}
    />
  );
}

/**
 * Waiting, said once and the same way everywhere.
 *
 * There were twenty-four bare `ActivityIndicator`s across the screens in three sizes and
 * two colours, some centred, some not, some with a word beside them and most without. A
 * spinner is the first thing a user sees on every screen in this app; it should not be the
 * least considered thing on it.
 */
export function Loading({ label }: { label?: string }) {
  const p = usePalette();
  return (
    <View
      style={{ paddingVertical: space.xxxl, alignItems: "center", gap: space.md }}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? "Loading"}
    >
      <ActivityIndicator size="large" color={p.accent} />
      {label ? (
        <Text role="label" tone="muted">
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function FieldError({ message }: { message: string }) {
  const p = usePalette();
  return (
    <View
      style={{ flexDirection: "row", alignItems: "flex-start", marginTop: space.xs }}
      accessibilityRole="alert"
    >
      <Ionicons name="alert-circle" size={15} color={p.danger} style={{ marginTop: 1 }} />
      <Text role="caption" tone="danger" style={{ marginLeft: space.xs, flex: 1 }}>
        {message}
      </Text>
    </View>
  );
}

export function StatusPill({
  icon,
  label,
  tone,
}: {
  icon?: IoniconName;
  label: string;
  tone: "neutral" | "good" | "warn" | "bad";
}) {
  const p = usePalette();
  const c = {
    neutral: { fg: p.textMuted, bg: p.surfaceSunken },
    good: { fg: p.success, bg: p.successSurface },
    warn: { fg: p.warning, bg: p.warningSurface },
    bad: { fg: p.danger, bg: p.dangerSurface },
  }[tone];

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        backgroundColor: c.bg,
        borderRadius: radius.sm,
        paddingHorizontal: space.sm,
        paddingVertical: 3,
      }}
    >
      {icon ? <Ionicons name={icon} size={12} color={c.fg} /> : null}
      <Text
        role="caption"
        weight="semibold"
        style={{ color: c.fg, marginLeft: icon ? space.xs : 0 }}
      >
        {label}
      </Text>
    </View>
  );
}

export function Notice({
  icon,
  title,
  body,
  tone = "neutral",
  action,
}: {
  icon: IoniconName;
  title: string;
  body?: string;
  tone?: "neutral" | "bad";
  action?: ReactNode;
}) {
  const p = usePalette();
  const fg = tone === "bad" ? p.danger : p.textFaint;
  return (
    <View
      style={{ alignItems: "center", paddingVertical: space.xxxl, paddingHorizontal: space.xl }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.xl,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tone === "bad" ? p.dangerSurface : p.surfaceSunken,
        }}
      >
        <Ionicons name={icon} size={26} color={fg} />
      </View>
      <Text role="heading" align="center" style={{ marginTop: space.lg }}>
        {title}
      </Text>
      {body ? (
        <Text
          role="label"
          tone="muted"
          align="center"
          style={{ marginTop: space.sm, maxWidth: 380 }}
        >
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: space.xl }}>{action}</View> : null}
    </View>
  );
}

/**
 * A figure, with the thing it counts.
 *
 * The home screen was three cards of navigation rows and not one number on it — a
 * settings menu wearing a dashboard's clothes. For an operations product that is the
 * wrong shape: somebody opening this wants to know whether anything needs them today,
 * and the links belong under that answer rather than instead of it.
 *
 * The figure is set at display size in tabular numerals, so a row of these does not jog
 * sideways as digits change. `tone` is used sparingly and only where the number carries
 * a verdict — expired stock is red because it IS a problem, not because red looks lively.
 */
export function StatTile({
  label,
  value,
  caption,
  icon,
  tone = "neutral",
  onPress,
}: {
  label: string;
  value: number | string;
  caption?: string;
  icon: IoniconName;
  tone?: "neutral" | "accent" | "warn" | "bad";
  onPress?: () => void;
}) {
  const p = usePalette();
  const { hovered, focused, handlers } = useInteractionState();

  /**
   * A count of nothing recedes.
   *
   * Seven tiles rendering `0` in 32px near-black carried exactly the weight of the one
   * rendering `4` — so a dashboard where all the work is done looked identical, at a
   * glance, to one with four vehicles at the gate. The figure is the whole content of a
   * stat tile; if it cannot vary, the tile cannot inform.
   *
   * Zero is a real and good answer, so it stays legible at 4.96:1 rather than being
   * hidden. It just stops competing.
   */
  const empty = value === 0 || value === "0";
  const ink = empty
    ? p.textMuted
    : tone === "bad"
      ? p.danger
      : tone === "warn"
        ? p.warning
        : tone === "accent"
          ? p.accent
          : p.text;
  const wash =
    empty || tone === "neutral"
      ? p.surfaceSunken
      : tone === "bad"
        ? p.dangerSurface
        : tone === "warn"
          ? p.warningSurface
          : p.accentSurface;

  const inner = (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.md }}>
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: radius.sm,
            backgroundColor: wash,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={icon} size={17} color={ink} />
        </View>
        {onPress ? (
          <>
            <View style={{ flex: 1 }} />
            <Ionicons name="chevron-forward" size={15} color={p.textFaint} />
          </>
        ) : null}
      </View>

      <Text role="display" numeric style={{ color: ink }}>
        {value}
      </Text>
      <Text role="label" weight="semibold" lines={1} style={{ marginTop: space.xs }}>
        {label}
      </Text>
      {caption ? (
        <Text role="caption" tone="muted" lines={1} style={{ marginTop: 1 }}>
          {caption}
        </Text>
      ) : null}
    </>
  );

  const frame = (pressed: boolean) =>
    ({
      flexGrow: 1,
      flexBasis: 150,
      padding: space.lg,
      borderRadius: radius.lg,
      backgroundColor: p.surface,
      borderWidth: focused ? 2 : StyleSheet.hairlineWidth,
      borderColor: focused ? p.focus : hovered && onPress ? p.borderStrong : p.border,
      // Scale rather than a background change. The surface is already white on a tinted
      // page, so darkening it reads as a rendering glitch rather than a press.
      transform: [{ scale: pressed ? 0.98 : 1 }],
      cursor: onPress ? "pointer" : "default",
    }) as ViewStyle;

  if (!onPress) return <View style={frame(false)}>{inner}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}${caption ? `. ${caption}` : ""}`}
      {...handlers}
      style={({ pressed }) => frame(pressed)}
    >
      {inner}
    </Pressable>
  );
}

/**
 * Lays tiles out in a wrapping row.
 *
 * `flexBasis` with wrap rather than a breakpoint: the same code gives two columns on a
 * phone and four on a laptop without having to know which it is running on.
 */
export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>{children}</View>;
}
