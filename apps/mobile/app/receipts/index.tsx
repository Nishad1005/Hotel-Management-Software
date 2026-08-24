import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Card, Loading, Notice, PrimaryButton, Screen, StatusPill } from "../../components/ui";
import { listReceipts, type ReceiptSummary } from "../../lib/receipts";
import { useSession } from "../../lib/session";
import { font, space, tabular, type, usePalette } from "../../theme";

/**
 * Posted receipts.
 *
 * Superseded ones are listed rather than filtered out, and marked. A posted receipt is
 * corrected by superseding it, never by editing (PRD section 4 Gate 5) — so the chain IS
 * the record, and a list showing only current versions would be describing it by its
 * links.
 */
function defaultFrom(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 60);
  return d.toISOString().slice(0, 10);
}

export default function Receipts() {
  const router = useRouter();
  const { activeProperty } = useSession();

  const [receipts, setReceipts] = useState<ReceiptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from] = useState(defaultFrom);

  const propertyId = activeProperty?.propertyId ?? null;

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      setReceipts(await listReceipts(propertyId, from));
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

  const amended = receipts.filter((r) => r.supersededByGrnNo !== null).length;

  return (
    <Screen
      title="Goods receipts"
      subtitle={
        loading
          ? "Loading"
          : `${receipts.length} in sixty days${amended > 0 ? ` · ${amended} corrected` : ""}`
      }
      onBack={() => router.back()}
    >
      {loading ? (
        <Loading />
      ) : error ? (
        <Notice icon="cloud-offline-outline" title="Could not load" body={error} tone="bad" />
      ) : receipts.length === 0 ? (
        <Notice
          icon="clipboard-outline"
          title="Nothing received yet"
          body="Receipts appear here as they are posted. A posted receipt cannot be edited — it is corrected by a new one that supersedes it, and both stay on the record."
          action={<PrimaryButton label="Go to receiving" onPress={() => router.push("/receive")} />}
        />
      ) : (
        <Card padded={false}>
          {receipts.map((r, i) => (
            <ReceiptRow
              key={r.grnId}
              receipt={r}
              divider={i < receipts.length - 1}
              onPress={() => router.push(`/receipts/${r.grnId}`)}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}

function ReceiptRow({
  receipt,
  divider,
  onPress,
}: {
  receipt: ReceiptSummary;
  divider: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  const superseded = receipt.supersededByGrnNo !== null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${receipt.grnNo} from ${receipt.vendorName ?? "an unnamed vendor"}`}
      style={({ pressed }) =>
        ({
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: p.border,
          backgroundColor: pressed ? p.surfaceSunken : "transparent",
          // Dimmed rather than hidden. It is still what was posted, and an inspector's
          // question is whether a receipt was changed — not what it says now.
          opacity: superseded ? 0.6 : 1,
          cursor: "pointer",
        }) as ViewStyle
      }
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{ fontSize: type.body, ...font("semibold"), color: p.text }}
          >
            {receipt.vendorName ?? "Vendor not named"}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontSize: type.caption, color: p.textMuted, marginTop: 1, ...tabular }}
          >
            {receipt.grnNo}
            {receipt.gateEntryNo ? ` · ${receipt.gateEntryNo}` : ""} ·{" "}
            {new Date(receipt.postedAt).toLocaleDateString()}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontSize: type.micro, color: p.textFaint, marginTop: 1 }}
          >
            {receipt.lineCount} line{receipt.lineCount === 1 ? "" : "s"}
            {receipt.postedByName ? ` · ${receipt.postedByName}` : ""}
          </Text>
        </View>

        <View style={{ alignItems: "flex-end", marginRight: space.sm }}>
          <Text style={{ fontSize: type.body, ...font("bold"), color: p.text, ...tabular }}>
            {fmt(receipt.totalAccepted)}
          </Text>
          {receipt.totalRejected > 0 ? (
            <Text style={{ fontSize: type.micro, color: p.danger, ...tabular }}>
              {fmt(receipt.totalRejected)} back
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={p.textFaint} />
      </View>

      {superseded || receipt.amendsGrnNo ? (
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.xs }}
        >
          {superseded ? (
            <StatusPill
              icon="git-branch-outline"
              label={`Superseded by ${receipt.supersededByGrnNo}`}
              tone="warn"
            />
          ) : null}
          {receipt.amendsGrnNo ? (
            <StatusPill
              icon="create-outline"
              label={`Corrects ${receipt.amendsGrnNo}${receipt.amendmentReason ? ` — ${receipt.amendmentReason}` : ""}`}
              tone="neutral"
            />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}
