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
 * The figures are ordered by who they are waiting on. The work queues come first —
 * arrivals to receive, stock at Terminal 1, consignments waiting to leave — because each
 * is a job somebody has to do today. What merely needs watching comes underneath, however
 * red it looks: stock expiring in six days does not need anybody before lunch.
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

  const propertyId = activeProperty?.propertyId ?? null;

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
        if (!propertyId) return;
        try {
          const next = await loadOverview(propertyId);
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
    }, [propertyId]),
  );

  /**
   * What is waiting on a person right now, as against what merely needs watching.
   *
   * The distinction decides the heading and the order below. An arrival standing at the
   * gate and a pallet standing at Terminal 1 are both somebody's next job; stock expiring
   * in six days is not, however red it looks.
   */
  const queued =
    (overview?.arrivalsWaiting ?? 0) +
    (overview?.quarantineLines ?? 0) +
    (overview?.awaitingGatePass ?? 0);
  const atRisk = (overview?.expired ?? 0) + (overview?.expiringSoon ?? 0);

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
            {queued > 0 ? "Waiting on someone" : atRisk > 0 ? "Needs watching" : "The store today"}
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
            <>
              {/*
                The work queues first, and in flow order — gate, dock, gate again. These
                are three jobs somebody has to do today, and they were invisible on this
                screen until now even though the app had grown six screens to do them on.
              */}
              <StatGrid>
                <StatTile
                  icon="car-outline"
                  label="To receive"
                  value={overview?.arrivalsWaiting ?? 0}
                  caption={
                    overview?.arrivalsOverdue
                      ? `${overview.arrivalsOverdue} waiting over four hours`
                      : "Arrivals with no receipt"
                  }
                  tone={
                    overview?.arrivalsOverdue
                      ? "bad"
                      : overview?.arrivalsWaiting
                        ? "warn"
                        : "neutral"
                  }
                  onPress={() => router.push("/receive")}
                />
                <StatTile
                  icon="file-tray-stacked-outline"
                  label="To put away"
                  value={overview?.quarantineLines ?? 0}
                  caption={
                    overview?.quarantineOldestHours
                      ? `Oldest ${overview.quarantineOldestHours.toFixed(1)} h at T1`
                      : "Nothing at Terminal 1"
                  }
                  tone={(overview?.quarantineOldestHours ?? 0) >= 4 ? "warn" : "neutral"}
                  onPress={() => router.push("/putaway")}
                />
                <StatTile
                  icon="shield-checkmark-outline"
                  label="To gate out"
                  value={overview?.awaitingGatePass ?? 0}
                  caption="Staged, still on the property"
                  tone={overview?.awaitingGatePass ? "warn" : "neutral"}
                  onPress={() => router.push("/gate-out")}
                />
              </StatGrid>

              <View style={{ height: space.md }} />

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
                  caption="Issuable, across every bin"
                  tone="accent"
                  onPress={() => router.push("/stock")}
                />
                <StatTile
                  icon="cube-outline"
                  label="Items"
                  value={overview?.items ?? 0}
                  caption={`${overview?.bins ?? 0} bins · ${overview?.vendors ?? 0} vendors`}
                  onPress={() => router.push("/items")}
                />
              </StatGrid>
            </>
          )}

          <View style={{ height: space.xxl }} />

          <Section title="Stock">
            <Card padded={false}>
              <Row
                icon="albums-outline"
                label="What is in the store"
                value="Everything on hand, and where it is"
                divider
                onPress={() => router.push("/stock")}
              />
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

          {/*
            Its own section, above master data, because it is the product argument rather
            than a report. Nothing in it is captured anywhere — it is the flow read back.
          */}
          <Section title="Compliance">
            <Card padded={false}>
              <Row
                icon="shield-checkmark-outline"
                label="FSSAI registers"
                value="Inward, temperature, non-conforming, waste — all by-products"
                divider
                onPress={() => router.push("/registers")}
              />
              <Row
                icon="git-branch-outline"
                label="Trace a batch"
                value="Gate to vendor to bin to department, on one screen"
                divider
                onPress={() => router.push("/registers")}
              />
              <Row
                icon="documents-outline"
                label="Goods receipts"
                value="What was posted, and what corrected it"
                onPress={() => router.push("/receipts")}
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
                icon="business-outline"
                label="Vendors"
                value="Who supplies, who launders, who takes the waste"
                divider
                onPress={() => router.push("/vendors")}
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
                divider
                onPress={() => router.push("/receive")}
              />
              <Row
                icon="file-tray-stacked-outline"
                label="Put away"
                value="Gate 6 — into a bin, and only then issuable"
                divider
                onPress={() => router.push("/putaway")}
              />
              <Row
                icon="exit-outline"
                label="Issue to a department"
                value="Gate 8 — out of the store, oldest first"
                divider
                onPress={() => router.push("/issue")}
              />
              <Row
                icon="albums-outline"
                label="Send out"
                value="Gate 9 — stage returns, empties and linen at Terminal 2"
                divider
                onPress={() => router.push("/dispatch")}
              />
              <Row
                icon="shield-checkmark-outline"
                label="Gate out"
                value="Gate 10 — Security issues the gate pass"
                onPress={() => router.push("/gate-out")}
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
