import type { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import {
  Banner,
  Loading,
  PrimaryButton,
  Screen,
  Section,
  StatGrid,
  StatTile,
} from "../components/ui";
import type { Capability } from "@golai/domain";
import { memberCan } from "../lib/access";
import { onOutboxChange, outbox } from "../lib/outbox";
import { loadOverview, type PropertyOverview } from "../lib/overview";
import { useSession } from "../lib/session";
import { space } from "../theme";

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
        <Loading />
      ) : (
        <>
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
                  overview?.arrivalsOverdue ? "bad" : overview?.arrivalsWaiting ? "warn" : "neutral"
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
        </>
      )}
    </Screen>
  );
}
