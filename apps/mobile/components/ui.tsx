import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { elevation, font, radius, space, touch, type, type Palette, usePalette } from "../theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
export type Density = "field" | "desk";

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
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => ({
            width: touch.desk,
            height: touch.desk,
            marginLeft: -space.sm,
            marginRight: space.xs,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.md,
            backgroundColor: pressed ? p.surfaceSunken : "transparent",
          })}
        >
          <Ionicons name="chevron-back" size={24} color={p.text} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text
          accessibilityRole="header"
          style={{
            fontSize: type.title,
            ...font("bold"),
            color: p.text,
            letterSpacing: -0.4,
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: type.label, color: p.textMuted, marginTop: space.xxs }}>
            {subtitle}
          </Text>
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
        <Text
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
        </Text>
      ) : null}
      {hint ? (
        <Text
          style={{
            fontSize: type.caption,
            color: p.textMuted,
            marginBottom: space.sm,
            lineHeight: 17,
          }}
        >
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
        <Text
          numberOfLines={1}
          style={{
            fontSize: density === "field" ? type.subheading : type.body,
            ...font("semibold"),
            color: tint === "danger" ? p.danger : p.text,
          }}
        >
          {label}
        </Text>
        {value ? (
          <Text
            numberOfLines={1}
            style={{ fontSize: type.caption, color: p.textMuted, marginTop: 1 }}
          >
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

export function PrimaryButton({
  label,
  icon,
  onPress,
  disabled,
  tone = "accent",
  density = "desk",
}: {
  label: string;
  icon?: IoniconName;
  onPress: () => void;
  disabled?: boolean;
  tone?: "accent" | "neutral" | "danger";
  density?: Density;
}) {
  const p = usePalette();
  const { hovered, focused, handlers } = useInteractionState();
  const bg = tone === "accent" ? p.accent : tone === "danger" ? p.danger : p.surfaceSunken;
  const fg = tone === "neutral" ? p.text : p.onAccent;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      {...handlers}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          minHeight: heightFor(density),
          borderRadius: radius.md,
          paddingHorizontal: space.xl,
          backgroundColor: bg,
          opacity: disabled ? 0.4 : pressed ? 0.85 : hovered ? 0.94 : 1,
          borderWidth: focused ? 2 : 0,
          borderColor: p.focus,
          cursor: disabled ? "not-allowed" : "pointer",
        } as ViewStyle,
        tone === "accent" && !disabled ? elevation(1, p) : {},
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text
        style={{
          color: fg,
          fontSize: type.body,
          ...font("semibold"),
          marginLeft: icon ? space.sm : 0,
          letterSpacing: 0.1,
        }}
      >
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
}: {
  icon: IoniconName;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  const { hovered, focused, handlers } = useInteractionState();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      {...handlers}
      style={({ pressed }) =>
        ({
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: space.lg,
          paddingHorizontal: space.sm,
          borderRadius: radius.md,
          borderWidth: selected || focused ? 2 : StyleSheet.hairlineWidth,
          borderColor: focused
            ? p.focus
            : selected
              ? p.accent
              : hovered
                ? p.borderStrong
                : p.border,
          backgroundColor: selected
            ? p.accentSurface
            : pressed || hovered
              ? p.surfaceSunken
              : p.surface,
          cursor: "pointer",
        }) as ViewStyle
      }
    >
      <Ionicons name={icon} size={22} color={selected ? p.accent : p.textMuted} />
      <Text
        style={{
          fontSize: type.caption,
          ...font("semibold"),
          color: selected ? p.accent : p.text,
          marginTop: space.xs,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
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
      <Text
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
      <Text
        style={{
          fontSize: type.label,
          ...font("semibold"),
          color: p.text,
          marginBottom: space.xs,
        }}
      >
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
          <Text style={{ fontSize: type.caption, color: p.textMuted, ...font("medium") }}>
            {suffix}
          </Text>
        ) : null}
      </View>
      {hint && !error ? (
        <Text
          style={{
            fontSize: type.caption,
            color: p.textMuted,
            marginTop: space.xs,
            lineHeight: 17,
          }}
        >
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
        <Text style={{ fontSize: type.body, ...font("semibold"), color: p.text }}>{label}</Text>
        {hint ? (
          <Text
            style={{
              fontSize: type.caption,
              color: p.textMuted,
              marginTop: space.xxs,
              lineHeight: 17,
            }}
          >
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
      <Text
        style={{
          fontSize: type.label,
          ...font("semibold"),
          color: p.text,
          marginBottom: space.xs,
        }}
      >
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
        <Text style={{ flex: 1, fontSize: type.body, color: selected ? p.text : p.textFaint }}>
          {selected ? selected.label : placeholder}
        </Text>
        {selected?.sublabel ? (
          <Text style={{ fontSize: type.caption, color: p.textMuted, marginRight: space.sm }}>
            {selected.sublabel}
          </Text>
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
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Close"
      hitSlop={10}
      style={({ pressed }) => ({
        width: touch.desk,
        height: touch.desk,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.md,
        backgroundColor: pressed ? p.surfaceSunken : "transparent",
      })}
    >
      <Ionicons name="close" size={22} color={p.text} />
    </Pressable>
  );
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
      <Text
        style={{
          color: p.danger,
          fontSize: type.caption,
          marginLeft: space.xs,
          flex: 1,
          lineHeight: 17,
        }}
      >
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
        style={{
          color: c.fg,
          fontSize: type.micro,
          ...font("semibold"),
          marginLeft: icon ? space.xs : 0,
          letterSpacing: 0.2,
        }}
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
      <Text
        style={{
          fontSize: type.subheading,
          ...font("semibold"),
          color: p.text,
          marginTop: space.lg,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      {body ? (
        <Text
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
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: space.xl }}>{action}</View> : null}
    </View>
  );
}
