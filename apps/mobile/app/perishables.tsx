import { Ionicons } from "@expo/vector-icons";
import {
  daysRemaining,
  DEFAULT_EXPIRY_THRESHOLDS,
  expiryStatus,
  shelfLifeRemainingPct,
  sortByFefo,
} from "@golai/domain";
import type { ExpiryState } from "@golai/domain";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  Card,
  Notice,
  PrimaryButton,
  Screen,
  SkeletonList,
  StatusPill,
  Text,
} from "../components/ui";
import { useSession } from "../lib/session";
import { listStockOnHand, moveStockOut, newSubmissionId, type StockLine } from "../lib/stock";
import { radius, space, touch, usePalette } from "../theme";

/**
 * What is expiring, and in what order to use it.
 *
 * Sorted FEFO within each bucket, so the list doubles as a use-first order rather than
 * only a warning. Every bucket carries an icon and a label as well as a colour —
 * colour alone would exclude anyone who cannot distinguish red from amber, and this is
 * a screen people scan quickly.
 */

// Assam defaults. Category-specific thresholds arrive with the rule dashboard at P2.

const BUCKETS: {
  state: ExpiryState;
  title: string;
  blurb: string;
  icon: "alert-circle" | "warning" | "time-outline" | "checkmark-circle";
  tone: "bad" | "warn" | "neutral" | "good";
}[] = [
  {
    state: "EXPIRED",
    title: "Expired",
    blurb: "Past best-before. Write off — this cannot be served.",
    icon: "alert-circle",
    tone: "bad",
  },
  {
    state: "CRITICAL",
    title: "Use today",
    blurb: "Two days or fewer remaining.",
    icon: "warning",
    tone: "warn",
  },
  {
    state: "NEARING",
    title: "Use this week",
    blurb: "Within a week of best-before.",
    icon: "time-outline",
    tone: "neutral",
  },
  { state: "FRESH", title: "Fresh", blurb: "", icon: "checkmark-circle", tone: "good" },
];

