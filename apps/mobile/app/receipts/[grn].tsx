import { Ionicons } from "@expo/vector-icons";
import type { GrnLineDecision } from "@golai/db";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import {
  amendReceipt,
  listReceiptLines,
  listReceipts,
  type AmendedLine,
  type ReceiptLine,
  type ReceiptSummary,
} from "../../lib/receipts";
import { REJECT_LABELS } from "../../lib/registers";
import { useSession } from "../../lib/session";
import { newSubmissionId } from "../../lib/stock";
import { elevation, font, radius, space, tabular, type, usePalette } from "../../theme";

/**
 * One receipt, and correcting it.
 *
 * A posted GRN is immutable by trigger and corrected by superseding it, never by editing
 * (PRD section 4 Gate 5). So this screen does not edit anything: it collects the corrected
 * figures and a reason, and posts a NEW receipt that points at this one.
 *
 * ## The number that decides whether it can be done at all
 *
 * Correcting the paperwork is easy; correcting the stock is the real work. Once stock has
 * been put away it is in a bin and cannot be attributed back to a line, so a line can only
 * be reduced by what is still where the receipt put it. That figure is shown against every
 * line BEFORE anything is typed — being told afterwards is being told too late.
 */
export default function ReceiptDetail() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeProperty, canEditMasters } = useSession();
  const { grn } = useLocalSearchParams<{ grn: string }>();

  const [receipt, setReceipt] = useState<ReceiptSummary | null>(null);
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [amending, setAmending] = useState(false);
  const [reason, setReason] = useState("");
  const [edits, setEdits] = useState<Record<string, { accepted: string; rejected: string }>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const propertyId = activeProperty?.propertyId ?? null;

  const load = useCallback(async () => {
    if (!propertyId || !grn) return;
    try {
      const [all, rows] = await Promise.all([
        listReceipts(propertyId, null),
        listReceiptLines(propertyId, grn),
      ]);
      setReceipt(all.find((r) => r.grnId === grn) ?? null);
      setLines(rows);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId, grn]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = useMemo(
    () =>
      lines.filter((l) => {
        const e = edits[l.lineId];
        if (!e) return false;
        return Number(e.accepted) !== l.qtyAccepted || Number(e.rejected) !== l.qtyRejected;
      }),
    [lines, edits],
  );

  const problems: string[] = [];
  if (!reason.trim()) problems.push("Say why it is being corrected.");
  if (changed.length === 0) problems.push("Change at least one figure.");
  for (const l of changed) {
    const e = edits[l.lineId]!;
    const a = Number(e.accepted);
    const r = Number(e.rejected);
    if (!Number.isFinite(a) || !Number.isFinite(r) || a < 0 || r < 0)
      problems.push(`${l.itemName}: quantities are whole numbers, zero or more.`);
    else if (a + r <= 0) problems.push(`${l.itemName}: a corrected count is still a count.`);
    // Checked here as well as at the server, so the person is stopped before typing a
    // reason rather than after posting it.
    else if (l.qtyAccepted - a > l.stillQuarantined)
      problems.push(
        `${l.itemName}: only ${l.stillQuarantined} ${l.uomCode} is still at Terminal 1, so it cannot come down by more than that.`,
      );
    else if (l.qtyRejected - r > l.stillRejected)
      problems.push(
        `${l.itemName}: only ${l.stillRejected} ${l.uomCode} is still in the reject cage.`,
      );
  }

  async function amend() {
    if (!propertyId || !grn || problems.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      const payload: AmendedLine[] = changed.map((l) => {
        const e = edits[l.lineId]!;
        const accepted = Number(e.accepted);
        const rejected = Number(e.rejected);
        // Derived from the corrected figures rather than carried over. A line whose
        // rejected quantity falls to zero is no longer a part-acceptance, and leaving the
        // old decision on it would make the register say two things.
        const decision: GrnLineDecision =
          rejected === 0 ? "ACCEPT" : accepted === 0 ? "REJECT" : "ACCEPT_PARTIAL";
        return {
          grn_line_id: l.lineId,
          qty_physical: accepted + rejected,
          qty_accepted: accepted,
          qty_rejected: rejected,
          decision,
          reject_reason: decision === "ACCEPT" ? null : (l.rejectReason ?? "OTHER"),
        };
      });

      const result = await amendReceipt({
        propertyId,
        grnId: grn,
        reason: reason.trim(),
        lines: payload,
        submissionId: newSubmissionId(),
      });
      setDone(result.grnNo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background, justifyContent: "center" }}>
        <ActivityIndicator size="large" color={p.accent} />
      </View>
    );
  }

  if (loadError || !receipt) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background, justifyContent: "center" }}>
        <Notice
          icon={loadError ? "cloud-offline-outline" : "help-circle-outline"}
          tone="bad"
          title={loadError ? "Could not open it" : "No such receipt here"}
          body={loadError ?? "That receipt does not belong to this property."}
          action={
            <PrimaryButton label="Back to receipts" onPress={() => router.replace("/receipts")} />
          }
        />
      </View>
    );
  }

  if (done) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: p.background,
          justifyContent: "center",
          padding: space.lg,
        }}
      >
        <Page>
          <Card>
            <View style={{ alignItems: "center" }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: radius.xl,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: p.successSurface,
                }}
              >
                <Ionicons name="checkmark" size={30} color={p.success} />
              </View>
              <Text
                selectable
                style={{
                  fontSize: type.title,
                  ...font("heavy"),
                  color: p.text,
                  marginTop: space.md,
                  ...tabular,
                }}
              >
                {done}
              </Text>
            </View>
            <View style={{ height: space.md }} />
            <Text style={{ fontSize: type.caption, color: p.textMuted, lineHeight: 18 }}>
              {receipt.grnNo} has not been changed — it still says what was posted. {done}
              &nbsp;supersedes it, carries your reason, and the stock difference was recorded as a
              correction against the batch. Both stay on the register.
            </Text>
          </Card>
          <View style={{ marginTop: space.xl }}>
            <PrimaryButton
              label="Back to receipts"
              icon="arrow-back"
              density="field"
              onPress={() => router.replace("/receipts")}
            />
          </View>
        </Page>
      </View>
    );
  }

  const superseded = receipt.supersededByGrnNo !== null;

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
            title={receipt.grnNo}
            subtitle={`${receipt.vendorName ?? "Vendor not named"} · ${new Date(receipt.postedAt).toLocaleDateString()}`}
            onBack={() => router.back()}
          />
        </Page>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + 48 }}
        keyboardShouldPersistTaps="handled"
      >
        <Page>
          {receipt.amendsGrnNo || superseded ? (
            <View style={{ marginBottom: space.lg }}>
              <Card>
                {receipt.amendsGrnNo ? (
                  <Text style={{ fontSize: type.caption, color: p.textMuted, lineHeight: 18 }}>
                    This receipt corrects{" "}
                    <Text style={{ ...font("semibold"), color: p.text }}>
                      {receipt.amendsGrnNo}
                    </Text>
                    {receipt.amendmentReason ? ` — ${receipt.amendmentReason}` : ""}.
                  </Text>
                ) : null}
                {superseded ? (
                  <Text
                    style={{
                      fontSize: type.caption,
                      color: p.warning,
                      lineHeight: 18,
                      marginTop: receipt.amendsGrnNo ? space.sm : 0,
                    }}
                  >
                    Superseded by <Text style={font("semibold")}>{receipt.supersededByGrnNo}</Text>.
                    It stays on the record because it is what was posted; correct the newer one
                    instead.
                  </Text>
                ) : null}
              </Card>
            </View>
          ) : null}

          <Card padded={false}>
            {lines.map((l, i) => (
              <LineRow
                key={l.lineId}
                line={l}
                amending={amending}
                edit={edits[l.lineId]}
                onEdit={(next) => setEdits((prev) => ({ ...prev, [l.lineId]: next }))}
                divider={i < lines.length - 1}
              />
            ))}
          </Card>

          {amending ? (
            <>
              <View style={{ height: space.xl }} />
              <Card>
                <Field
                  label="Why is it being corrected?"
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Typed 400 instead of 40"
                  autoCapitalize="sentences"
                  hint="It goes on the new receipt permanently, next to your name."
                />

                {error ? <FieldError message={error} /> : null}
                {problems.slice(0, 3).map((msg) => (
                  <FieldError key={msg} message={msg} />
                ))}

                <PrimaryButton
                  label={saving ? "Posting…" : "Post the correction"}
                  icon="checkmark"
                  density="field"
                  onPress={() => void amend()}
                  disabled={saving || problems.length > 0}
                />
                <View style={{ height: space.sm }} />
                <PrimaryButton
                  label="Cancel"
                  tone="neutral"
                  onPress={() => {
                    setAmending(false);
                    setEdits({});
                    setReason("");
                    setError(null);
                  }}
                />
              </Card>
            </>
          ) : superseded ? null : canEditMasters ? (
            <View style={{ marginTop: space.xl }}>
              <PrimaryButton
                label="Correct this receipt"
                icon="create-outline"
                tone="neutral"
                onPress={() => {
                  setAmending(true);
                  setEdits(
                    Object.fromEntries(
                      lines.map((l) => [
                        l.lineId,
                        { accepted: String(l.qtyAccepted), rejected: String(l.qtyRejected) },
                      ]),
                    ),
                  );
                }}
              />
              <Text
                style={{
                  fontSize: type.caption,
                  color: p.textMuted,
                  marginTop: space.sm,
                  lineHeight: 17,
                }}
              >
                Nothing here is edited. A correction posts a new receipt that supersedes this one,
                and both stay on the register.
              </Text>
            </View>
          ) : (
            /*
              Said rather than hidden. The person looking at a wrong receipt needs to know
              it can be fixed and by whom, not to find the screen has no button on it.
            */
            <View style={{ marginTop: space.xl }}>
              <Text style={{ fontSize: type.caption, color: p.textMuted, lineHeight: 18 }}>
                A posted receipt is corrected by an owner, an administrator or the general manager —
                deliberately not the person who posted it. Ask one of them if a figure here is
                wrong.
              </Text>
            </View>
          )}
        </Page>
      </ScrollView>
    </View>
  );
}

