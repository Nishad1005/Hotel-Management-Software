import { Ionicons } from "@expo/vector-icons";
import type { ScanMethod } from "@golai/db";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScanField } from "../../components/scan-field";
import {
  Card,
  Field,
  FieldError,
  Header,
  Notice,
  Page,
  PrimaryButton,
  StatusPill,
} from "../../components/ui";
import { listAwaitingPutaway, putAway, type AwaitingPutaway } from "../../lib/putaway";
import { useSession } from "../../lib/session";
import { newSubmissionId } from "../../lib/stock";
import { elevation, font, radius, space, tabular, type, usePalette } from "../../theme";

/**
 * Gate 6 — put-away.
 *
 * Stock is in QUARANTINE at Terminal 1: on the books, not issuable. This is the gate that
 * makes it available, and until it is passed the receiving bay is exactly as untrustworthy
 * as it was before the app existed.
 *
 * The order is choose-then-scan, not scan-then-choose. A storekeeper is standing at a
 * pallet, walks to a bin, and reads the label there — so the pallet is known first and the
 * destination is the thing that arrives from the scanner.
 */
export default function PutAway() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeProperty } = useSession();

  const [waiting, setWaiting] = useState<AwaitingPutaway[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AwaitingPutaway | null>(null);
  const [done, setDone] = useState<{ code: string; qty: number; item: string } | null>(null);

  const propertyId = activeProperty?.propertyId ?? null;

  const refresh = useCallback(async () => {
    if (!propertyId) return;
    try {
      const next = await listAwaitingPutaway(propertyId);
      setWaiting(next);
      setError(null);
      // The selection follows the server, not the screen's memory of it. A part
      // put-away leaves a smaller quantity behind and the panel has to show that
      // rather than the number it opened with.
      setSelected((current) =>
        current ? (next.find((w) => w.batchId === current.batchId) ?? null) : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void refresh();
    }, [refresh]),
  );

  const overdue = waiting.filter((w) => (w.hoursWaiting ?? 0) >= 4).length;

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
            title="Put away"
            subtitle={
              loading
                ? "Loading Terminal 1"
                : waiting.length === 0
                  ? "Terminal 1 is clear"
                  : `${waiting.length} line${waiting.length === 1 ? "" : "s"} waiting${
                      overdue > 0 ? ` · ${overdue} standing over four hours` : ""
                    }`
            }
            onBack={() => router.back()}
          />
        </Page>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + 48 }}
        keyboardShouldPersistTaps="handled"
      >
        <Page>
          {done ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: p.successSurface,
                borderRadius: radius.md,
                padding: space.md,
                marginBottom: space.lg,
              }}
              accessibilityLiveRegion="polite"
            >
              <Ionicons name="checkmark-circle" size={18} color={p.success} />
              <Text
                style={{
                  flex: 1,
                  fontSize: type.caption,
                  ...font("semibold"),
                  color: p.success,
                  marginLeft: space.sm,
                }}
              >
                {done.qty} {done.item} put away in {done.code}.
              </Text>
            </View>
          ) : null}

          {loading ? (
            <View style={{ paddingVertical: space.xxxl, alignItems: "center" }}>
              <ActivityIndicator size="large" color={p.accent} />
            </View>
          ) : error ? (
            <Notice
              icon="cloud-offline-outline"
              title="Could not load Terminal 1"
              body={error}
              tone="bad"
            />
          ) : waiting.length === 0 ? (
            <Notice
              icon="checkmark-circle-outline"
              title="Nothing waiting at Terminal 1"
              body="Everything received has been put away, so all of it is issuable. Stock appears here the moment a goods receipt is posted."
              action={
                <PrimaryButton label="Go to receiving" onPress={() => router.push("/receive")} />
              }
            />
          ) : selected ? (
            <DestinationPanel
              line={selected}
              propertyId={propertyId ?? ""}
              onCancel={() => setSelected(null)}
              onDone={(result) => {
                setDone(result);
                void refresh();
              }}
            />
          ) : (
            <>
              <Text
                style={{
                  fontSize: type.micro,
                  ...font("bold"),
                  letterSpacing: 0.9,
                  textTransform: "uppercase",
                  color: p.textFaint,
                  marginBottom: space.sm,
                }}
              >
                Waiting at Terminal 1
              </Text>
              <Card padded={false}>
                {waiting.map((w, i) => (
                  <WaitingRow
                    key={`${w.batchId}-${w.locationId}`}
                    line={w}
                    divider={i < waiting.length - 1}
                    onPress={() => {
                      setDone(null);
                      setSelected(w);
                    }}
                  />
                ))}
              </Card>
            </>
          )}
        </Page>
      </ScrollView>
    </View>
  );
}

