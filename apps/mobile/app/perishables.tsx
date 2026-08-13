import { Ionicons } from "@expo/vector-icons";
import { daysRemaining, expiryStatus, shelfLifeRemainingPct, sortByFefo } from "@golai/domain";
import type { ExpiryState } from "@golai/domain";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Header, Notice, Page, PrimaryButton, StatusPill } from "../components/ui";
import { useSession } from "../lib/session";
import { listStockOnHand, moveStockOut, newSubmissionId, type StockLine } from "../lib/stock";
import { elevation, font, radius, space, touch, type, usePalette } from "../theme";

/**
 * What is expiring, and in what order to use it.
 *
 * Sorted FEFO within each bucket, so the list doubles as a use-first order rather than
 * only a warning. Every bucket carries an icon and a label as well as a colour —
 * colour alone would exclude anyone who cannot distinguish red from amber, and this is
 * a screen people scan quickly.
 */

// Assam defaults. Category-specific thresholds arrive with the rule dashboard at P2.
const THRESHOLDS = { criticalDays: 2, nearingDays: 7 };

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
  const insets = useSafeAreaInsets();
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
      const state = expiryStatus(line.bestBefore, now, THRESHOLDS);
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
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <View
        style={[
          {
            backgroundColor: p.surface,
            paddingTop: insets.top + space.lg,
            paddingHorizontal: space.lg,
            paddingBottom: space.md,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: p.border,
          },
          elevation(1, p),
        ]}
      >
        <Page>
          <Header
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
          />
        </Page>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl * 2 }}>
        <Page>
          {loading ? (
            <ActivityIndicator style={{ marginTop: space.xxl }} color={p.accent} />
          ) : error ? (
            <Notice
              icon="alert-circle-outline"
              tone="bad"
              title="Could not load stock"
              body={error}
            />
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
                    style={({ pressed }) =>
                      ({
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: touch.desk,
                        marginTop: space.md,
                        borderRadius: radius.md,
                        backgroundColor: pressed ? p.surfaceSunken : "transparent",
                        cursor: "pointer",
                      }) as never
                    }
                  >
                    <Text style={{ fontSize: type.label, color: p.textMuted, ...font("medium") }}>
                      {rows.length} fresh — show
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={p.textMuted} />
                  </Pressable>
                );
              }

              return (
                <View key={bucket.state} style={{ marginBottom: space.xl }}>
                  <View
                    style={{ flexDirection: "row", alignItems: "center", marginBottom: space.sm }}
                  >
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
                    <Text
                      style={{
                        fontSize: type.micro,
                        ...font("bold"),
                        letterSpacing: 0.9,
                        textTransform: "uppercase",
                        color: p.textFaint,
                        marginLeft: space.xs,
                        flex: 1,
                      }}
                    >
                      {bucket.title} · {rows.length}
                    </Text>
                  </View>
                  {bucket.blurb ? (
                    <Text
                      style={{
                        fontSize: type.caption,
                        color: p.textMuted,
                        marginBottom: space.sm,
                      }}
                    >
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
        </Page>
      </ScrollView>
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
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: p.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{ fontSize: type.body, ...font("semibold"), color: p.text }}
          >
            {line.itemName}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontSize: type.caption, color: p.textMuted, marginTop: 1 }}
          >
            {line.batchNo}
            {"  ·  "}
            {line.locationCode}
            {"  ·  "}
            <Text style={{ fontVariant: ["tabular-nums"] }}>
              {line.qty} {line.uomCode}
            </Text>
          </Text>
        </View>

        <View style={{ alignItems: "flex-end", marginLeft: space.sm }}>
          <Text
            style={{
              fontSize: type.subheading,
              ...font("bold"),
              color: tone,
              fontVariant: ["tabular-nums"],
            }}
          >
            {left === null ? "—" : left < 0 ? `${Math.abs(left)}d ago` : `${left}d`}
          </Text>
          {pct !== null ? (
            <Text
              style={{ fontSize: type.micro, color: p.textFaint, fontVariant: ["tabular-nums"] }}
            >
              {pct}% left
            </Text>
          ) : null}
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
