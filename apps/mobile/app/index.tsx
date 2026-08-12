import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Page, Row, Section } from "../components/ui";
import { outbox } from "../lib/outbox";
import { useSession } from "../lib/session";
import { elevation, font, radius, space, touch, type, usePalette } from "../theme";

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
        const [a, b] = await Promise.all([outbox.pendingCount(), outbox.blockedCount()]);
        if (!alive) return;
        setPending(a);
        setBlocked(b);
      })();
      return () => {
        alive = false;
      };
    }, []),
  );

  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      {/* A solid header gives the app a top edge and somewhere for identity to live. */}
      <View
        style={[
          {
            backgroundColor: p.surface,
            paddingTop: insets.top + space.lg,
            paddingHorizontal: space.lg,
            paddingBottom: space.lg,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: p.border,
          },
          elevation(1, p),
        ]}
      >
        <Page>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: radius.md,
                backgroundColor: p.accent,
                alignItems: "center",
                justifyContent: "center",
                marginRight: space.md,
              }}
            >
              <Ionicons name="cube" size={19} color={p.onAccent} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{
                  fontSize: type.subheading,
                  ...font("bold"),
                  color: p.text,
                  letterSpacing: -0.3,
                }}
                numberOfLines={1}
              >
                {activeProperty?.propertyName ?? "Golai"}
              </Text>
              <Text style={{ fontSize: type.caption, color: p.textMuted }} numberOfLines={1}>
                {activeProperty
                  ? `${activeProperty.propertyCode} · ${activeProperty.organisationName}`
                  : "No property"}
              </Text>
            </View>
            {properties.length > 1 ? (
              <Pressable
                onPress={() => setActiveProperty("")}
                accessibilityRole="button"
                accessibilityLabel="Switch property"
                hitSlop={8}
                style={({ pressed }) => ({
                  width: touch.desk,
                  height: touch.desk,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.md,
                  backgroundColor: pressed ? p.surfaceSunken : "transparent",
                })}
              >
                <Ionicons name="swap-horizontal" size={20} color={p.textMuted} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => void signOut()}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              hitSlop={8}
              style={({ pressed }) => ({
                width: touch.desk,
                height: touch.desk,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.md,
                backgroundColor: pressed ? p.surfaceSunken : "transparent",
              })}
            >
              <Ionicons name="log-out-outline" size={20} color={p.textMuted} />
            </Pressable>
          </View>
        </Page>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.xxl,
        }}
      >
        <Page>
          {/* Sync state earns a place at the top only when there is something to say. */}
          {blocked > 0 || pending > 0 ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: blocked > 0 ? p.dangerSurface : p.warningSurface,
                borderRadius: radius.md,
                padding: space.md,
                marginBottom: space.xl,
              }}
            >
              <Ionicons
                name={blocked > 0 ? "warning" : "cloud-upload-outline"}
                size={18}
                color={blocked > 0 ? p.danger : p.warning}
              />
              <Text
                style={{
                  fontSize: type.caption,
                  ...font("semibold"),
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

          <Section title="Master data">
            <Card padded={false}>
              <Row
                icon="cube-outline"
                label="Items"
                value={canEditMasters ? "Add and edit the item master" : "View the item master"}
                onPress={() => router.push("/items")}
              />
            </Card>
          </Section>

          <Section title="Stock">
            <Card padded={false}>
              <Row
                icon="hourglass-outline"
                label="Expiring soon"
                value="What to use first, and what has gone"
                divider
                onPress={() => router.push("/perishables")}
              />
              <Row
                icon="download-outline"
                label="Opening stock"
                value="Record what is already in the store"
                onPress={() => router.push("/stock/opening")}
              />
            </Card>
          </Section>

          <Section title="Gate">
            <Card padded={false}>
              <Row
                icon="car-outline"
                label="New arrival"
                value="Security capture"
                onPress={() => router.push("/gate/new")}
              />
            </Card>
          </Section>
        </Page>
      </ScrollView>
    </View>
  );
}
