import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Page, Row, Section, StatGrid, StatTile } from "../components/ui";
import { onOutboxChange, outbox } from "../lib/outbox";
import { loadOverview, type PropertyOverview } from "../lib/overview";
import { useSession } from "../lib/session";
import { elevation, font, radius, space, touch, type, usePalette } from "../theme";

/**
 * Home — the state of the store, then what to do about it.
 *
 * This screen used to be three cards of navigation rows and not a single figure. That
 * is a settings menu wearing a dashboard's clothes, and it is the wrong shape for an
 * operations product: the first question somebody has on opening this is not "where do
 * I go" but "does anything need me today". The links still matter; they belong under
 * the answer rather than instead of it.
 *
 * The figures are ordered by how much they demand — expired first, because that is
 * stock that cannot be served and money already lost.
 */
export default function Home() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeProperty, properties, setActiveProperty, signOut, canEditMasters } = useSession();

  const [pending, setPending] = useState(0);
  const [blocked, setBlocked] = useState(0);
  const [overview, setOverview] = useState<PropertyOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let alive = true;

      const refreshQueue = async () => {
        const [a, b] = await Promise.all([outbox.pendingCount(), outbox.blockedCount()]);
        if (!alive) return;
        setPending(a);
        setBlocked(b);
      };

      void refreshQueue();
      void (async () => {
        try {
          const next = await loadOverview(Date.now());
          if (alive) setOverview(next);
        } catch {
          // A dashboard that cannot count is not worth an error screen — the actions
          // below still work, and the figures reappear on the next focus.
          if (alive) setOverview(null);
        } finally {
          if (alive) setLoading(false);
        }
      })();

      const unsubscribe = onOutboxChange(() => void refreshQueue());
      return () => {
        alive = false;
        unsubscribe();
      };
    }, []),
  );

  const needsAttention = (overview?.expired ?? 0) + (overview?.expiringSoon ?? 0);

  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
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
                width: 38,
                height: 38,
                borderRadius: radius.md,
                backgroundColor: p.accent,
                alignItems: "center",
                justifyContent: "center",
                marginRight: space.md,
              }}
            >
              <Ionicons name="cube" size={20} color={p.onAccent} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{
                  fontSize: type.heading,
                  ...font("bold"),
                  color: p.text,
                  letterSpacing: -0.4,
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
              <HeaderButton
                icon="swap-horizontal"
                label="Switch property"
                onPress={() => setActiveProperty("")}
              />
            ) : null}
            <HeaderButton icon="log-out-outline" label="Sign out" onPress={() => void signOut()} />
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
                marginBottom: space.lg,
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

          {/*
            The figures come before the navigation, and the two that can demand action
            come before the two that merely describe. Nothing here is decorative: every
            tile is a number somebody would otherwise have to open a screen to learn.
          */}
          <Text
            style={{
              fontSize: type.caption,
              ...font("bold"),
              letterSpacing: 1.2,
              textTransform: "uppercase",
              color: p.textMuted,
              marginBottom: space.md,
            }}
          >
            {needsAttention > 0 ? "Needs attention" : "The store today"}
          </Text>

          {loading ? (
            <View
              style={{
                height: 148,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: p.surface,
                borderRadius: radius.lg,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: p.border,
              }}
            >
              <ActivityIndicator color={p.accent} />
            </View>
          ) : (
            <StatGrid>
              <StatTile
                icon="alert-circle"
                label="Expired"
                value={overview?.expired ?? 0}
                caption={overview?.expired ? "Cannot be served" : "Nothing past date"}
                tone={overview?.expired ? "bad" : "neutral"}
                onPress={() => router.push("/perishables")}
              />
              <StatTile
                icon="hourglass"
                label="Use this week"
                value={overview?.expiringSoon ?? 0}
                caption="Within seven days"
                tone={overview?.expiringSoon ? "warn" : "neutral"}
                onPress={() => router.push("/perishables")}
              />
              <StatTile
                icon="layers-outline"
                label="Stock lines"
                value={overview?.stockLines ?? 0}
                caption="Batches on hand"
                tone="accent"
                onPress={() => router.push("/stock/opening")}
              />
              <StatTile
                icon="cube-outline"
                label="Items"
                value={overview?.items ?? 0}
                caption={`${overview?.locations ?? 0} locations`}
                onPress={() => router.push("/items")}
              />
            </StatGrid>
          )}

          <View style={{ height: space.xxl }} />

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

          <Section title="Master data">
            <Card padded={false}>
              <Row
                icon="cube-outline"
                label="Items"
                value={canEditMasters ? "Add and edit the item master" : "View the item master"}
                divider
                onPress={() => router.push("/items")}
              />
              <Row
                icon="map-outline"
                label="Zones & locations"
                value="Build the bin tree and print the stickers"
                divider
                onPress={() => router.push("/admin/locations")}
              />
              <Row
                icon="people-outline"
                label="People"
                value="Who works here, and what they may do"
                onPress={() => router.push("/admin/users")}
              />
            </Card>
          </Section>

          <Section title="The flow">
            <Card padded={false}>
              <Row
                icon="car-outline"
                label="New arrival"
                value="Gate 0 — Security capture"
                divider
                onPress={() => router.push("/gate/new")}
              />
              <Row
                icon="clipboard-outline"
                label="Receive goods"
                value="Gates 1 to 5 — count it, check it, post the receipt"
                onPress={() => router.push("/receive")}
              />
            </Card>
          </Section>
        </Page>
      </ScrollView>
    </View>
  );
}

/** Header affordances: same size, same feedback, no bespoke styling per button. */
function HeaderButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
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
      <Ionicons name={icon} size={20} color={p.textMuted} />
    </Pressable>
  );
}
