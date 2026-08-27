import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import {
  Card,
  Notice,
  Screen,
  SkeletonList,
  StatGrid,
  StatTile,
  StatusPill,
  Text,
} from "../../components/ui";
import { DISPATCH_TYPES } from "../../lib/dispatch";
import {
  listInwardRegister,
  listWasteRegister,
  REJECT_LABELS,
  type InwardRow,
  type WasteRow,
} from "../../lib/registers";
import { useSession } from "../../lib/session";
import { radius, space, usePalette } from "../../theme";

/**
 * The FSSAI registers.
 *
 * There is no capture on this screen and there never will be. That is the product
 * argument (PRD section 7.1): the compliance module is not a checklist app beside the
 * flow, it is the flow read back. Every column below was recorded at the dock by somebody
 * who was not thinking about an inspection, which is precisely what makes it worth
 * showing to one — a register filled in for the inspector gets filled in the night
 * before, and this one cannot be.
 *
 * Three of section 7.2's `[P1]` registers are one dataset. Inward material check, receipt
 * temperature and non-conforming material differ only in which rows you look at, so they
 * are tabs over one query rather than three screens that could drift apart.
 */

type Tab = "INWARD" | "TEMPERATURE" | "NONCONFORMING" | "WASTE";

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "INWARD", label: "Inward material", hint: "Everything received" },
  { id: "TEMPERATURE", label: "Receipt temperature", hint: "Cold-chain probe readings" },
  { id: "NONCONFORMING", label: "Non-conforming", hint: "What was turned away" },
  { id: "WASTE", label: "Waste disposal", hint: "Food waste, UCO, condemned" },
];

