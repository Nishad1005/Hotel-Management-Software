import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Header, Page, PrimaryButton, StatGrid, StatTile, Text } from "../components/ui";
import type { Capability } from "@golai/domain";
import { memberCan } from "../lib/access";
import { onOutboxChange, outbox } from "../lib/outbox";
import { loadOverview, type PropertyOverview } from "../lib/overview";
import { useSession } from "../lib/session";
import { radius, space, usePalette } from "../theme";

interface StartAction {
  capability: Capability;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  href: string;
}

const STARTS: StartAction[] = [
  { capability: "gate.capture", label: "New arrival", icon: "car-outline", href: "/gate/new" },
  { capability: "receiving", label: "Receive goods", icon: "clipboard-outline", href: "/receive" },
  { capability: "issue", label: "Issue stock", icon: "exit-outline", href: "/issue" },
];

/**
 * Home — the state of the store, and the job you came to start.
 *
 * It used to be figures followed by seventeen navigation rows in five sections, and that
 * was not an oversight: with no shell, this screen was the app's only route to anything, so
 * every destination had to appear on it. The cost was that every tile's destination was
 * repeated as a row underneath — `/perishables` appeared three times, two Compliance rows
 * went to the same screen, and "The flow", which is the actual daily work, sat last beneath
 * monthly admin.
 *
 * The sidebar owns destinations now. What is left is what a home screen is for: what needs
 * a person today, and one press to begin.
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
  const { activeProperty } = useSession();

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

  /**
   * The job this person starts, rather than the list of jobs that exist.
   *
   * In flow order and filtered by what they may actually do, so a security guard opens the
   * app to one button that says "New arrival" — which is the whole of their shift — and a
   * storekeeper opens it to receiving and issuing. Gate 0 has no tile above and would
   * otherwise be reachable only through the drawer, which is the wrong place for the single
   * most-pressed control in the product.
   */
  const roles = activeProperty?.roles ?? [];
  const starts = STARTS.filter((s) => memberCan(roles, s.capability));

  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.lg,
          paddingBottom: insets.bottom + space.xxl,
        }}
      >
        <Page wide>
          <Header
            title={activeProperty?.propertyName ?? "PARGOLAI"}
            {...(activeProperty
              ? { subtitle: `${activeProperty.propertyCode} · ${activeProperty.organisationName}` }
              : {})}
          />

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
                role="label"
                tone={blocked > 0 ? "danger" : "warning"}
                weight="semibold"
                style={{ marginLeft: space.sm, flex: 1 }}
              >
                {blocked > 0
                  ? `${blocked} record${blocked === 1 ? "" : "s"} stuck and need attention`
                  : `${pending} waiting to sync`}
              </Text>
            </View>
          ) : null}

          {starts.length > 0 ? (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: space.sm,
                marginBottom: space.xl,
              }}
            >
              {starts.map((s, index) => (
                <View key={s.href} style={{ flexGrow: 1, flexBasis: 200 }}>
                  <PrimaryButton
                    label={s.label}
                    icon={s.icon}
                    // One primary action per screen. Everything after the first is the
                    // same job in a quieter voice, not a competing one.
                    tone={index === 0 ? "accent" : "neutral"}
                    onPress={() => router.push(s.href)}
                  />
                </View>
              ))}
            </View>
          ) : null}

          {/*
            The figures, and the two that can demand action before the two that merely
            describe. Nothing here is decorative: every tile is a number somebody would
            otherwise have to open a screen to learn.
          */}
          <Text role="overline" tone="muted" style={{ marginBottom: space.md }}>
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
        </Page>
      </ScrollView>
    </View>
  );
}
