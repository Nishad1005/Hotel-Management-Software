import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import {
  Banner,
  Card,
  Field,
  FieldError,
  Notice,
  PrimaryButton,
  Result,
  Screen,
  SelectRow,
  SkeletonList,
  StatusPill,
  Text,
} from "../../components/ui";
import {
  issueStock,
  listDepartments,
  listIssuableStock,
  type Department,
  type DraftIssueLine,
  type IssuableLot,
  type IssuedResult,
} from "../../lib/issuing";
import { useSession } from "../../lib/session";
import { newSubmissionId } from "../../lib/stock";
import { radius, space, usePalette } from "../../theme";

/**
 * Gate 8 — issuing to a department.
 *
 * The list is first-expired-first-out and the oldest lot sits at the top, because the
 * decision this screen exists to influence is which batch goes out, not whether flour
 * goes out. A storekeeper choosing by what is nearest to the door is how a store ends up
 * writing off the back of a shelf every month.
 *
 * ## The gap, said out loud
 *
 * The receiver's name is typed. Criterion 17 wants a card scanned and a photograph on
 * screen; there is no staff master yet, so what this records is the storekeeper's
 * assertion. The screen says that in words rather than implying a control it does not
 * have — a user who believes custody is verified is worse off than one who knows it is
 * not.
 */
