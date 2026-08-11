import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BigRow } from "../components/ui";
import { outbox } from "../lib/outbox";
import { useSession } from "../lib/session";
import { radius, space, touch, type, usePalette } from "../theme";

export default function Home() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeProperty, properties, setActiveProperty, signOut, canEditMasters } = useSession();

  const [pending, setPending] = useState(0);
  const [blocked, setBlocked] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const [p1, b1] = await Promise.all([outbox.pendingCount(), outbox.blockedCount()]);
        if (!alive) return;
        setPending(p1);
        setBlocked(b1);
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
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: type.title, fontWeight: "800", color: p.text }}>Golai</Text>
          <Text style={{ fontSize: type.label, color: p.textMuted }}>
            {activeProperty ? activeProperty.propertyName : "No property"}
          </Text>
        </View>
        <Pressable
          onPress={() => void signOut()}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          hitSlop={12}
          style={{
            minWidth: touch.min,
            minHeight: touch.min,
            alignItems: "flex-end",
            justifyContent: "center",
          }}
        >
          <Ionicons name="log-out-outline" size={26} color={p.textMuted} />
        </Pressable>
      </View>

      {properties.length > 1 ? (
        <Pressable
          onPress={() => setActiveProperty("")}
          accessibilityRole="button"
          accessibilityLabel="Switch property"
          style={{ marginTop: space.sm }}
        >
          <Text style={{ fontSize: type.caption, color: p.accent, fontWeight: "600" }}>
            Switch property
          </Text>
        </Pressable>
      ) : null}

      <View style={{ marginTop: space.xl }}>
        <Text
          style={{
            fontSize: type.caption,
            fontWeight: "700",
            letterSpacing: 1.2,
            textTransform: "uppercase",
            color: p.textMuted,
            marginBottom: space.sm,
          }}
        >
          Master data
        </Text>
        <BigRow
          icon="cube-outline"
          label="Items"
          value={canEditMasters ? "Add and edit the item master" : "View the item master"}
          onPress={() => router.push("/items")}
        />
      </View>

      <View style={{ marginTop: space.lg }}>
        <Text
          style={{
            fontSize: type.caption,
            fontWeight: "700",
            letterSpacing: 1.2,
            textTransform: "uppercase",
            color: p.textMuted,
            marginBottom: space.sm,
          }}
        >
          Stock
        </Text>
        <BigRow
          icon="hourglass-outline"
          label="Expiring soon"
          value="Coming next"
          onPress={() => {}}
        />
        <BigRow
          icon="download-outline"
          label="Opening stock"
          value="Coming next"
          onPress={() => {}}
        />
      </View>

      <View style={{ marginTop: space.lg }}>
        <Text
          style={{
            fontSize: type.caption,
            fontWeight: "700",
            letterSpacing: 1.2,
            textTransform: "uppercase",
            color: p.textMuted,
            marginBottom: space.sm,
          }}
        >
          Gate
        </Text>
        <BigRow
          icon="car-outline"
          label="New arrival"
          value="Security capture"
          onPress={() => router.push("/gate/new")}
        />
      </View>

      {/*
        Backlog depth, shown to the person using the app rather than only to a future
        operator dashboard. A queue that stops draining is the earliest sign a device
        is failing silently (ADR 0004).
      */}
      {pending > 0 || blocked > 0 ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: blocked > 0 ? p.dangerSurface : p.warningSurface,
            borderRadius: radius.md,
            padding: space.md,
            marginTop: space.xl,
          }}
        >
          <Ionicons
            name={blocked > 0 ? "warning" : "cloud-upload-outline"}
            size={24}
            color={blocked > 0 ? p.danger : p.warning}
          />
          <Text
            style={{
              fontSize: type.label,
              fontWeight: "600",
              color: blocked > 0 ? p.danger : p.warning,
              marginLeft: space.sm,
              flex: 1,
            }}
          >
            {blocked > 0
              ? `${blocked} record${blocked === 1 ? "" : "s"} stuck and need attention`
              : `${pending} waiting to sync`}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
