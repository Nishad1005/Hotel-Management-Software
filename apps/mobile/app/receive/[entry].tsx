import { Ionicons } from "@expo/vector-icons";
import { meetsMinimumShelfLife, shelfLifeRemainingPct } from "@golai/domain";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { DateField } from "../../components/date-field";
import {
  Card,
  ChoiceTile,
  Field,
  FieldError,
  Loading,
  Notice,
  PrimaryButton,
  Result,
  Screen,
  SelectRow,
  StatusPill,
  Text,
} from "../../components/ui";
import { listItems, type ItemListRow } from "../../lib/masters";
import {
  listOpenArrivals,
  postReceipt,
  REJECT_REASONS,
  type DraftLine,
  type OpenArrival,
  type PostedReceipt,
} from "../../lib/receiving";
import { useSession } from "../../lib/session";
import { newSubmissionId } from "../../lib/stock";
import { font, radius, space, tabular, type, usePalette } from "../../theme";
import type { GrnLineDecision, RejectReason } from "@golai/db";

/**
 * Gates 1 to 5 on one screen: what arrived, how much, what condition, and the decision.
 *
 * They are one screen because they are one conversation with a driver who is waiting.
 * Splitting them into five would be truer to the PRD's numbering and false to the dock.
 *
 * Nothing is written until "Post receipt". The lines below are a draft held in memory,
 * and the post is a single transaction — which is not a convenience but a requirement,
 * since a posted GRN is immutable and a half-written one could only ever be amended.
 */
