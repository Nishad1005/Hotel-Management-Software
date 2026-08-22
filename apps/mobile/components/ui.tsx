import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
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
          backgroundColor: pressed ? p.border : hovered ? p.surfaceSunken : "transparent",
          borderWidth: focused ? 2 : 0,
          borderColor: p.focus,
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }) as ViewStyle
      }
    >
      <Ionicons name={icon} size={size} color={colour} />
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
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.lg }}>
      {onBack ? (
        <View style={{ marginLeft: -space.sm, marginRight: space.xs }}>
          <IconButton icon="chevron-back" label="Back" size={24} onPress={onBack} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <RNText
          accessibilityRole="header"
          style={{
            fontSize: type.title,
            ...font("bold"),
            color: p.text,
            letterSpacing: -0.4,
          }}
        >
          {title}
        </RNText>
        {subtitle ? (
          <RNText style={{ fontSize: type.label, color: p.textMuted, marginTop: space.xxs }}>
            {subtitle}
          </RNText>
        ) : null}
      </View>
      {right}
    </View>
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
  const p = usePalette();
  return (
    <View style={{ marginBottom: space.xl }}>
      {title ? (
        <RNText
          accessibilityRole="header"
          style={{
            fontSize: type.micro,
            ...font("bold"),
            letterSpacing: 0.9,
            textTransform: "uppercase",
            color: p.textFaint,
            marginBottom: hint ? space.xxs : space.sm,
          }}
        >
          {title}
        </RNText>
      ) : null}
      {hint ? (
        <RNText
          style={{
            fontSize: type.caption,
            color: p.textMuted,
            marginBottom: space.sm,
            lineHeight: 17,
          }}
        >
          {hint}
        </RNText>
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

/** Constrains content on wide screens. Full-width text is unreadable on a laptop. */
export function Page({ children }: { children: ReactNode }) {
  return <View style={{ width: "100%", maxWidth: 720, alignSelf: "center" }}>{children}</View>;
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
        <RNText
          numberOfLines={1}
          style={{
            fontSize: density === "field" ? type.subheading : type.body,
            ...font("semibold"),
            color: tint === "danger" ? p.danger : p.text,
          }}
        >
          {label}
        </RNText>
        {value ? (
          <RNText
            numberOfLines={1}
            style={{ fontSize: type.caption, color: p.textMuted, marginTop: 1 }}
          >
            {value}
          </RNText>
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

  const bg = shape === "solid" ? accentColour : shape === "outline" ? p.surface : "transparent";
  const fg = shape === "solid" ? p.onAccent : accentColour;
  const inert = disabled || loading;

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
          backgroundColor: pressed && shape !== "solid" ? p.surfaceSunken : bg,
          opacity: disabled ? 0.4 : pressed ? 0.85 : hovered ? 0.94 : 1,
          // The focus ring replaces the outline rather than stacking on it, so an
          // outlined button does not gain a second border when tabbed to.
          borderWidth: focused ? 2 : shape === "outline" ? StyleSheet.hairlineWidth : 0,
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
      <RNText
        style={{
          color: fg,
          fontSize: type.body,
          ...font("semibold"),
          marginLeft: icon && !loading ? space.sm : 0,
          letterSpacing: 0.1,
        }}
      >
        {label}
      </RNText>
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
          backgroundColor: selected
            ? p.accentSurface
            : (pressed || hovered) && live
              ? p.surfaceSunken
              : p.surface,
          opacity: live ? 1 : 0.45,
          cursor: live ? "pointer" : "not-allowed",
        }) as ViewStyle
      }
    >
      <Ionicons name={icon} size={22} color={selected ? p.accent : p.textMuted} />
      <RNText
        style={{
          fontSize: type.caption,
          ...font("semibold"),
          color: selected ? p.accent : p.text,
          marginTop: space.xs,
          textAlign: "center",
        }}
      >
        {label}
      </RNText>
      {hint ? (
        <RNText
          style={{
            fontSize: type.micro,
            color: p.textFaint,
            marginTop: 2,
            textAlign: "center",
          }}
        >
          {hint}
        </RNText>
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
          backgroundColor: pressed ? p.surfaceSunken : p.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: p.border,
          opacity: disabled ? 0.35 : 1,
        })}
      >
        <Ionicons name={icon} size={26} color={p.text} />
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
      <RNText
        accessibilityLiveRegion="polite"
        style={{
          flex: 1,
          textAlign: "center",
          fontSize: type.display,
          ...font("bold"),
          color: p.text,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </RNText>
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
      <RNText
        style={{
          fontSize: type.label,
          ...font("semibold"),
          color: p.text,
          marginBottom: space.xs,
        }}
      >
        {label}
      </RNText>
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
          <RNText style={{ fontSize: type.caption, color: p.textMuted, ...font("medium") }}>
            {suffix}
          </RNText>
        ) : null}
      </View>
      {hint && !error ? (
        <RNText
          style={{
            fontSize: type.caption,
            color: p.textMuted,
            marginTop: space.xs,
            lineHeight: 17,
          }}
        >
          {hint}
        </RNText>
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
        <RNText style={{ fontSize: type.body, ...font("semibold"), color: p.text }}>{label}</RNText>
        {hint ? (
          <RNText
            style={{
              fontSize: type.caption,
              color: p.textMuted,
              marginTop: space.xxs,
              lineHeight: 17,
            }}
          >
            {hint}
          </RNText>
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
      <RNText
        style={{
          fontSize: type.label,
          ...font("semibold"),
          color: p.text,
          marginBottom: space.xs,
        }}
      >
        {label}
      </RNText>
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
        <RNText style={{ flex: 1, fontSize: type.body, color: selected ? p.text : p.textFaint }}>
          {selected ? selected.label : placeholder}
        </RNText>
        {selected?.sublabel ? (
          <RNText style={{ fontSize: type.caption, color: p.textMuted, marginRight: space.sm }}>
            {selected.sublabel}
          </RNText>
        ) : null}
        <Ionicons name="chevron-down" size={18} color={p.textFaint} />
      </Pressable>
      {error ? <FieldError message={error} /> : null}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: p.background }}>
          <View
            style={{
              paddingTop: space.xxxl,
              paddingHorizontal: space.lg,
              paddingBottom: space.md,
              backgroundColor: p.surface,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: p.border,
            }}
          >
            <Header title={label} right={<CloseButton onPress={() => setOpen(false)} />} />
            {choices.length > 8 ? (
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
                    fontSize: type.body,
                    backgroundColor: p.surfaceSunken,
                    borderColor: p.border,
                    color: p.text,
                    outlineStyle: "none",
                  } as never
                }
              />
            ) : null}
          </View>
          <ScrollView
            contentContainerStyle={{ padding: space.lg }}
            keyboardShouldPersistTaps="handled"
          >
            <Page>
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
              </Card>
            </Page>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

export function CloseButton({ onPress }: { onPress: () => void }) {
  return <IconButton icon="close" label="Close" onPress={onPress} />;
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function FieldError({ message }: { message: string }) {
  const p = usePalette();
  return (
    <View
      style={{ flexDirection: "row", alignItems: "flex-start", marginTop: space.xs }}
      accessibilityRole="alert"
    >
      <Ionicons name="alert-circle" size={15} color={p.danger} style={{ marginTop: 1 }} />
      <RNText
        style={{
          color: p.danger,
          fontSize: type.caption,
          marginLeft: space.xs,
          flex: 1,
          lineHeight: 17,
        }}
      >
        {message}
      </RNText>
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
      <RNText
        style={{
          color: c.fg,
          fontSize: type.micro,
          ...font("semibold"),
          marginLeft: icon ? space.xs : 0,
          letterSpacing: 0.2,
        }}
      >
        {label}
      </RNText>
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
      <RNText
        style={{
          fontSize: type.subheading,
          ...font("semibold"),
          color: p.text,
          marginTop: space.lg,
          textAlign: "center",
        }}
      >
        {title}
      </RNText>
      {body ? (
        <RNText
          style={{
            fontSize: type.label,
            color: p.textMuted,
            marginTop: space.sm,
            textAlign: "center",
            lineHeight: 21,
            maxWidth: 380,
          }}
        >
          {body}
        </RNText>
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

  const ink =
    tone === "bad" ? p.danger : tone === "warn" ? p.warning : tone === "accent" ? p.accent : p.text;
  const wash =
    tone === "bad"
      ? p.dangerSurface
      : tone === "warn"
        ? p.warningSurface
        : tone === "accent"
          ? p.accentSurface
          : p.surfaceSunken;

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

      <RNText
        style={{
          fontSize: type.display,
          ...font("heavy"),
          color: ink,
          letterSpacing: -1,
          lineHeight: type.display + 2,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </RNText>
      <RNText
        style={{ fontSize: type.label, ...font("semibold"), color: p.text, marginTop: space.xs }}
        numberOfLines={1}
      >
        {label}
      </RNText>
      {caption ? (
        <RNText
          style={{ fontSize: type.caption, color: p.textMuted, marginTop: 1 }}
          numberOfLines={1}
        >
          {caption}
        </RNText>
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