export default function IssueStock() {
  const router = useRouter();
  const { activeProperty } = useSession();

  const [lots, setLots] = useState<IssuableLot[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [lines, setLines] = useState<DraftIssueLine[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [receiver, setReceiver] = useState("");
  const [purpose, setPurpose] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedResult | null>(null);

  const propertyId = activeProperty?.propertyId ?? null;

  const refresh = useCallback(async () => {
    if (!propertyId) return;
    try {
      const [stock, depts] = await Promise.all([listIssuableStock(propertyId), listDepartments()]);
      setLots(stock);
      setDepartments(depts);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
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

  const taken = useMemo(() => {
    const by = new Map<string, number>();
    for (const l of lines) by.set(key(l.lot), (by.get(key(l.lot)) ?? 0) + l.qty);
    return by;
  }, [lines]);

  const problems: string[] = [];
  if (lines.length === 0) problems.push("Add at least one line.");
  if (!departmentId) problems.push("Choose who it is going to.");
  if (!receiver.trim()) problems.push("Say who is taking it.");

  async function send() {
    if (!propertyId || problems.length > 0) return;
    setSending(true);
    setError(null);
    try {
      const result = await issueStock({
        propertyId,
        departmentId,
        receiverName: receiver.trim(),
        purpose: purpose.trim() || null,
        lines,
        submissionId: newSubmissionId(),
      });
      setIssued(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  if (issued) {
    return (
      <IssuedPanel
        result={issued}
        department={departments.find((d) => d.id === departmentId)?.name ?? "the department"}
        receiver={receiver.trim()}
        lineCount={lines.length}
        onAgain={() => {
          setIssued(null);
          setLines([]);
          setReceiver("");
          setPurpose("");
          void refresh();
        }}
        onDone={() => router.replace("/")}
      />
    );
  }

  return (
    <Screen
      onSubmit={() => void send()}
      title="Issue stock"
      subtitle="Gate 8 — out of the store, into a department"
      onBack={() => router.back()}
      {...(lines.length > 0
        ? {
            footer: (
              <>
                <Text role="caption" tone="muted" style={{ marginBottom: space.sm }}>
                  {problems.length > 0
                    ? problems[0]
                    : `${lines.length} line${lines.length === 1 ? "" : "s"} to ${receiver.trim()}`}
                </Text>
                <PrimaryButton
                  label="Issue"
                  icon="arrow-forward"
                  density="field"
                  onPress={() => void send()}
                  loading={sending}
                  disabled={problems.length > 0}
                />
              </>
            ),
          }
        : {})}
    >
      {loading ? (
        <SkeletonList />
      ) : loadError ? (
        <Notice
          icon="cloud-offline-outline"
          title="Could not load the store"
          body={loadError}
          tone="bad"
        />
      ) : lots.length === 0 ? (
        <Notice
          icon="file-tray-outline"
          title="Nothing is issuable yet"
          body="Only stock that has been put away into a bin can be issued. Receive a delivery, put it away, and it appears here."
          action={<PrimaryButton label="Go to put away" onPress={() => router.push("/putaway")} />}
        />
      ) : (
        <>
          {lines.length > 0 ? (
            <View style={{ marginBottom: space.xl }}>
              <Label>Going out</Label>
              <Card padded={false}>
                {lines.map((l, i) => (
                  <DraftRow
                    key={`${key(l.lot)}-${i}`}
                    line={l}
                    divider={i < lines.length - 1}
                    onRemove={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                  />
                ))}
              </Card>
            </View>
          ) : null}

          <Card>
            <SelectRow
              label="Department"
              value={departmentId || null}
              placeholder="Who is it going to?"
              choices={departments.map((d) => ({ id: d.id, label: d.name, sublabel: d.code }))}
              onSelect={setDepartmentId}
            />

            <Field
              label="Received by"
              value={receiver}
              onChangeText={setReceiver}
              placeholder="The name of the person taking it"
              autoCapitalize="words"
              hint="Typed, not scanned. Staff cards are not built yet, so this records who the storekeeper says collected it rather than proving who did."
            />

            <Field
              label="What for"
              value={purpose}
              onChangeText={setPurpose}
              placeholder="Optional — breakfast prep, banquet, a room"
              autoCapitalize="sentences"
            />
          </Card>

          <View style={{ height: space.xl }} />

          <Label>Pick from the store — oldest first</Label>
          <Card padded={false}>
            {lots.map((lot, i) => (
              <LotRow
                key={key(lot)}
                lot={lot}
                alreadyTaken={taken.get(key(lot)) ?? 0}
                divider={i < lots.length - 1}
                onAdd={(qty) => {
                  setLines((prev) => [...prev, { lot, qty }]);
                  setError(null);
                }}
              />
            ))}
          </Card>

          {error ? (
            <View style={{ marginTop: space.lg }}>
              <FieldError message={error} />
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// The store, oldest first
// ---------------------------------------------------------------------------

function LotRow({
  lot,
  alreadyTaken,
  divider,
  onAdd,
}: {
  lot: IssuableLot;
  alreadyTaken: number;
  divider: boolean;
  onAdd: (qty: number) => void;
}) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("");

  const left = lot.qty - alreadyTaken;
  const amount = Number(qty);
  const valid = qty.trim().length > 0 && Number.isFinite(amount) && amount > 0 && amount <= left;

  const days = lot.daysRemaining;
  const expiry =
    days === null
      ? null
      : days < 0
        ? { label: `Expired ${Math.abs(days)} d ago`, tone: "bad" as const }
        : days <= 2
          ? { label: `${days} d left`, tone: "bad" as const }
          : days <= 7
            ? { label: `${days} d left`, tone: "warn" as const }
            : { label: `${days} d left`, tone: "neutral" as const };

  return (
    <View
      style={{
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: p.border,
        // Taken-out rows recede through their own tones, not a 0.45 veil that took the
        // item name to 2.87:1.
        backgroundColor: left <= 0 ? p.surfaceSunken : "transparent",
      }}
    >
      <Pressable
        onPress={() => left > 0 && setOpen((v) => !v)}
        disabled={left <= 0}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: left <= 0 }}
        accessibilityLabel={`${lot.itemName}, batch ${lot.batchNo}, ${left} ${lot.uomCode} at ${lot.locationCode}`}
        style={({ pressed }) =>
          ({
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            minHeight: 68,
            backgroundColor: pressed ? p.surfaceSunken : "transparent",
            cursor: left > 0 ? "pointer" : "not-allowed",
          }) as ViewStyle
        }
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text weight="semibold" lines={1}>
            {lot.itemName}
          </Text>
          <Text role="caption" tone="muted" lines={1} style={{ marginTop: 1 }}>
            {lot.batchNo} · {lot.locationCode}
          </Text>
          {expiry ? (
            <View style={{ marginTop: space.xs }}>
              <StatusPill
                icon={expiry.tone === "bad" ? "alert-circle" : "hourglass-outline"}
                label={expiry.label}
                tone={expiry.tone}
              />
            </View>
          ) : null}
        </View>

        <Text role="heading" numeric style={{ marginRight: space.sm }}>
          {left}
          <Text role="caption" tone="muted" weight="medium">
            {" "}
            {lot.uomCode}
          </Text>
        </Text>
        <Ionicons name={open ? "chevron-up" : "add"} size={18} color={p.accent} />
      </Pressable>

      {open ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
          {/*
            Expired stock is offered rather than hidden. The rule ships RECORD_ONLY, and a
            kitchen that cannot issue at seven in the morning works around the system
            rather than around the expiry. What the system insists on is that the fact
            survives on the issue line.
          */}
          {days !== null && days < 0 ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                backgroundColor: p.dangerSurface,
                borderRadius: radius.sm,
                padding: space.sm,
                marginBottom: space.md,
              }}
            >
              <Ionicons name="alert-circle" size={15} color={p.danger} style={{ marginTop: 1 }} />
              <Text role="caption" tone="danger" style={{ flex: 1, marginLeft: space.xs }}>
                This batch is past its date. It can still be issued, and the issue will permanently
                record that it was expired and by how many days.
              </Text>
            </View>
          ) : null}

          <Field
            label="How much"
            value={qty}
            onChangeText={setQty}
            placeholder="0"
            keyboardType="decimal-pad"
            suffix={lot.uomCode}
            hint={`Up to ${left} ${lot.uomCode} in ${lot.locationName}.`}
          />
          <PrimaryButton
            label="Add"
            icon="add"
            tone="neutral"
            onPress={() => {
              if (!valid) return;
              onAdd(amount);
              setQty("");
              setOpen(false);
            }}
            disabled={!valid}
          />
        </View>
      ) : null}
    </View>
  );
}

function DraftRow({
  line,
  divider,
  onRemove,
}: {
  line: DraftIssueLine;
  divider: boolean;
  onRemove: () => void;
}) {
  const p = usePalette();
  const expired = (line.lot.daysRemaining ?? 0) < 0;

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
          {line.qty} {line.lot.uomCode} · {line.lot.itemName}
        </Text>
        <Text role="caption" tone="muted" lines={1} style={{ marginTop: 1 }}>
          {line.lot.batchNo} from {line.lot.locationCode}
        </Text>
        {expired ? (
          <View style={{ marginTop: space.xs }}>
            <StatusPill icon="alert-circle" label="Expired — recorded on the issue" tone="bad" />
          </View>
        ) : null}
      </View>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${line.lot.itemName} from this issue`}
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
// After issuing
// ---------------------------------------------------------------------------

function IssuedPanel({
  result,
  department,
  receiver,
  lineCount,
  onAgain,
  onDone,
}: {
  result: IssuedResult;
  department: string;
  receiver: string;
  lineCount: number;
  onAgain: () => void;
  onDone: () => void;
}) {
  return (
    <Result
      eyebrow="Issued"
      value={result.issueNo}
      caption={`${lineCount} line${lineCount === 1 ? "" : "s"} to ${department}, collected by ${receiver}`}
      actions={
        <>
          <PrimaryButton
            label="Issue something else"
            icon="add"
            density="field"
            onPress={onAgain}
          />
          <View style={{ height: space.md }} />
          <PrimaryButton label="Done" tone="neutral" onPress={onDone} />
        </>
      }
    >
      {result.expiredLines > 0 ? (
        <Banner icon="alert-circle" tone="warn">
          {result.expiredLines} line{result.expiredLines === 1 ? " was" : "s were"} past date.
          Recorded on the issue with the days elapsed.
        </Banner>
      ) : null}

      {/*
        Stated on the success screen, not only in a hint on the form. This is the claim the
        property will repeat to an auditor, and it has to be the accurate one.
      */}
      <Text role="caption" tone="muted">
        The receiver&apos;s name was typed, not scanned from a card, so this records who the
        storekeeper says collected it. Card scanning arrives with the staff master.
      </Text>
    </Result>
  );
}

function Label({ children }: { children: string }) {
  return (
    <Text
      accessibilityRole="header"
      role="overline"
      tone="muted"
      style={{ marginBottom: space.sm }}
    >
      {children}
    </Text>
  );
}

/** A lot is a batch in a place. The same batch in two bins is two things to pick from. */
function key(lot: IssuableLot): string {
  return `${lot.batchId}:${lot.locationId}`;
}
