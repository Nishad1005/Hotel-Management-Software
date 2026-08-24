import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { font, radius, space, touch, type, usePalette } from "../theme";
import { Dialog, PrimaryButton, Text } from "./ui";

/**
 * A calendar picker, built from primitives rather than pulled from a package.
 *
 * The obvious dependency, @react-native-community/datetimepicker, defers to the
 * platform — which means no picker at all on web, where this app currently ships. A
 * month grid in plain views works identically everywhere and costs one file.
 *
 * Dates are handled as YYYY-MM-DD strings throughout, never Date objects. A best-before
 * is a calendar date, not an instant: converting through a local-timezone Date is how a
 * device in IST turns the 30th into the 29th.
 */

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function DateField({
  label,
  value,
  onChange,
  hint,
  error,
  optional,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  error?: string;
  optional?: boolean;
}) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => monthOf(value || todayIso()));

  const selected = value || null;

  return (
    <View style={{ marginBottom: space.lg }}>
      <Text role="label" weight="semibold" style={{ marginBottom: space.xs }}>
        {label}
      </Text>

      <Pressable
        onPress={() => {
          setCursor(monthOf(value || todayIso()));
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${selected ? formatLong(selected) : "not set"}`}
        style={({ pressed }) =>
          ({
            flexDirection: "row",
            alignItems: "center",
            minHeight: touch.desk,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            borderWidth: error ? 2 : StyleSheet.hairlineWidth,
            borderColor: error ? p.danger : p.border,
            backgroundColor: pressed ? p.surfaceSunken : p.surface,
            cursor: "pointer",
          }) as never
        }
      >
        <Ionicons name="calendar-outline" size={17} color={p.textMuted} />
        <Text
          style={{
            flex: 1,
            marginLeft: space.sm,
            fontSize: type.body,
            color: selected ? p.text : p.textFaint,
          }}
        >
          {selected ? formatLong(selected) : "Choose a date"}
        </Text>
        {selected ? (
          <Pressable
            onPress={() => onChange("")}
            accessibilityRole="button"
            accessibilityLabel="Clear date"
            hitSlop={10}
          >
            <Ionicons name="close-circle" size={17} color={p.textFaint} />
          </Pressable>
        ) : null}
      </Pressable>

      {hint && !error ? (
        <Text role="caption" tone="muted" style={{ marginTop: space.xs }}>
          {hint}
        </Text>
      ) : null}
      {error ? (
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: space.xs }}>
          <Ionicons name="alert-circle" size={15} color={p.danger} />
          <Text role="caption" tone="danger" style={{ marginLeft: space.xs, flex: 1 }}>
            {error}
          </Text>
        </View>
      ) : null}

      <Dialog visible={open} title={label} onClose={() => setOpen(false)}>
        <View style={{ width: "100%", maxWidth: 380, alignSelf: "center" }}>
          {/*
                Shortcuts first. Best-before dates cluster a few days or weeks out, so
                most entries never need the grid at all.
              */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {[
              { label: "Today", days: 0 },
              { label: "+3 days", days: 3 },
              { label: "+1 week", days: 7 },
              { label: "+1 month", days: 30 },
            ].map((q) => (
              <Pressable
                key={q.label}
                onPress={() => {
                  onChange(addDays(todayIso(), q.days));
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={q.label}
                style={({ pressed }) =>
                  ({
                    paddingHorizontal: space.md,
                    paddingVertical: space.sm,
                    borderRadius: radius.pill,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: p.border,
                    backgroundColor: pressed ? p.surfaceSunken : p.surface,
                    cursor: "pointer",
                  }) as never
                }
              >
                <Text role="caption" tone="muted" weight="semibold">
                  {q.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginTop: space.xl,
              marginBottom: space.md,
            }}
          >
            <MonthArrow icon="chevron-back" onPress={() => setCursor(shiftMonth(cursor, -1))} />
            <Text role="heading" align="center" style={{ flex: 1 }}>
              {MONTHS[cursor.month]} {cursor.year}
            </Text>
            <MonthArrow icon="chevron-forward" onPress={() => setCursor(shiftMonth(cursor, 1))} />
          </View>

          <View style={{ flexDirection: "row" }}>
            {WEEKDAYS.map((d, i) => (
              <Text
                key={`${d}-${i}`}
                role="caption"
                tone="muted"
                weight="bold"
                align="center"
                style={{ flex: 1, marginBottom: space.sm }}
              >
                {d}
              </Text>
            ))}
          </View>

          {weeksOf(cursor).map((week, wi) => (
            <View key={wi} style={{ flexDirection: "row" }}>
              {week.map((iso, di) => (
                <DayCell
                  key={iso ?? `blank-${di}`}
                  iso={iso}
                  selected={iso !== null && iso === selected}
                  today={iso === todayIso()}
                  onPress={() => {
                    if (!iso) return;
                    onChange(iso);
                    setOpen(false);
                  }}
                />
              ))}
            </View>
          ))}

          {optional ? (
            <View style={{ marginTop: space.xl }}>
              <PrimaryButton
                label="No expiry date"
                tone="neutral"
                onPress={() => {
                  onChange("");
                  setOpen(false);
                }}
              />
            </View>
          ) : null}
        </View>
      </Dialog>
    </View>
  );
}

function MonthArrow({
  icon,
  onPress,
}: {
  icon: "chevron-back" | "chevron-forward";
  onPress: () => void;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={icon === "chevron-back" ? "Previous month" : "Next month"}
      style={({ pressed }) =>
        ({
          width: touch.desk,
          height: touch.desk,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.md,
          backgroundColor: pressed ? p.surfaceSunken : "transparent",
          cursor: "pointer",
        }) as never
      }
    >
      <Ionicons name={icon} size={20} color={p.text} />
    </Pressable>
  );
}

function DayCell({
  iso,
  selected,
  today,
  onPress,
}: {
  iso: string | null;
  selected: boolean;
  today: boolean;
  onPress: () => void;
}) {
  const p = usePalette();

  if (!iso) return <View style={{ flex: 1, height: touch.desk }} />;

  const dayNumber = Number(iso.slice(8, 10));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={formatLong(iso)}
      style={({ pressed }) =>
        ({
          flex: 1,
          height: touch.desk,
          alignItems: "center",
          justifyContent: "center",
          margin: 1,
          borderRadius: radius.sm,
          backgroundColor: selected ? p.accent : pressed ? p.surfaceSunken : "transparent",
          borderWidth: today && !selected ? 1 : 0,
          borderColor: p.accent,
          cursor: "pointer",
        }) as never
      }
    >
      <Text
        style={{
          fontSize: type.body,
          ...font(selected ? "semibold" : "regular"),
          color: selected ? p.onAccent : p.text,
          fontVariant: ["tabular-nums"],
        }}
      >
        {dayNumber}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Date helpers — strings in, strings out, UTC throughout
// ---------------------------------------------------------------------------

interface MonthCursor {
  year: number;
  month: number;
}

export function todayIso(): string {
  const now = new Date();
  return toIso(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toIso(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
}

function monthOf(iso: string): MonthCursor {
  const [y, m] = iso.split("-").map(Number);
  return { year: y ?? 1970, month: (m ?? 1) - 1 };
}

function shiftMonth(c: MonthCursor, by: number): MonthCursor {
  const total = c.year * 12 + c.month + by;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/** Weeks starting Monday, padded with nulls so the grid keeps its columns. */
function weeksOf(c: MonthCursor): (string | null)[][] {
  const first = new Date(Date.UTC(c.year, c.month, 1));
  const daysInMonth = new Date(Date.UTC(c.year, c.month + 1, 0)).getUTCDate();
  // getUTCDay is Sunday-based; this app is used in India, where the week starts Monday.
  const leading = (first.getUTCDay() + 6) % 7;

  const cells: (string | null)[] = Array(leading).fill(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(toIso(Date.UTC(c.year, c.month, d)));
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function formatLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}
