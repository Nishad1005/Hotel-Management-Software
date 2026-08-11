import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from "react-native";
import { radius, space, touch, type, usePalette, type Palette } from "../theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

/**
 * Press feedback is opacity + background only — never a transform that changes
 * layout bounds. A card that shifts under a gloved thumb reads as a mis-tap.
 */
function pressedStyle(pressed: boolean, palette: Palette): ViewStyle {
  return pressed ? { backgroundColor: palette.surfaceSunken, opacity: 0.9 } : {};
}

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  const p = usePalette();
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text
        accessibilityRole="header"
        style={{
          fontSize: type.caption,
          fontWeight: "700",
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: p.textMuted,
          marginBottom: hint ? space.xs : space.sm,
        }}
      >
        {title}
      </Text>
      {hint ? (
        <Text style={{ fontSize: type.caption, color: p.textMuted, marginBottom: space.sm }}>
          {hint}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/** A large tappable row. The default control of this app. */
export function BigRow({
  icon,
  label,
  value,
  onPress,
  tone = "default",
  accessibilityHint,
}: {
  icon: IoniconName;
  label: string;
  value?: string;
  onPress: () => void;
  tone?: "default" | "selected";
  accessibilityHint?: string;
}) {
  const p = usePalette();
  const selected = tone === "selected";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}. ${value}` : label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: touch.min,
          backgroundColor: selected ? p.successSurface : p.surface,
          borderColor: selected ? p.success : p.border,
          borderWidth: selected ? 2 : 1,
        },
        pressedStyle(pressed, p),
      ]}
    >
      <Ionicons name={icon} size={26} color={selected ? p.success : p.textMuted} />
      <View style={{ flex: 1, marginLeft: space.md }}>
        <Text style={{ fontSize: type.body, fontWeight: "600", color: p.text }}>{label}</Text>
        {value ? (
          <Text style={{ fontSize: type.label, color: p.textMuted, marginTop: 2 }}>{value}</Text>
        ) : null}
      </View>
      {selected ? (
        <Ionicons name="checkmark-circle" size={26} color={p.success} />
      ) : (
        <Ionicons name="chevron-forward" size={22} color={p.borderStrong} />
      )}
    </Pressable>
  );
}

/** Two-up choice tiles. Used where the answer is binary and must be stated, not skipped. */
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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.tile,
        {
          minHeight: touch.large,
          backgroundColor: selected ? p.successSurface : p.surface,
          borderColor: selected ? p.success : p.border,
          borderWidth: selected ? 2 : 1,
        },
        pressedStyle(pressed, p),
      ]}
    >
      <Ionicons name={icon} size={30} color={selected ? p.success : p.textMuted} />
      <Text
        style={{
          fontSize: type.label,
          fontWeight: "600",
          color: selected ? p.success : p.text,
          marginTop: space.sm,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Package count. Steppers beat a keyboard when the user is wearing gloves. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
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
        style={({ pressed }) => [
          styles.stepButton,
          {
            backgroundColor: p.surfaceSunken,
            borderColor: p.border,
            opacity: disabled ? 0.4 : 1,
          },
          !disabled && pressedStyle(pressed, p),
        ]}
      >
        <Ionicons name={icon} size={32} color={p.text} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.stepper, { backgroundColor: p.surface, borderColor: p.border }]}>
      {button(-1, "remove", "One fewer package")}
      <Text
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${value} packages`}
        style={{
          flex: 1,
          textAlign: "center",
          fontSize: type.display,
          fontWeight: "700",
          color: p.text,
          // Tabular figures so the number does not jog sideways as digits change.
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
      {button(1, "add", "One more package")}
    </View>
  );
}

/** Errors sit beside the field they belong to, with an icon so colour is not the only signal. */
export function FieldError({ message }: { message: string }) {
  const p = usePalette();
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Ionicons name="alert-circle" size={18} color={p.danger} />
      <Text style={{ color: p.danger, fontSize: type.label, marginLeft: space.sm, flex: 1 }}>
        {message}
      </Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon?: IoniconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.primary,
        { backgroundColor: p.accent, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={24} color={p.accentText} /> : null}
      <Text
        style={{
          color: p.accentText,
          fontSize: type.heading,
          fontWeight: "700",
          marginLeft: icon ? space.sm : 0,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    marginBottom: space.sm,
  },
  tile: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space.md,
    borderRadius: radius.md,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.sm,
  },
  stepButton: {
    width: touch.min,
    height: touch.min,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  error: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: space.sm,
  },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: touch.min,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
  },
});

/** Labelled text input. Labels are visible, never placeholder-only. */
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
}) {
  const p = usePalette();
  return (
    <View style={{ marginBottom: space.md }}>
      <Text
        style={{ fontSize: type.label, fontWeight: "600", color: p.text, marginBottom: space.xs }}
      >
        {label}
      </Text>
      {hint ? (
        <Text style={{ fontSize: type.caption, color: p.textMuted, marginBottom: space.xs }}>
          {hint}
        </Text>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? ""}
        placeholderTextColor={p.textMuted}
        secureTextEntry={secureTextEntry ?? false}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        accessibilityLabel={label}
        style={{
          minHeight: touch.min,
          borderWidth: 1,
          borderRadius: radius.md,
          paddingHorizontal: space.md,
          fontSize: type.body,
          backgroundColor: p.surface,
          borderColor: error ? p.danger : p.border,
          color: p.text,
        }}
      />
      {error ? <FieldError message={error} /> : null}
    </View>
  );
}

/** A status pill. Carries an icon as well as colour, never colour alone. */
export function StatusPill({
  icon,
  label,
  tone,
}: {
  icon: IoniconName;
  label: string;
  tone: "neutral" | "good" | "warn" | "bad";
}) {
  const p = usePalette();
  const colours = {
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
        backgroundColor: colours.bg,
        borderRadius: radius.pill,
        paddingHorizontal: space.sm,
        paddingVertical: 4,
      }}
    >
      <Ionicons name={icon} size={14} color={colours.fg} />
      <Text style={{ color: colours.fg, fontSize: type.caption, fontWeight: "700", marginLeft: 4 }}>
        {label}
      </Text>
    </View>
  );
}

/** Full-screen message. Used for loading, empty and misconfiguration states. */
export function Notice({
  icon,
  title,
  body,
  tone = "neutral",
}: {
  icon: IoniconName;
  title: string;
  body?: string;
  tone?: "neutral" | "bad";
}) {
  const p = usePalette();
  const fg = tone === "bad" ? p.danger : p.textMuted;
  return (
    <View style={{ alignItems: "center", padding: space.xl }}>
      <Ionicons name={icon} size={44} color={fg} />
      <Text
        style={{
          fontSize: type.heading,
          fontWeight: "700",
          color: p.text,
          marginTop: space.md,
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
            lineHeight: 22,
          }}
        >
          {body}
        </Text>
      ) : null}
    </View>
  );
}