export default function ReceiveArrival() {
  const p = usePalette();
  const router = useRouter();
  const { activeProperty } = useSession();
  const { entry } = useLocalSearchParams<{ entry: string }>();

  const [arrival, setArrival] = useState<OpenArrival | null>(null);
  const [items, setItems] = useState<ItemListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [posted, setPosted] = useState<PostedReceipt | null>(null);

  // Minted once for the life of this screen, not once per attempt. That is the whole
  // mechanism: a retry after a dropped connection carries the same key and returns the
  // original receipt rather than counting the delivery twice.
  const [submissionId] = useState(() => newSubmissionId());

  const propertyId = activeProperty?.propertyId ?? null;

  useEffect(() => {
    if (!propertyId || !entry) return;
    let alive = true;
    void (async () => {
      try {
        const [open, list] = await Promise.all([listOpenArrivals(propertyId), listItems("", null)]);
        if (!alive) return;
        setArrival(open.find((a) => a.id === entry) ?? null);
        setItems(list.filter((i) => i.isActive));
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [propertyId, entry]);

  const totals = useMemo(() => {
    let accepted = 0;
    let rejected = 0;
    for (const l of lines) {
      accepted += l.qtyAccepted;
      rejected += l.qtyRejected;
    }
    return { accepted, rejected };
  }, [lines]);

  async function post() {
    if (!propertyId || !arrival || lines.length === 0) return;
    setPosting(true);
    setPostError(null);
    try {
      const receipt = await postReceipt({
        propertyId,
        gateEntryId: arrival.id,
        partyId: arrival.partyId,
        lines,
        submissionId,
      });
      setPosted(receipt);
    } catch (e) {
      setPostError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background, justifyContent: "center" }}>
        <Loading />
      </View>
    );
  }

  if (loadError || !arrival) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background, justifyContent: "center" }}>
        <Notice
          icon={loadError ? "cloud-offline-outline" : "checkmark-circle-outline"}
          tone={loadError ? "bad" : "neutral"}
          title={loadError ? "Could not open this arrival" : "Already received"}
          body={
            loadError ??
            "A goods receipt has been posted against this arrival, so it is off the worklist. A posted receipt is corrected by amendment, never by receiving it again."
          }
          action={
            <PrimaryButton label="Back to receiving" onPress={() => router.replace("/receive")} />
          }
        />
      </View>
    );
  }

  if (posted) {
    return (
      <PostedPanel
        receipt={posted}
        accepted={totals.accepted}
        rejected={totals.rejected}
        lineCount={lines.length}
        onDone={() => router.replace("/receive")}
      />
    );
  }

  return (
    <Screen
      title={arrival.partyName ?? "Vendor not named"}
      subtitle={`${arrival.gateEntryNo} · ${arrival.packageCount} package${
        arrival.packageCount === 1 ? "" : "s"
      }${arrival.vehicleNumber ? ` · ${arrival.vehicleNumber}` : ""}`}
      onBack={() => router.back()}
      {...(lines.length > 0
        ? {
            footer: (
              <>
                <Text
                  role="caption"
                  tone="muted"
                  style={{ marginBottom: space.sm }}
                  accessibilityLiveRegion="polite"
                >
                  {lines.length} line{lines.length === 1 ? "" : "s"} · {fmt(totals.accepted)}{" "}
                  accepted
                  {totals.rejected > 0 ? ` · ${fmt(totals.rejected)} rejected` : ""}
                </Text>
                <PrimaryButton
                  label="Post receipt"
                  icon="checkmark"
                  density="field"
                  onPress={() => void post()}
                  loading={posting}
                />
              </>
            ),
          }
        : {})}
    >
      {items.length === 0 ? (
        <Notice
          icon="cube-outline"
          title="The item master is empty"
          body="An item must exist before it can be received. Nothing is created at the dock — that is a hard rule, and it is what stops a delivery inventing a product nobody agreed to buy."
          action={<PrimaryButton label="Go to items" onPress={() => router.push("/items")} />}
        />
      ) : (
        <>
          {lines.length > 0 ? (
            <View style={{ marginBottom: space.xl }}>
              <SectionLabel>On this receipt</SectionLabel>
              <Card padded={false}>
                {lines.map((l, i) => (
                  <LineRow
                    key={`${l.itemId}-${i}`}
                    line={l}
                    divider={i < lines.length - 1}
                    onRemove={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                  />
                ))}
              </Card>
            </View>
          ) : null}

          <SectionLabel>{lines.length === 0 ? "First line" : "Add another line"}</SectionLabel>
          <LineEditor
            items={items}
            onAdd={(line) => {
              setLines((prev) => [...prev, line]);
              setPostError(null);
            }}
          />

          {postError ? (
            <View style={{ marginTop: space.lg }}>
              <FieldError message={postError} />
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One line
// ---------------------------------------------------------------------------

/**
 * The three decisions, in the words used at a dock.
 *
 * Not a dropdown. This is the single most consequential choice on the screen and it is
 * made with gloves on, in daylight, with somebody waiting — so it gets three targets
 * that can be hit without looking twice.
 */
const DECISIONS: {
  id: GrnLineDecision;
  label: string;
  icon: "checkmark-circle" | "remove-circle" | "close-circle";
}[] = [
  { id: "ACCEPT", label: "Take it all", icon: "checkmark-circle" },
  { id: "ACCEPT_PARTIAL", label: "Part reject", icon: "remove-circle" },
  { id: "REJECT", label: "Reject it all", icon: "close-circle" },
];

function LineEditor({ items, onAdd }: { items: ItemListRow[]; onAdd: (line: DraftLine) => void }) {
  const p = usePalette();

  const [itemId, setItemId] = useState("");
  const [qtyChallan, setQtyChallan] = useState("");
  const [qtyPhysical, setQtyPhysical] = useState("");
  const [decision, setDecision] = useState<GrnLineDecision | null>(null);
  const [qtyRejected, setQtyRejected] = useState("");
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [batchNo, setBatchNo] = useState("");
  const [bestBefore, setBestBefore] = useState("");
  const [temp, setTemp] = useState("");
  const [touched, setTouched] = useState(false);

  const item = items.find((i) => i.id === itemId) ?? null;
  const physical = Number(qtyPhysical);
  const hasPhysical = qtyPhysical.trim().length > 0 && Number.isFinite(physical) && physical > 0;

  // Reject-all is the whole line; part-reject asks; take-it-all rejects nothing. Derived
  // rather than stored, so the three can never contradict each other.
  const rejected =
    decision === "REJECT"
      ? hasPhysical
        ? physical
        : 0
      : decision === "ACCEPT_PARTIAL"
        ? Number(qtyRejected)
        : 0;
  const rejectedValid =
    decision !== "ACCEPT_PARTIAL" ||
    (qtyRejected.trim().length > 0 &&
      Number.isFinite(rejected) &&
      rejected > 0 &&
      rejected < physical);
  const accepted = hasPhysical && rejectedValid ? physical - rejected : 0;

  const challan = qtyChallan.trim().length > 0 ? Number(qtyChallan) : null;
  const variance = challan !== null && hasPhysical ? physical - challan : null;

  const problems: string[] = [];
  if (!item) problems.push("Choose an item.");
  if (!hasPhysical) problems.push("Count what actually arrived.");
  if (!decision) problems.push("Accept it, part-accept it, or reject it.");
  if (decision === "ACCEPT_PARTIAL" && !rejectedValid)
    problems.push("A part rejection is more than none and less than all of it.");
  if (decision && decision !== "ACCEPT" && !reason)
    problems.push("Say why any of it was turned away.");
  if (item?.isPerishable && !bestBefore.trim())
    problems.push("This item is perishable, so it needs a best-before date.");
  if (item?.isColdChain && !temp.trim())
    problems.push("This item is cold chain, so it needs a probe temperature.");

  // ---------------------------------------------------------------------------
  // The two rules that record rather than block (PRD section 8)
  // ---------------------------------------------------------------------------
  //
  // Both ship RECORD_ONLY. Where the property cannot actually refuse a delivery — and at
  // a hotel dock at six in the morning it usually cannot — a system that pretends
  // otherwise produces a click-through, and the record then carries a false assertion
  // instead of an honest gap.

  const probe = temp.trim().length > 0 ? Number(temp) : null;
  const tempOutOfRange =
    probe !== null &&
    Number.isFinite(probe) &&
    ((item?.tempMinC !== null && item?.tempMinC !== undefined && probe < item.tempMinC) ||
      (item?.tempMaxC !== null && item?.tempMaxC !== undefined && probe > item.tempMaxC));

  const pctLeft = bestBefore.trim()
    ? shelfLifeRemainingPct(
        Date.parse(`${bestBefore.trim()}T00:00:00Z`),
        item?.shelfLifeDays ?? null,
        Date.now(),
      )
    : null;
  const shelfLife = meetsMinimumShelfLife(
    pctLeft,
    item?.minShelfLifePctAtReceipt ?? item?.categoryMinShelfLifePct ?? null,
    "RECORD_ONLY",
  );

  function reset() {
    setItemId("");
    setQtyChallan("");
    setQtyPhysical("");
    setDecision(null);
    setQtyRejected("");
    setReason(null);
    setBatchNo("");
    setBestBefore("");
    setTemp("");
    setTouched(false);
  }

  function add() {
    if (!item || problems.length > 0 || !decision) {
      setTouched(true);
      return;
    }
    onAdd({
      itemId: item.id,
      itemName: item.name,
      itemCode: item.code,
      uomId: item.uomId,
      uomCode: item.uomCode,
      isPerishable: item.isPerishable,
      isColdChain: item.isColdChain,
      qtyChallan: challan,
      qtyPhysical: physical,
      qtyAccepted: accepted,
      qtyRejected: rejected,
      decision,
      rejectReason: decision === "ACCEPT" ? null : reason,
      batchNo: batchNo.trim() || null,
      bestBefore: bestBefore.trim() || null,
      receiptTempC: probe !== null && Number.isFinite(probe) ? probe : null,
    });
    reset();
  }

  return (
    <Card>
      <SelectRow
        label="Item"
        value={itemId || null}
        placeholder="Which item is this?"
        choices={items.map((i) => ({ id: i.id, label: i.name, sublabel: i.code }))}
        onSelect={(id) => {
          setItemId(id);
          setTouched(false);
        }}
      />

      {item ? (
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginBottom: space.lg }}
        >
          {item.isPerishable ? (
            <StatusPill icon="calendar-outline" label="Perishable" tone="warn" />
          ) : null}
          {item.isColdChain ? (
            <StatusPill
              icon="thermometer-outline"
              label={
                item.tempMinC !== null && item.tempMaxC !== null
                  ? `Cold chain ${item.tempMinC} to ${item.tempMaxC} °C`
                  : "Cold chain"
              }
              tone="warn"
            />
          ) : null}
          <StatusPill label={item.categoryName} tone="neutral" />
        </View>
      ) : null}

      <Field
        label="On the challan"
        value={qtyChallan}
        onChangeText={setQtyChallan}
        placeholder="Optional"
        keyboardType="decimal-pad"
        hint="What the vendor's note says. Leave blank when there is no paperwork."
        {...(item ? { suffix: item.uomCode } : {})}
      />

      <Field
        label="Actually arrived"
        value={qtyPhysical}
        onChangeText={setQtyPhysical}
        placeholder="0"
        keyboardType="decimal-pad"
        {...(item ? { suffix: item.uomCode } : {})}
      />

      {/* A variance is recorded, not argued with. Purchase approves it afterwards. */}
      {variance !== null && Math.abs(variance) > 0.0001 ? (
        <View style={{ marginTop: -space.sm, marginBottom: space.lg }}>
          <StatusPill
            icon="alert-circle-outline"
            label={`${variance > 0 ? "+" : ""}${fmt(variance)} ${item?.uomCode ?? ""} against the challan`}
            tone="warn"
          />
        </View>
      ) : null}

      <Text
        style={{
          fontSize: type.label,
          ...font("semibold"),
          color: p.text,
          marginBottom: space.xs,
        }}
      >
        Decision
      </Text>
      <View style={{ flexDirection: "row", gap: space.sm, marginBottom: space.lg }}>
        {DECISIONS.map((d) => (
          <ChoiceTile
            key={d.id}
            icon={d.icon}
            label={d.label}
            selected={decision === d.id}
            onPress={() => {
              setDecision(d.id);
              if (d.id === "ACCEPT") setReason(null);
              if (d.id !== "ACCEPT_PARTIAL") setQtyRejected("");
            }}
          />
        ))}
      </View>

      {decision === "ACCEPT_PARTIAL" ? (
        <Field
          label="How much is rejected"
          value={qtyRejected}
          onChangeText={setQtyRejected}
          placeholder="0"
          keyboardType="decimal-pad"
          hint={
            hasPhysical && rejectedValid
              ? `${fmt(accepted)} accepted, ${fmt(rejected)} rejected.`
              : "The rest goes on the books as accepted."
          }
          {...(item ? { suffix: item.uomCode } : {})}
        />
      ) : null}

      {decision && decision !== "ACCEPT" ? (
        <SelectRow
          label="Why"
          value={reason}
          placeholder="Choose a reason"
          choices={REJECT_REASONS.map((r) => ({ id: r.id, label: r.label }))}
          onSelect={(id) => setReason(id as RejectReason)}
        />
      ) : null}

      {item?.isColdChain || temp.trim() ? (
        <>
          <Field
            label={item?.isColdChain ? "Probe temperature" : "Probe temperature (optional)"}
            value={temp}
            onChangeText={setTemp}
            placeholder="0.0"
            keyboardType="decimal-pad"
            suffix="°C"
            hint={
              item?.tempMinC !== null && item?.tempMinC !== undefined
                ? `This item should be between ${item.tempMinC} and ${item.tempMaxC} °C.`
                : "Measured at the vehicle, before unloading."
            }
          />
          {tempOutOfRange ? (
            <View style={{ marginTop: -space.sm, marginBottom: space.lg }}>
              <RecordedNotice
                text={`${probe} °C is outside the range for this item. Recorded against the batch; it does not stop the receipt.`}
              />
            </View>
          ) : null}
        </>
      ) : null}

      {item?.isPerishable || bestBefore ? (
        <>
          <DateField
            label={item?.isPerishable ? "Best before" : "Best before (optional)"}
            value={bestBefore}
            onChange={setBestBefore}
            optional={!item?.isPerishable}
            {...(pctLeft !== null
              ? { hint: `${pctLeft}% of shelf life left at receipt.` }
              : { hint: "Read from the pack, not from the challan." })}
          />
          {shelfLife.applicable && !shelfLife.ok ? (
            <View style={{ marginTop: -space.sm, marginBottom: space.lg }}>
              <RecordedNotice
                text={`${shelfLife.shortfallPct} points short of the minimum shelf life for this item. Recorded against the batch; it does not stop the receipt.`}
              />
            </View>
          ) : null}
        </>
      ) : null}

      <Field
        label="Batch number"
        value={batchNo}
        onChangeText={setBatchNo}
        placeholder="Leave blank to generate one"
        autoCapitalize="characters"
        hint="The vendor's number if the pack carries one. A generated number is marked as such, so a trace can tell them apart."
      />

      {touched && problems.length > 0 ? (
        <View style={{ marginBottom: space.md }}>
          {problems.map((msg) => (
            <FieldError key={msg} message={msg} />
          ))}
        </View>
      ) : null}

      {/*
        Never disabled. A greyed-out button says "not yet" without saying what is
        missing, and the person then hunts the form for it. Pressing an incomplete line
        lists what it needs — which is the same information, delivered when it was asked
        for.
      */}
      <PrimaryButton label="Add to receipt" icon="add" tone="neutral" onPress={add} />
    </Card>
  );
}

function LineRow({
  line,
  divider,
  onRemove,
}: {
  line: DraftLine;
  divider: boolean;
  onRemove: () => void;
}) {
  const p = usePalette();
  const tone = line.decision === "ACCEPT" ? "good" : line.decision === "REJECT" ? "bad" : "warn";
  const label =
    line.decision === "ACCEPT"
      ? `${fmt(line.qtyAccepted)} ${line.uomCode} accepted`
      : line.decision === "REJECT"
        ? `${fmt(line.qtyRejected)} ${line.uomCode} rejected`
        : `${fmt(line.qtyAccepted)} in, ${fmt(line.qtyRejected)} back`;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: p.border,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text weight="semibold" lines={1}>
          {line.itemName}
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            marginTop: space.xxs,
          }}
        >
          <StatusPill label={label} tone={tone} />
          {line.bestBefore ? (
            <StatusPill label={`Best before ${line.bestBefore}`} tone="neutral" />
          ) : null}
          {line.receiptTempC !== null ? (
            <StatusPill label={`${line.receiptTempC} °C`} tone="neutral" />
          ) : null}
        </View>
      </View>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${line.itemName} from this receipt`}
        hitSlop={10}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.sm,
          backgroundColor: pressed ? p.dangerSurface : "transparent",
          cursor: "pointer",
        })}
      >
        <Ionicons name="close" size={18} color={p.textMuted} />
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// After posting
// ---------------------------------------------------------------------------

function PostedPanel({
  receipt,
  accepted,
  rejected,
  lineCount,
  onDone,
}: {
  receipt: PostedReceipt;
  accepted: number;
  rejected: number;
  lineCount: number;
  onDone: () => void;
}) {
  return (
    <Result
      eyebrow="Goods receipt posted"
      value={receipt.grnNo}
      actions={
        <>
          <PrimaryButton
            label="Back to receiving"
            icon="arrow-back"
            density="field"
            onPress={onDone}
          />
          <Text role="caption" tone="muted" align="center" style={{ marginTop: space.lg }}>
            This receipt cannot be edited. A correction is a fresh receipt that supersedes it,
            carrying a reason and the name of whoever authorised it.
          </Text>
        </>
      }
    >
      <SummaryLine label={`${lineCount} line${lineCount === 1 ? "" : "s"}`} value="" />
      <SummaryLine
        label="Into quarantine at Terminal 1"
        value={fmt(accepted)}
        hint="On the books, not yet issuable. Put it away to make it available."
      />
      {rejected > 0 ? (
        <SummaryLine
          label="Into the reject hold"
          value={fmt(rejected)}
          hint="Supplier liability. It can never reach a zone, and it leaves on a gate pass."
          tone="bad"
        />
      ) : null}
    </Result>
  );
}

function SummaryLine({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "bad";
}) {
  const p = usePalette();
  return (
    <View
      style={{
        paddingVertical: space.md,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: p.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, fontSize: type.body, color: p.text, ...font("medium") }}>
          {label}
        </Text>
        {value ? (
          <Text
            style={{
              fontSize: type.subheading,
              ...font("bold"),
              color: tone === "bad" ? p.danger : p.text,
              ...tabular,
            }}
          >
            {value}
          </Text>
        ) : null}
      </View>
      {hint ? (
        <Text style={{ fontSize: type.caption, color: p.textMuted, marginTop: 2, lineHeight: 17 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

/**
 * A rule that has fired and is not stopping anything.
 *
 * Worded to say so explicitly. "Witness before you enforce" only works if the person
 * reading it can tell the difference between a warning they may proceed past and one
 * they may not — otherwise every warning becomes noise and the honest record is lost.
 */
function RecordedNotice({ text }: { text: string }) {
  const p = usePalette();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        backgroundColor: p.warningSurface,
        borderRadius: radius.sm,
        padding: space.sm,
      }}
    >
      <Ionicons name="information-circle" size={15} color={p.warning} style={{ marginTop: 1 }} />
      <Text
        style={{
          flex: 1,
          fontSize: type.caption,
          color: p.warning,
          marginLeft: space.xs,
          lineHeight: 17,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  const p = usePalette();
  return (
    <Text
      accessibilityRole="header"
      style={{
        fontSize: type.micro,
        ...font("bold"),
        letterSpacing: 0.9,
        textTransform: "uppercase",
        color: p.textFaint,
        marginBottom: space.sm,
      }}
    >
      {children}
    </Text>
  );
}

/** Quantities read as 12 and 12.5, never 12.0000 — trailing zeros are noise on a dock. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}
