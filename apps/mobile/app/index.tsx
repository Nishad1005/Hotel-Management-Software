import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BigRow, PrimaryButton } from "../components/ui";
import { outbox } from "../lib/outbox";
import { radius, space, type, usePalette } from "../theme";

/**
 * The security post's home screen.
 *
 * One primary action, sized so it can be hit without looking. Everything else is a
 * status the guard needs at handover: what is waiting to sync, and what is stuck.
 */
export default function Home() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [pending, setPending] = useState(0);
  const [blocked, setBlocked] = useState(0);
  const [oldestMs, setOldestMs] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const [p1, b1, age] = await Promise.all([
          outbox.pendingCount(),
          outbox.blockedCount(),
          outbox.oldestPendingAgeMs(),
        ]);
        if (!alive) return;
        setPending(p1);
        setBlocked(b1);
        setOldestMs(age);
      })();
      return () => {
        alive = false;
      };
    }, []),
  );

  return (
    <ScrollView
      style={{ backgroundColor: p.background }}
      contentContainerStyle={{
        padding: space.md,
        paddingTop: insets.top + space.lg,
        paddingBottom: insets.bottom + space.xl,
      }}
    >
      <Text style={{ fontSize: type.title, fontWeight: "800", color: p.text }}>Golai</Text>
      <Text style={{ fontSize: type.label, color: p.textMuted, marginBottom: space.lg }}>
        Security gate · Voyage The Solitaire Bliss
      </Text>

      <PrimaryButton
        label="New arrival"
        icon="add-circle"
        onPress={() => router.push("/gate/new")}
      />

      {/*
        Backlog depth, shown to the guard rather than only to an operator dashboard.
        A queue that stops draining is the earliest signal that a device is failing
        silently, and silent failure at the gate is what this product exists to
        prevent (ADR 0004). The person standing at the gate should be able to see it.
      */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: blocked > 0 ? p.dangerSurface : p.surface,
          borderColor: blocked > 0 ? p.danger : p.border,
          borderWidth: 1,
          borderRadius: radius.md,
          padding: space.md,
          marginTop: space.lg,
        }}
      >
        <Ionicons
          name={blocked > 0 ? "warning" : pending > 0 ? "cloud-upload-outline" : "checkmark-circle"}
          size={24}
          color={blocked > 0 ? p.danger : pending > 0 ? p.warning : p.success}
        />
        <View style={{ marginLeft: space.sm, flex: 1 }}>
          <Text
            style={{
              fontSize: type.label,
              fontWeight: "600",
              color: blocked > 0 ? p.danger : p.text,
            }}
          >
            {blocked > 0
              ? `${blocked} entr${blocked === 1 ? "y" : "ies"} stuck — tell the storekeeper`
              : pending > 0
                ? `${pending} waiting to sync`
                : "Everything synced"}
          </Text>
          {pending > 0 && oldestMs !== null ? (
            <Text style={{ fontSize: type.caption, color: p.textMuted, marginTop: 2 }}>
              Oldest {formatAge(oldestMs)}
            </Text>
          ) : null}
        </View>
      </View>

      <Text
        style={{
          fontSize: type.caption,
          fontWeight: "700",
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: p.textMuted,
          marginTop: space.xl,
          marginBottom: space.sm,
        }}
      >
        Shift handover
      </Text>
      <BigRow
        icon="time-outline"
        label="Open gate entries"
        value="Not yet available"
        onPress={() => {}}
      />
      <BigRow
        icon="repeat-outline"
        label="Outstanding returnables"
        value="Not yet available"
        onPress={() => {}}
      />
    </ScrollView>
  );
}

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than a minute old";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} old`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} old`;
}