export default function Perishables() {
  const p = usePalette();
  const router = useRouter();
  const { activeProperty } = useSession();

  const [lines, setLines] = useState<StockLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyBatch, setBusyBatch] = useState<string | null>(null);
  const [showFresh, setShowFresh] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listStockOnHand();
      setLines(rows);
      setNow(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const grouped = useMemo(() => {
    const dated = lines.filter((l) => l.state === "AVAILABLE");
    const byBucket = new Map<ExpiryState, StockLine[]>();
    for (const line of sortByFefo(dated)) {
      const state = expiryStatus(line.bestBefore, now, DEFAULT_EXPIRY_THRESHOLDS);
      byBucket.set(state, [...(byBucket.get(state) ?? []), line]);
    }
    return byBucket;
  }, [lines, now]);

  async function writeOff(line: StockLine) {
    if (!activeProperty) return;
    setBusyBatch(line.batchId);
    try {
      await moveStockOut({
        propertyId: activeProperty.propertyId,
        line,
        qty: line.qty,
        reason: "WRITE_OFF_EXPIRED",
        // No destination state: the stock leaves the books entirely. The movement
        // remains, which is what makes the waste register derivable later rather than
        // separately entered (PRD section 7.2).
        toState: null,
        note: "Expired",
        // One id per press. The button disables while this runs, but a lost response
        // followed by a retry must not write the stock off twice — and the ledger is
        // append-only, so a duplicate is not something anyone can tidy up afterwards.
        submissionId: newSubmissionId(),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyBatch(null);
    }
  }

  const totalTracked = lines.filter((l) => l.state === "AVAILABLE").length;
  const atRisk = (grouped.get("EXPIRED")?.length ?? 0) + (grouped.get("CRITICAL")?.length ?? 0);

  return (
    <Screen
      title="Expiring soon"
      {...(loading
        ? {}
        : {
            subtitle:
              totalTracked === 0
                ? "Nothing in stock yet"
                : `${atRisk} of ${totalTracked} need attention`,
          })}
      onBack={() => router.back()}
      {...(!loading && totalTracked > 0
        ? {
            band: (
              /*
                The verdict, before any scrolling. A bucket with nothing in it is shown
                greyed rather than hidden, so the row keeps the same shape every visit and
                "zero expired" is something you can see rather than infer from an absence.
              */
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <CountChip label="Expired" count={grouped.get("EXPIRED")?.length ?? 0} tone="bad" />
                <CountChip
                  label="Use today"
                  count={grouped.get("CRITICAL")?.length ?? 0}
                  tone="warn"
                />
                <CountChip
                  label="This week"
                  count={grouped.get("NEARING")?.length ?? 0}
                  tone="neutral"
                />
              </View>
            ),
          }
        : {})}
    >
      {loading ? (
        <SkeletonList />
      ) : error ? (
        <Notice icon="alert-circle-outline" tone="bad" title="Could not load stock" body={error} />
      ) : totalTracked === 0 ? (
        <Notice
          icon="cube-outline"
          title="No stock recorded"
          body="Record what is physically in the store — item, quantity, location and best-before — and it will appear here."
          action={
            <PrimaryButton
              label="Record opening stock"
              icon="download-outline"
              onPress={() => router.push("/stock/opening")}
            />
          }
        />
      ) : (
        BUCKETS.map((bucket) => {
          const rows = grouped.get(bucket.state) ?? [];
          if (rows.length === 0) return null;
          if (bucket.state === "FRESH" && !showFresh) {
            return (
              <Pressable
                key={bucket.state}
                onPress={() => setShowFresh(true)}
                accessibilityRole="button"
                accessibilityLabel={`Show ${rows.length} fresh items`}
                style={({ pressed, hovered }) =>
                  ({
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: touch.desk,
                    marginTop: space.md,
                    borderRadius: radius.md,
                    backgroundColor: pressed ? p.border : hovered ? p.surfaceSunken : "transparent",
                    cursor: "pointer",
                  }) as never
                }
              >
                <Text role="label" tone="muted" weight="medium">
                  {rows.length} fresh — show
                </Text>
                <Ionicons name="chevron-down" size={16} color={p.textMuted} />
              </Pressable>
            );
          }

          return (
            <View key={bucket.state} style={{ marginBottom: space.xl }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.sm }}>
                <Ionicons
                  name={bucket.icon}
                  size={16}
                  color={
                    bucket.tone === "bad"
                      ? p.danger
                      : bucket.tone === "warn"
                        ? p.warning
                        : bucket.tone === "good"
                          ? p.success
                          : p.textMuted
                  }
                />
                <Text role="overline" tone="muted" style={{ marginLeft: space.xs, flex: 1 }}>
                  {bucket.title} · {rows.length}
                </Text>
              </View>
              {bucket.blurb ? (
                <Text role="caption" tone="muted" style={{ marginBottom: space.sm }}>
                  {bucket.blurb}
                </Text>
              ) : null}

              <Card padded={false}>
                {rows.map((line, i) => (
                  <StockRow
                    key={`${line.batchId}-${line.locationId}`}
                    line={line}
                    now={now}
                    bucket={bucket.state}
                    divider={i < rows.length - 1}
                    busy={busyBatch === line.batchId}
                    onWriteOff={() => void writeOff(line)}
                  />
                ))}
              </Card>
            </View>
          );
        })
      )}
    </Screen>
  );
}

/** One bucket's count. Greyed at zero rather than hidden, so the row keeps its shape. */
function CountChip({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "bad" | "warn" | "neutral";
}) {
  const p = usePalette();
  const live = count > 0;
  const ink = !live
    ? p.textFaint
    : tone === "bad"
      ? p.danger
      : tone === "warn"
        ? p.warning
        : p.text;
  const wash = !live
    ? p.surfaceSunken
    : tone === "bad"
      ? p.dangerSurface
      : tone === "warn"
        ? p.warningSurface
        : p.surfaceSunken;

  return (
    <View
      style={{
        flex: 1,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        backgroundColor: wash,
      }}
    >
      <Text role="heading" weight="heavy" numeric style={{ color: ink }}>
        {count}
      </Text>
      <Text role="caption" weight="semibold" lines={1} style={{ color: live ? ink : p.textMuted }}>
        {label}
      </Text>
    </View>
  );
}

function StockRow({
  line,
  now,
  bucket,
  divider,
  busy,
  onWriteOff,
}: {
  line: StockLine;
  now: number;
  bucket: ExpiryState;
  divider: boolean;
  busy: boolean;
  onWriteOff: () => void;
}) {
  const p = usePalette();
  const left = daysRemaining(line.bestBefore, now);
  const pct = shelfLifeRemainingPct(line.bestBefore, line.shelfLifeTotalDays, now);

  const tone =
    bucket === "EXPIRED"
      ? p.danger
      : bucket === "CRITICAL"
        ? p.warning
        : bucket === "NEARING"
          ? p.textMuted
          : p.success;

  return (
    <View
      style={{
        paddingLeft: space.lg - 3,
        paddingRight: space.lg,
        paddingVertical: space.md,
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: p.border,
        // A coloured edge groups the list by urgency at a glance, before any text is
        // read. Cheaper than tinting the whole row, which would fight the type.
        borderLeftWidth: 3,
        borderLeftColor: bucket === "FRESH" ? "transparent" : tone,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0, paddingRight: space.sm }}>
          <Text role="heading" lines={1}>
            {line.itemName}
          </Text>
          <Text role="caption" tone="muted" lines={1} style={{ marginTop: 2 }}>
            {/* Quantity first and in the stronger weight: it is the figure somebody
                acts on, and it was previously last behind two codes. */}
            <Text role="caption" weight="semibold" numeric>
              {line.qty} {line.uomCode}
            </Text>
            {"  ·  "}
            {line.batchNo}
            {"  ·  "}
            {line.locationCode}
          </Text>
        </View>

        <View style={{ alignItems: "flex-end" }}>
          {/* The thing the eye is hunting for down a long list, so it is set largest. */}
          <Text role="title" weight="heavy" numeric style={{ color: tone }}>
            {left === null ? "—" : left < 0 ? Math.abs(left) : left}
            {left === null ? "" : "d"}
          </Text>
          <Text
            role="caption"
            weight="semibold"
            style={{ color: left !== null && left < 0 ? tone : p.textMuted }}
          >
            {left === null ? "no date" : left < 0 ? "ago" : pct !== null ? `${pct}% left` : "left"}
          </Text>
        </View>
      </View>

      {/* A bar reads faster than a number when scanning a long list. */}
      {pct !== null ? (
        <View
          style={{
            height: 4,
            borderRadius: radius.pill,
            backgroundColor: p.surfaceSunken,
            marginTop: space.sm,
            overflow: "hidden",
          }}
        >
          <View style={{ width: `${Math.max(pct, 2)}%`, height: 4, backgroundColor: tone }} />
        </View>
      ) : null}

      {bucket === "EXPIRED" ? (
        <View style={{ flexDirection: "row", marginTop: space.md, gap: space.sm }}>
          <StatusPill icon="close-circle" label="Cannot be served" tone="bad" />
          <View style={{ flex: 1 }} />
          <PrimaryButton
            label={busy ? "Writing off…" : "Write off"}
            tone="danger"
            onPress={onWriteOff}
            disabled={busy}
          />
        </View>
      ) : null}
    </View>
  );
}