function LineRow({
  line,
  amending,
  edit,
  onEdit,
  divider,
}: {
  line: ReceiptLine;
  amending: boolean;
  edit: { accepted: string; rejected: string } | undefined;
  onEdit: (next: { accepted: string; rejected: string }) => void;
  divider: boolean;
}) {
  const p = usePalette();

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
            {line.itemCode} · batch {line.batchNo ?? "—"}
          </Text>
        </View>
        {!amending ? (
          <Text style={{ fontSize: type.body, ...font("bold"), color: p.text, ...tabular }}>
            {fmt(line.qtyAccepted)}
            <Text style={{ fontSize: type.micro, ...font("regular"), color: p.textMuted }}>
              {" "}
              {line.uomCode}
            </Text>
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.xs }}>
        {line.qtyRejected > 0 ? (
          <StatusPill
            icon="close-circle"
            label={`${fmt(line.qtyRejected)} ${line.uomCode} ${
              line.rejectReason ? REJECT_LABELS[line.rejectReason].toLowerCase() : "rejected"
            }`}
            tone="bad"
          />
        ) : null}
        {/*
          The figure that decides whether this line can be reduced at all, shown whether
          or not somebody is amending. It is also just useful: it says how much of the
          delivery is still standing at the dock.
        */}
        {amending ? (
          <StatusPill
            icon="cube-outline"
            label={`${fmt(line.stillQuarantined)} ${line.uomCode} still at Terminal 1`}
            tone={line.stillQuarantined < line.qtyAccepted ? "warn" : "neutral"}
          />
        ) : null}
      </View>

      {amending ? (
        <View style={{ flexDirection: "row", gap: space.md, marginTop: space.md }}>
          <View style={{ flex: 1 }}>
            <Field
              label="Accepted"
              value={edit?.accepted ?? String(line.qtyAccepted)}
              onChangeText={(v) =>
                onEdit({ accepted: v, rejected: edit?.rejected ?? String(line.qtyRejected) })
              }
              keyboardType="decimal-pad"
              suffix={line.uomCode}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Rejected"
              value={edit?.rejected ?? String(line.qtyRejected)}
              onChangeText={(v) =>
                onEdit({ accepted: edit?.accepted ?? String(line.qtyAccepted), rejected: v })
              }
              keyboardType="decimal-pad"
              suffix={line.uomCode}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}
