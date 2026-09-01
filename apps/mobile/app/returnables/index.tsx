import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import {
  Card,
  Dialog,
  Field,
  FieldError,
  Notice,
  PrimaryButton,
  Screen,
  Section,
  SkeletonList,
  StatusPill,
  Text,
} from "../../components/ui";
import { memberCan } from "../../lib/access";
import { DISPATCH_TYPES } from "../../lib/dispatch";
import { listReturnables, recordReturn, type Returnable } from "../../lib/returnables";
import { useSession } from "../../lib/session";
import { space, usePalette } from "../../theme";

/**
 * The returnable register — everything out on a promise to come back, aged against it.
 *
 * The register writes itself: staging a returnable dispatch opens the row in the same
 * transaction as the note, so this screen has nothing to create. What it adds is the
 * other half — recording the crates, cylinders and linen that come back, which until
 * now had nowhere to land at all.
 *
 * Who may record is the server's decision (`record_return`: the dispatch roles, plus
 * SECURITY, because returns arrive at the gate). Here the affordance is offered on the
 * `dispatch` capability — the client-side face of that same set minus SECURITY, whose
 * gate-side screen is deferred until the guard joins the pilot. Everyone else with
 * report access sees the register read-only, which for an auditor is exactly right.
 */
export default function Returnables() {
  const router = useRouter();
  const { activeProperty } = useSession();

  const [rows, setRows] = useState<Returnable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<Returnable | null>(null);

  const propertyId = activeProperty?.propertyId ?? null;
  const canRecord = memberCan(activeProperty?.roles ?? [], "dispatch");

  const refresh = useCallback(async () => {
    if (!propertyId) return;
    try {
      setRows(await listReturnables(propertyId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // Server-ordered: outstanding first, most overdue on top. The split keeps that order.
  const out = rows.filter((r) => r.outstanding > 0);
  const settled = rows.filter((r) => r.outstanding === 0);
  const late = out.filter((r) => (r.daysOverdue ?? 0) > 0).length;

  return (
    <Screen
      title="Returnables"
      subtitle={
        loading
          ? "Loading"
          : out.length === 0
            ? "Nothing outstanding"
            : `${out.length} still out${late > 0 ? ` · ${late} late` : ""}`
      }
      onBack={() => router.back()}
    >
      {loading ? (
        <SkeletonList />
      ) : error ? (
        <Notice icon="cloud-offline-outline" title="Could not load" body={error} tone="bad" />
      ) : rows.length === 0 ? (
        <Notice
          icon="repeat-outline"
          title="Nothing out on returnable terms"
          body="When a dispatch is staged as returnable — empties, linen, equipment for repair — it lands here with its promised return date, and stays until everything is back."
        />
      ) : (
        <>
          {out.length > 0 ? (
            <Section title="Still out">
              <Card padded={false}>
                {out.map((r, i) => (
                  <ReturnableRow
                    key={r.returnableId}
                    row={r}
                    divider={i < out.length - 1}
                    onPress={canRecord ? () => setReceiving(r) : undefined}
                  />
                ))}
              </Card>
            </Section>
          ) : null}

          {settled.length > 0 ? (
            <Section title="Came back">
              <Card padded={false}>
                {settled.map((r, i) => (
                  <ReturnableRow key={r.returnableId} row={r} divider={i < settled.length - 1} />
                ))}
              </Card>
            </Section>
          ) : null}
        </>
      )}

      <RecordReturnDialog
        subject={receiving}
        propertyId={propertyId}
        onClose={() => setReceiving(null)}
        onRecorded={() => {
          setReceiving(null);
          void refresh();
        }}
      />
    </Screen>
  );
}

function typeLabel(row: Returnable): string {
  return DISPATCH_TYPES.find((t) => t.id === row.dispatchType)?.label ?? row.dispatchType;
}

function ReturnableRow({
  row,
  divider,
  onPress,
}: {
  row: Returnable;
  divider: boolean;
  /** Absent for read-only viewers and settled rows — the row is then not pressable. */
  onPress?: (() => void) | undefined;
}) {
  const p = usePalette();
  const settled = row.outstanding === 0;
  const overdue = row.daysOverdue ?? 0;

  const body = (
    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text lines={1} weight="semibold" tone={settled ? "muted" : "default"}>
          {row.recipientName ?? typeLabel(row)}
        </Text>
        <Text lines={1} role="caption" tone="muted" numeric style={{ marginTop: 1 }}>
          {row.dispatchNo}
          {row.recipientName ? ` · ${typeLabel(row)}` : ""} ·{" "}
          {new Date(row.stagedAt).toLocaleDateString()}
        </Text>
        {settled ? (
          <Text lines={1} role="caption" tone="muted" style={{ marginTop: 1 }}>
            All {fmt(row.qtyOut)} back
            {row.returnedAt ? ` · ${new Date(row.returnedAt).toLocaleDateString()}` : ""}
            {row.conditionOnReturn ? ` · ${row.conditionOnReturn}` : ""}
          </Text>
        ) : row.expectedReturnDate && overdue === 0 ? (
          <Text lines={1} role="caption" tone="muted" style={{ marginTop: 1 }}>
            Due by {new Date(row.expectedReturnDate).toLocaleDateString()}
          </Text>
        ) : null}
        {overdue > 0 ? (
          <View style={{ flexDirection: "row", marginTop: space.xs }}>
            <StatusPill
              icon="alert-circle"
              label={`${overdue} day${overdue === 1 ? "" : "s"} late`}
              tone="bad"
            />
          </View>
        ) : null}
      </View>

      {!settled ? (
        <View style={{ alignItems: "flex-end", marginRight: onPress ? space.sm : 0 }}>
          <Text weight="bold" numeric>
            {fmt(row.outstanding)}
          </Text>
          <Text role="caption" tone="muted" numeric>
            of {fmt(row.qtyOut)} out
          </Text>
        </View>
      ) : null}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={p.textFaint} /> : null}
    </View>
  );

  const base: ViewStyle = {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
    borderBottomColor: p.border,
  };

  if (!onPress) return <View style={base}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Record a return against ${row.dispatchNo}, ${fmt(row.outstanding)} outstanding`}
      style={({ pressed, hovered }) =>
        ({
          ...base,
          backgroundColor: pressed ? p.border : hovered ? p.surfaceSunken : "transparent",
          cursor: "pointer",
        }) as ViewStyle
      }
    >
      {body}
    </Pressable>
  );
}

function RecordReturnDialog({
  subject,
  propertyId,
  onClose,
  onRecorded,
}: {
  subject: Returnable | null;
  propertyId: string | null;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [qty, setQty] = useState("");
  const [condition, setCondition] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Keyed on the subject rather than run in an effect — the dialog is mounted the whole
  // time, and an effect on `subject` would fight the user's typing on every re-render.
  if (subject !== null && subject.returnableId !== loadedFor) {
    setLoadedFor(subject.returnableId);
    setError(null);
    // Most returns are complete returns, so the full outstanding quantity is the
    // starting point and a partial return is the edit.
    setQty(fmt(subject.outstanding));
    setCondition("");
  }

  const parsed = Number(qty);
  const problems: string[] = [];
  if (qty.trim() === "" || !Number.isFinite(parsed) || parsed <= 0) {
    problems.push("How many came back is needed.");
  } else if (subject && parsed > subject.outstanding) {
    problems.push(`Only ${fmt(subject.outstanding)} still out on this dispatch.`);
  }

  async function save() {
    if (!propertyId || !subject || problems.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      // The server rechecks against the live row — this screen's numbers can be stale
      // if someone else recorded a return meanwhile — and refuses an over-return.
      await recordReturn(propertyId, subject.returnableId, parsed, condition.trim() || null);
      onRecorded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      onSubmit={() => void save()}
      visible={subject !== null}
      title={subject ? `Return against ${subject.dispatchNo}` : ""}
      onClose={onClose}
      footer={
        <PrimaryButton
          label="Record return"
          icon="checkmark"
          onPress={() => void save()}
          loading={saving}
          disabled={problems.length > 0}
        />
      }
    >
      {subject ? (
        <>
          <Card>
            <Text tone="muted" style={{ marginBottom: space.md }}>
              {fmt(subject.outstanding)} of {fmt(subject.qtyOut)} still out
              {subject.recipientName ? ` with ${subject.recipientName}` : ""}.
            </Text>
            <Field
              label="How many came back"
              value={qty}
              onChangeText={setQty}
              keyboardType="decimal-pad"
              placeholder={fmt(subject.outstanding)}
            />
            <Field
              label="Condition"
              value={condition}
              onChangeText={setCondition}
              placeholder="Optional — two crates cracked"
              autoCapitalize="sentences"
              hint="Worth a word when something came back damaged. This is the only record there will be."
            />
          </Card>

          {error ? <FieldError message={error} /> : null}
          {problems.map((msg) => (
            <FieldError key={msg} message={msg} />
          ))}
        </>
      ) : null}
    </Dialog>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}
