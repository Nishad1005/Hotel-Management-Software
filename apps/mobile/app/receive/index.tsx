import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Card, Loading, Notice, Screen, StatusPill, Text } from "../../components/ui";
import { listOpenArrivals, type OpenArrival } from "../../lib/receiving";
import { useSession } from "../../lib/session";
import { radius, space, usePalette } from "../../theme";

/**
 * The receiving worklist.
 *
 * This list and the reconciliation control are the same thing (PRD section 1). An
 * arrival leaves it by becoming a goods receipt and by no other means, so an entry
 * sitting here at the end of a shift is the control working rather than a stale row.
 *
 * Which is also why there is no "receive without an arrival" button. A receipt with no
 * gate entry is the orphan on the other side — it would post perfectly well and quietly
 * break the one claim this module makes.
 */
export default function ReceivingWorklist() {
  const router = useRouter();
  const { activeProperty } = useSession();

  const [arrivals, setArrivals] = useState<OpenArrival[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const propertyId = activeProperty?.propertyId ?? null;

  // On focus rather than on mount: coming back from posting a receipt has to drop that
  // arrival off the list, and a mount-only load would leave it sitting there looking
  // unreceived.
  useFocusEffect(
    useCallback(() => {
      if (!propertyId) return;
      let alive = true;
      setLoading(true);
      void (async () => {
        try {
          const next = await listOpenArrivals(propertyId);
          if (alive) {
            setArrivals(next);
            setError(null);
          }
        } catch (e) {
          if (alive) setError(e instanceof Error ? e.message : String(e));
        } finally {
          if (alive) setLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [propertyId]),
  );

  const waiting = arrivals.length;
  // Dwell at the gate. Recorded permanently against the batch once the receipt posts;
  // until then it is only a prompt, which is what the colour is for.
  const overdue = arrivals.filter((a) => a.hoursOpen >= 4).length;

  return (
    <Screen
      title="Receiving"
      subtitle={
        loading
          ? "Loading arrivals"
          : waiting === 0
            ? "Nothing waiting at the dock"
            : `${waiting} arrival${waiting === 1 ? "" : "s"} to receive${
                overdue > 0 ? ` · ${overdue} waiting over four hours` : ""
              }`
      }
      onBack={() => router.back()}
    >
      {loading ? (
        <Loading />
      ) : error ? (
        <Notice
          icon="cloud-offline-outline"
          title="Could not load arrivals"
          body={error}
          tone="bad"
        />
      ) : arrivals.length === 0 ? (
        <Notice
          icon="checkmark-circle-outline"
          title="Every arrival is accounted for"
          body="Security records vehicles as they reach the gate, and each one appears here until a goods receipt is posted against it. Nothing is outstanding."
        />
      ) : (
        <Card padded={false}>
          {arrivals.map((a, i) => (
            <ArrivalRow
              key={a.id}
              arrival={a}
              divider={i < arrivals.length - 1}
              onPress={() => router.push(`/receive/${a.id}`)}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}

/**
 * One waiting arrival.
 *
 * Not the shared `Row`: the number, the vendor and the time waiting are three separate
 * facts read at three different moments, and flattening them into label plus sublabel
 * loses the one that decides which vehicle to deal with first.
 */
function ArrivalRow({
  arrival,
  divider,
  onPress,
}: {
  arrival: OpenArrival;
  divider: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  const [hovered, setHovered] = useState(false);

  const hours = arrival.hoursOpen;
  const waited =
    hours < 1
      ? `${Math.max(1, Math.round(hours * 60))} min at the gate`
      : `${hours.toFixed(1)} h at the gate`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Receive ${arrival.gateEntryNo} from ${arrival.partyName ?? "an unnamed vendor"}, ${waited}`}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        minHeight: 72,
        backgroundColor: pressed ? p.border : hovered ? p.surfaceSunken : "transparent",
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: p.border,
        cursor: "pointer",
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.sm,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: hours >= 4 ? p.warningSurface : p.accentSurface,
          marginRight: space.md,
        }}
      >
        <Ionicons name="cube-outline" size={20} color={hours >= 4 ? p.warning : p.accent} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text role="heading" lines={1}>
          {arrival.partyName ?? "Vendor not named"}
        </Text>
        <Text role="caption" tone="muted" lines={1} style={{ marginTop: 1 }}>
          {arrival.gateEntryNo} · {arrival.packageCount} package
          {arrival.packageCount === 1 ? "" : "s"}
          {arrival.vehicleNumber ? ` · ${arrival.vehicleNumber}` : ""}
        </Text>
      </View>

      {/*
        A pill only when the wait is a problem. Every row carrying a neutral "23 min at
        the gate" chip spent the eye's attention on the one fact that was never going to
        change which vehicle you deal with first.
      */}
      {hours >= 4 ? (
        <View style={{ marginLeft: space.sm }}>
          <StatusPill icon="hourglass" label={waited} tone="warn" />
        </View>
      ) : (
        <Text role="caption" tone="muted" numeric style={{ marginLeft: space.sm }}>
          {waited.replace(" at the gate", "")}
        </Text>
      )}

      <Ionicons
        name="chevron-forward"
        size={18}
        color={p.textMuted}
        style={{ marginLeft: space.xs }}
      />
    </Pressable>
  );
}
