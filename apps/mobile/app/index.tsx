import type { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import {
  Banner,
  PrimaryButton,
  Screen,
  Section,
  SkeletonTiles,
  StatGrid,
  StatTile,
  Text,
} from "../components/ui";
import type { Capability } from "@golai/domain";
import { memberCan } from "../lib/access";
import { FacilityBoard } from "../components/facility-board";
import { onOutboxChange, outbox } from "../lib/outbox";
import { loadOverview, type PropertyOverview } from "../lib/overview";
import { useIsExpanded } from "../lib/responsive";
import { useSession } from "../lib/session";
import { listStorageReadings, type StorageReading } from "../lib/temperature";
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
  const router = useRouter();
  const { activeProperty } = useSession();

  const [pending, setPending] = useState(0);
  const [blocked, setBlocked] = useState(0);
  const [overview, setOverview] = useState<PropertyOverview | null>(null);
  const [readings, setReadings] = useState<StorageReading[]>([]);
  const [loading, setLoading] = useState(true);
  const expanded = useIsExpanded();

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

      /*
        The cold-chain pins, fetched apart from the overview so one failing does not
        blank the other. A property with no rounds walked yet returns nothing, and the
        pins say "No reading yet" rather than showing a number nobody recorded.

        Seven days, not the thirty-six hours this started at. A short window looked
        tidier and quietly turned "nobody has walked the round since Friday" into "no
        reading yet" — which reads as a system that has never been used rather than a
        round that has been missed, and those are opposite facts to a manager. The
        reading is shown however old it is, dated (see `when`), and staleness becomes
        something the reader can see instead of something the query hides.
      */
      void (async () => {
        if (!propertyId) return;
        try {
          const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const rows = await listStorageReadings(propertyId, since);
          if (alive) setReadings(rows);
        } catch {
          if (alive) setReadings([]);
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
    <Screen
      title={activeProperty?.propertyName ?? "PARGOLAI"}
      {...(activeProperty
        ? { subtitle: `${activeProperty.propertyCode} · ${activeProperty.organisationName}` }
        : {})}
      wide
      {...(starts.length > 0
        ? {
            /*
              A button group, sized to its labels.
              
              These were three slabs each a third of the content width, which at 1200px
              made "New arrival" a 380-pixel-wide control — the visual weight of a page
              banner for what is one of several things you might do. Sized to content they
              read as what they are, and the first is the only one wearing the accent.
            */
            band: (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {starts.map((s, index) => (
                  <PrimaryButton
                    key={s.href}
                    label={s.label}
                    icon={s.icon}
                    tone={index === 0 ? "accent" : "neutral"}
                    onPress={() => router.push(s.href)}
                  />
                ))}
              </View>
            ),
          }
        : {})}
    >
      {/* Sync state earns a place at the top only when there is something to say. */}
      {blocked > 0 || pending > 0 ? (
        <Banner
          icon={blocked > 0 ? "warning" : "cloud-upload-outline"}
          tone={blocked > 0 ? "bad" : "warn"}
        >
          {blocked > 0
            ? `${blocked} record${blocked === 1 ? "" : "s"} stuck and need attention`
            : `${pending} waiting to sync`}
        </Banner>
      ) : null}

      {loading ? (
        <>
          <Section title="Waiting on someone">
            <SkeletonTiles count={3} />
          </Section>
          <Section title="Stock health">
            <SkeletonTiles count={4} />
          </Section>
        </>
      ) : (
        <>
          {/*
            The property, drawn, with what is happening on it.

            Placed above the tiles because it answers a different question: the tiles say
            how many, this says where. Only on wide viewports — at 430px the plates are
            too small to read and the pins would overlap into nonsense, and a phone opens
            this app to do a job rather than to survey one.
          */}
          {expanded ? (
            <View style={{ marginBottom: space.xl }}>
              <FacilityBoard
                overview={overview}
                readings={readings}
                propertyCode={activeProperty?.propertyCode ?? ""}
              />
            </View>
          ) : null}

          {/*
            Two sections, and the split is the point.

            Both grids used to sit under one heading whose text changed — so "Waiting on
            someone" was, much of the time, the label over four stock metrics that are not
            waiting on anyone. A queue and a gauge are different kinds of number: one is a
            job with a person's name implicitly on it, the other is a condition to know
            about. Reading them as one list is how a storekeeper ends up treating "412
            stock lines" as a task.
          */}
          <Section
            title={queued > 0 ? `Waiting on someone · ${queued}` : "Waiting on someone"}
            hint="Each of these is a job somebody has to do today."
          >
            <StatGrid>
              {/*
                Amber means late, not busy.

                The rule was `waiting ? warn`, so a single arrival that had been at the
                gate for twenty minutes turned the tile amber — and on a quiet day the one
                coloured thing on the whole dashboard was a false alarm. That is worse than
                no colour at all: it teaches people that the colour means nothing.
              */}
              <StatTile
                kind="queue"
                icon="car-outline"
                label="To receive"
                value={overview?.arrivalsWaiting ?? 0}
                caption={
                  overview?.arrivalsOverdue
                    ? `${overview.arrivalsOverdue} waiting over four hours`
                    : overview?.arrivalsWaiting
                      ? "Arrivals with no receipt"
                      : "Nothing waiting at the gate"
                }
                tone={
                  overview?.arrivalsOverdue
                    ? "bad"
                    : overview?.arrivalsWaiting
                      ? "accent"
                      : "neutral"
                }
                onPress={() => router.push("/receive")}
              />
              <StatTile
                kind="queue"
                icon="file-tray-stacked-outline"
                label="To put away"
                value={overview?.quarantineLines ?? 0}
                caption={
                  overview?.quarantineOldestHours
                    ? `Oldest ${overview.quarantineOldestHours.toFixed(1)} h at T1`
                    : "Nothing at Terminal 1"
                }
                // Four hours is the dwell threshold. Below it, stock at T1 is in transit,
                // not overdue.
                tone={
                  (overview?.quarantineOldestHours ?? 0) >= 4
                    ? "warn"
                    : overview?.quarantineLines
                      ? "accent"
                      : "neutral"
                }
                onPress={() => router.push("/putaway")}
              />
              <StatTile
                kind="queue"
                icon="shield-checkmark-outline"
                label="To gate out"
                value={overview?.awaitingGatePass ?? 0}
                caption={
                  overview?.awaitingGatePass
                    ? "Staged, still on the property"
                    : "Nothing waiting to leave"
                }
                // Staged stock is not late by virtue of being staged; it is waiting for
                // Security, which is the normal state of Terminal 2.
                tone={overview?.awaitingGatePass ? "accent" : "neutral"}
                onPress={() => router.push("/gate-out")}
              />
            </StatGrid>
          </Section>

          <Section
            title={atRisk > 0 ? `Stock health · ${atRisk} to watch` : "Stock health"}
            hint="Worth knowing. None of it needs anybody before lunch."
          >
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
          </Section>

          {/*
            The cold chain, on the dark card the design system reserves for it.

            Only when a round has actually been walked. An empty panel headed "Cold
            chain" invites the reading that the rooms are fine, when what it means is
            that nobody has looked — and that is the one misreading this register exists
            to prevent. Silence here sends people to the Temperature round screen, which
            has its own empty state saying what to do.
          */}
          {readings.length > 0 ? (
            <ColdChainPanel readings={readings} onPress={() => router.push("/registers")} />
          ) : null}
        </>
      )}
    </Screen>
  );
}

/**
 * Latest reading per cold unit, newest first.
 *
 * No thresholds and no verdict: `temperature_reading` records what the thermometer said
 * and the enforcement mode for cold-chain rules ships at RECORD_ONLY (PRD section 8), so
 * a panel that coloured −12° red would be asserting a rule the system does not hold.
 * Witness before you enforce.
 */
function ColdChainPanel({
  readings,
  onPress,
}: {
  readings: StorageReading[];
  onPress: () => void;
}) {
  const p = usePalette();

  const latest = new Map<string, StorageReading>();
  for (const r of readings) if (!latest.has(r.locationId)) latest.set(r.locationId, r);
  const rows = [...latest.values()];

  return (
    <View
      style={{
        backgroundColor: p.brand,
        borderRadius: radius.lg,
        padding: space.lg,
        marginBottom: space.xl,
      }}
    >
      <Text role="overline" style={{ color: p.brassOnBrand, marginBottom: space.md }}>
        Cold chain · last round
      </Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xl }}>
        {rows.map((r) => (
          <View key={r.locationId} style={{ minWidth: 140 }}>
            <Text role="display" tone="onBrand" numeric>
              {r.temperatureC}°
            </Text>
            <Text role="label" tone="onBrand" lines={1} style={{ marginTop: space.xxs }}>
              {r.locationName}
            </Text>
            <Text role="caption" tone="onBrandMuted" lines={1}>
              {new Date(r.recordedAt).toLocaleString([], {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ marginTop: space.lg, alignSelf: "flex-start" }}>
        <PrimaryButton label="Open the register" tone="neutral" onPress={onPress} />
      </View>
    </View>
  );
}