/** A month back. Long enough to be useful, short enough to load on a dock tablet. */
function defaultFrom(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

export default function Registers() {
  const router = useRouter();
  const { activeProperty } = useSession();

  const [tab, setTab] = useState<Tab>("INWARD");
  const [from] = useState(defaultFrom);
  const [inward, setInward] = useState<InwardRow[]>([]);
  const [waste, setWaste] = useState<WasteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const propertyId = activeProperty?.propertyId ?? null;

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      // Both together. They are two queries over the same period and the tabs switch
      // instantly rather than showing a spinner per press.
      const [i, w] = await Promise.all([
        listInwardRegister(propertyId, from, null),
        listWasteRegister(propertyId, from, null),
      ]);
      setInward(i);
      setWaste(w);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId, from]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const rows = useMemo(() => {
    if (tab === "TEMPERATURE") return inward.filter((r) => r.receiptTempC !== null);
    if (tab === "NONCONFORMING") return inward.filter((r) => r.decision !== "ACCEPT");
    return inward;
  }, [tab, inward]);

  // Counted over the whole period rather than the visible tab, because the figures are
  // the summary an inspector asks for before they look at any rows.
  const summary = useMemo(() => {
    const probed = inward.filter((r) => r.receiptTempC !== null);
    return {
      lines: inward.length,
      rejected: inward.filter((r) => r.decision !== "ACCEPT").length,
      probed: probed.length,
      outOfRange: probed.filter((r) => r.tempInRange === false).length,
      waste: waste.length,
    };
  }, [inward, waste]);

  return (
    <Screen
      title="Registers"
      subtitle="The last thirty days — nothing here was entered twice"
      onBack={() => router.back()}
    >
      {loading ? (
        <SkeletonList />
      ) : error ? (
        <Notice
          icon="cloud-offline-outline"
          title="Could not load the registers"
          body={error}
          tone="bad"
        />
      ) : (
        <>
          <StatGrid>
            <StatTile
              icon="clipboard-outline"
              label="Lines received"
              value={summary.lines}
              caption="Inward material check"
              tone="accent"
            />
            <StatTile
              icon="thermometer-outline"
              label="Out of range"
              value={summary.outOfRange}
              caption={`${summary.probed} probe reading${summary.probed === 1 ? "" : "s"}`}
              tone={summary.outOfRange ? "warn" : "neutral"}
            />
            <StatTile
              icon="close-circle-outline"
              label="Turned away"
              value={summary.rejected}
              caption="Non-conforming material"
              tone={summary.rejected ? "warn" : "neutral"}
            />
            <StatTile
              icon="trash-outline"
              label="Waste out"
              value={summary.waste}
              caption="Food waste, UCO, condemned"
              tone="neutral"
            />
          </StatGrid>

          <View style={{ height: space.xl }} />

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {TABS.map((t) => (
              <TabChip
                key={t.id}
                label={t.label}
                hint={t.hint}
                selected={tab === t.id}
                onPress={() => setTab(t.id)}
              />
            ))}
          </View>

          <View style={{ height: space.lg }} />

          {tab === "WASTE" ? (
            waste.length === 0 ? (
              <Notice
                icon="trash-outline"
                title="No waste has left in thirty days"
                body="Food waste, used cooking oil and condemned stock appear here as they leave through Terminal 2. Nothing is logged separately — this is the dispatch record, filtered."
              />
            ) : (
              <Card padded={false}>
                {waste.map((w, i) => (
                  <WasteRowView
                    key={`${w.dispatchNo}-${w.batchNo}-${i}`}
                    row={w}
                    divider={i < waste.length - 1}
                  />
                ))}
              </Card>
            )
          ) : rows.length === 0 ? (
            <Notice
              icon="clipboard-outline"
              title={
                tab === "NONCONFORMING"
                  ? "Nothing was turned away"
                  : tab === "TEMPERATURE"
                    ? "No probe readings yet"
                    : "Nothing received in thirty days"
              }
              body={
                tab === "TEMPERATURE"
                  ? "A probe reading is taken on every cold-chain line at Gate 3, and appears here without anybody recording it twice."
                  : "Every goods receipt writes this register as it posts. Receive a delivery and it fills itself."
              }
            />
          ) : (
            <Card padded={false}>
              {rows.map((r, i) => (
                <InwardRowView
                  key={`${r.grnNo}-${r.itemCode}-${r.batchNo}-${i}`}
                  row={r}
                  showTemperature={tab === "TEMPERATURE"}
                  divider={i < rows.length - 1}
                  onPress={
                    r.batchId ? () => router.push(`/registers/trace/${r.batchId}`) : undefined
                  }
                />
              ))}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

function TabChip({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}. ${hint}`}
      style={({ pressed, hovered }) =>
        ({
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.md,
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
          borderColor: selected ? p.accent : p.border,
          backgroundColor: selected
            ? p.accentSurface
            : pressed || hovered
              ? p.surfaceSunken
              : p.surface,
          cursor: "pointer",
        }) as ViewStyle
      }
    >
      <Text role="label" weight="semibold" tone={selected ? "accent" : "default"}>
        {label}
      </Text>
    </Pressable>
  );
}

function InwardRowView({
  row,
  showTemperature,
  divider,
  onPress,
}: {
  row: InwardRow;
  showTemperature: boolean;
  divider: boolean;
  onPress?: (() => void) | undefined;
}) {
  const p = usePalette();

  const body = (
    <>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text lines={1} weight="semibold">
            {row.itemName}
          </Text>
          <Text lines={1} role="caption" tone="muted" style={{ marginTop: 1 }}>
            {row.vendorName ?? "Vendor not named"} · {row.grnNo}
            {row.gateEntryNo ? ` · ${row.gateEntryNo}` : ""}
          </Text>
          <Text lines={1} role="caption" tone="muted" style={{ marginTop: 1 }}>
            {new Date(row.receivedAt).toLocaleDateString()} · batch {row.batchNo ?? "—"}
            {row.receivedBy ? ` · ${row.receivedBy}` : ""}
          </Text>
        </View>

        <View style={{ alignItems: "flex-end" }}>
          <Text weight="bold" numeric>
            {fmt(row.qtyAccepted)}
            <Text role="caption" tone="muted">
              {" "}
              {row.uomCode}
            </Text>
          </Text>
          {row.qtyRejected > 0 ? (
            <Text role="caption" tone="danger" numeric>
              {fmt(row.qtyRejected)} back
            </Text>
          ) : null}
        </View>
        {onPress ? (
          <Ionicons
            name="git-branch-outline"
            size={16}
            color={p.textFaint}
            style={{ marginLeft: space.sm, marginTop: 2 }}
          />
        ) : null}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.xs }}>
        {row.decision !== "ACCEPT" ? (
          <StatusPill
            icon="close-circle"
            label={
              row.rejectReason
                ? REJECT_LABELS[row.rejectReason]
                : row.decision === "REJECT"
                  ? "Rejected"
                  : "Part rejected"
            }
            tone="bad"
          />
        ) : null}

        {/*
          Shown on the temperature tab whether or not it is a problem, because a register
          of only the failures is not a temperature record — an inspector is checking that
          readings were taken at all.
        */}
        {row.receiptTempC !== null && (showTemperature || row.tempInRange === false) ? (
          <StatusPill
            icon="thermometer-outline"
            label={
              row.tempMinC !== null && row.tempMaxC !== null
                ? `${row.receiptTempC} °C (${row.tempMinC} to ${row.tempMaxC})`
                : `${row.receiptTempC} °C`
            }
            tone={row.tempInRange === false ? "bad" : row.tempInRange ? "good" : "neutral"}
          />
        ) : null}

        {row.bestBefore ? (
          <StatusPill label={`Best before ${row.bestBefore}`} tone="neutral" />
        ) : null}
        {row.vendorFssai ? <StatusPill label={`FSSAI ${row.vendorFssai}`} tone="neutral" /> : null}
      </View>
    </>
  );

  const style: ViewStyle = {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
    borderBottomColor: p.border,
  };

  if (!onPress) return <View style={style}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Trace ${row.itemName}, batch ${row.batchNo ?? ""}`}
      style={({ pressed, hovered }) =>
        ({
          ...style,
          backgroundColor: pressed ? p.border : hovered ? p.surfaceSunken : "transparent",
          cursor: "pointer",
        }) as ViewStyle
      }
    >
      {body}
    </Pressable>
  );
}

function WasteRowView({ row, divider }: { row: WasteRow; divider: boolean }) {
  const p = usePalette();
  const kind = DISPATCH_TYPES.find((t) => t.id === row.dispatchType)?.label ?? row.dispatchType;

  return (
    <View
      style={{
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: p.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text lines={1} weight="semibold">
            {row.itemName}
          </Text>
          <Text lines={1} role="caption" tone="muted" style={{ marginTop: 1 }}>
            {kind} · {row.recipientName ?? "Handler not named"} · {row.dispatchNo}
          </Text>
          <Text lines={1} role="caption" tone="muted" style={{ marginTop: 1 }}>
            {new Date(row.dispatchedAt).toLocaleDateString()} · batch {row.batchNo}
            {row.reasonCode ? ` · ${row.reasonCode}` : ""}
          </Text>
        </View>
        <Text weight="bold" numeric>
          {fmt(row.qty)}
          <Text role="caption" tone="muted">
            {" "}
            {row.uomCode}
          </Text>
        </Text>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.xs }}>
        {/*
          An unclosed consignment is shown rather than omitted. Staged waste that never
          left is the row an inspector would want, and a register that only lists completed
          departures is one that hides it.
        */}
        {row.gatePassNo ? (
          <StatusPill
            icon="shield-checkmark-outline"
            label={`${row.gatePassNo}${row.carrier ? ` · ${row.carrier}` : ""}`}
            tone="good"
          />
        ) : (
          <StatusPill icon="time-outline" label="Staged, not yet gone" tone="warn" />
        )}
        {row.vehicleNumber ? <StatusPill label={row.vehicleNumber} tone="neutral" /> : null}
        {row.recipientFssai ? (
          <StatusPill label={`FSSAI ${row.recipientFssai}`} tone="neutral" />
        ) : null}
      </View>
    </View>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}