function WaitingRow({
  line,
  divider,
  onPress,
}: {
  line: AwaitingPutaway;
  divider: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  const [hovered, setHovered] = useState(false);
  const hours = line.hoursWaiting ?? 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Put away ${line.qty} ${line.uomCode} of ${line.itemName}`}
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
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: type.subheading, ...font("semibold"), color: p.text }}
        >
          {line.itemName}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontSize: type.caption, color: p.textMuted, marginTop: 1 }}
        >
          Batch {line.batchNo}
          {line.bestBefore ? ` · best before ${line.bestBefore}` : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: space.xs, marginTop: space.xs }}>
          {line.storageRegime !== "AMBIENT" ? (
            <StatusPill
              icon="snow-outline"
              label={line.storageRegime === "FROZEN" ? "Frozen" : "Chilled"}
              tone="warn"
            />
          ) : null}
          {hours >= 4 ? (
            <StatusPill icon="hourglass" label={`${hours.toFixed(1)} h at T1`} tone="warn" />
          ) : null}
        </View>
      </View>

      <Text
        style={{
          fontSize: type.heading,
          ...font("bold"),
          color: p.text,
          marginRight: space.sm,
          ...tabular,
        }}
      >
        {line.qty}
        <Text style={{ fontSize: type.caption, ...font("medium"), color: p.textMuted }}>
          {" "}
          {line.uomCode}
        </Text>
      </Text>
      <Ionicons name="chevron-forward" size={18} color={p.textFaint} />
    </Pressable>
  );
}

/**
 * Where it is going.
 *
 * The scan field is the only way to name a destination — there is no bin picker, and that
 * is not an omission. A list of four hundred bins invites choosing the one that looks
 * right from the pallet rather than reading the label on the shelf, which is the practice
 * hard rule 13 exists to stop. The code has to come off the bin.
 */
function DestinationPanel({
  line,
  propertyId,
  onCancel,
  onDone,
}: {
  line: AwaitingPutaway;
  propertyId: string;
  onCancel: () => void;
  onDone: (result: { code: string; qty: number; item: string }) => void;
}) {
  const p = usePalette();
  const [qty, setQty] = useState(String(line.qty));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = Number(qty);
  const valid =
    qty.trim().length > 0 && Number.isFinite(amount) && amount > 0 && amount <= line.qty;

  async function send(code: string, method: ScanMethod) {
    if (!valid) {
      setError(`Enter how much is going to that bin — up to ${line.qty} ${line.uomCode}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await putAway({
        propertyId,
        batchId: line.batchId,
        fromLocationId: line.locationId,
        toLocationCode: code,
        qty: amount,
        scanMethod: method,
        // Per scan, not per screen: two bins for one pallet are two genuine movements,
        // and a key held across both would silently swallow the second.
        submissionId: newSubmissionId(),
      });
      onDone({ code: result.toLocationCode, qty: amount, item: line.itemName });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <Text style={{ fontSize: type.title, ...font("bold"), color: p.text }}>
          {line.itemName}
        </Text>
        <Text style={{ fontSize: type.caption, color: p.textMuted, marginTop: 2 }}>
          Batch {line.batchNo} · {line.qty} {line.uomCode} at {line.locationCode}
        </Text>

        {line.storageRegime !== "AMBIENT" ? (
          <View style={{ marginTop: space.md }}>
            <StatusPill
              icon="snow-outline"
              label={`${line.storageRegime === "FROZEN" ? "Frozen" : "Chilled"} — the bin has to match`}
              tone="warn"
            />
          </View>
        ) : null}

        <View style={{ height: space.xl }} />

        <Field
          label="How much"
          value={qty}
          onChangeText={setQty}
          keyboardType="decimal-pad"
          suffix={line.uomCode}
          hint={`Up to ${line.qty} ${line.uomCode}. Less is fine — the rest stays at Terminal 1 for another bin.`}
        />

        <ScanField
          label="Bin"
          placeholder="Scan the bin label"
          hint="Read the code off the bin itself. Typing works while labels are being printed, and every typed put-away is counted."
          onScan={(code, method) => void send(code, method)}
        />

        {busy ? (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <ActivityIndicator color={p.accent} />
            <Text style={{ fontSize: type.caption, color: p.textMuted, marginLeft: space.sm }}>
              Recording…
            </Text>
          </View>
        ) : null}

        {error ? <FieldError message={error} /> : null}
      </Card>

      <View style={{ marginTop: space.lg }}>
        <PrimaryButton label="Choose something else" tone="neutral" onPress={onCancel} />
      </View>
    </>
  );
}
