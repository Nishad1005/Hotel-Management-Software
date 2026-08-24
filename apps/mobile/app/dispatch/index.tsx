import { Ionicons } from "@expo/vector-icons";
import type { DispatchType } from "@golai/db";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { DateField } from "../../components/date-field";
import {
  Card,
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
import {
  DISPATCH_TYPES,
  listDispatchableStock,
  RETURNABLE_TYPES,
  stageForDispatch,
  type DispatchableLot,
  type DraftDispatchLine,
} from "../../lib/dispatch";
import { listParties, type Party } from "../../lib/parties";
import { useSession } from "../../lib/session";
import { newSubmissionId } from "../../lib/stock";
import { font, radius, space, type, usePalette } from "../../theme";

/**
 * Gate 9 — staging at Terminal 2.
 *
 * Everything leaving the property passes through here and then Security. Nothing goes out
 * of a back door, and that claim is only true if this screen is easier than the back door.
 *
 * The reject hold is listed first because it is the stock with a clock on it: the vendor
 * is owed an answer, and a cage nobody empties is how the reject decision quietly stops
 * being made at all.
 */
export default function StageDispatch() {
  const router = useRouter();
  const { activeProperty } = useSession();

  const [lots, setLots] = useState<DispatchableLot[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [lines, setLines] = useState<DraftDispatchLine[]>([]);
  const [dispatchType, setDispatchType] = useState<DispatchType | null>(null);
  const [recipientId, setRecipientId] = useState("");
  const [reason, setReason] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<{ no: string; lines: number } | null>(null);

  const propertyId = activeProperty?.propertyId ?? null;

  const refresh = useCallback(async () => {
    if (!propertyId) return;
    try {
      const [stock, list] = await Promise.all([listDispatchableStock(propertyId), listParties()]);
      setLots(stock);
      setParties(list);
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

  const returnable = dispatchType !== null && RETURNABLE_TYPES.includes(dispatchType);

  const problems: string[] = [];
  if (lines.length === 0) problems.push("Add at least one line.");
  if (!dispatchType) problems.push("Say what kind of departure this is.");
  if (returnable && !returnDate.trim())
    problems.push("This kind comes back, so it needs an expected return date.");

  async function send() {
    if (!propertyId || !dispatchType || problems.length > 0) return;
    setSending(true);
    setError(null);
    try {
      const result = await stageForDispatch({
        propertyId,
        dispatchType,
        recipientPartyId: recipientId || null,
        reasonCode: reason.trim() || null,
        isReturnable: returnable,
        expectedReturnDate: returnable ? returnDate.trim() : null,
        lines,
        submissionId: newSubmissionId(),
      });
      setStaged({ no: result.dispatchNo, lines: lines.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  if (staged) {
    return (
      <Result
        icon="albums-outline"
        eyebrow="Staged at Terminal 2"
        value={staged.no}
        actions={
          <>
            <PrimaryButton
              label="Go to gate out"
              icon="exit-outline"
              density="field"
              onPress={() => router.replace("/gate-out")}
            />
            <View style={{ height: space.md }} />
            <PrimaryButton
              label="Stage something else"
              tone="neutral"
              onPress={() => {
                setStaged(null);
                setLines([]);
                setDispatchType(null);
                setRecipientId("");
                setReason("");
                setReturnDate("");
                void refresh();
              }}
            />
          </>
        }
      >
        {/*
          The distinction the whole gate rests on. Staged stock is still the property's —
          still counted, still on the books — and a screen that said "dispatched" here would
          be the app asserting something untrue for as long as the crates sit by the door.
        */}
        <Text role="caption" tone="muted">
          {staged.lines} line{staged.lines === 1 ? "" : "s"} moved to the dispatch bay. It has not
          left: it is still on the property and still counted, until Security verifies it out on a
          gate pass.
        </Text>
      </Result>
    );
  }

  return (
    <Screen
      title="Send out"
      subtitle="Gate 9 — stage it at Terminal 2"
      onBack={() => router.back()}
      {...(lines.length > 0
        ? {
            footer: (
              <>
                <Text role="caption" tone="muted" style={{ marginBottom: space.sm }}>
                  {problems[0] ??
                    `${lines.length} line${lines.length === 1 ? "" : "s"} to Terminal 2`}
                </Text>
                <PrimaryButton
                  label="Stage at Terminal 2"
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
        <Loading />
      ) : loadError ? (
        <Notice
          icon="cloud-offline-outline"
          title="Could not load the store"
          body={loadError}
          tone="bad"
        />
      ) : lots.length === 0 ? (
        <Notice
          icon="checkmark-circle-outline"
          title="Nothing to send out"
          body="Rejected goods, empties, linen and equipment appear here. Nothing is waiting."
        />
      ) : (
        <>
          {lines.length > 0 ? (
            <View style={{ marginBottom: space.xl }}>
              <Label>Leaving</Label>
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
              label="What kind of departure"
              value={dispatchType}
              placeholder="Choose"
              choices={DISPATCH_TYPES.map((d) => ({
                id: d.id,
                label: d.label,
                sublabel: d.hint,
              }))}
              onSelect={(id) => setDispatchType(id as DispatchType)}
            />

            <SelectRow
              label="Who is receiving it"
              value={recipientId || null}
              placeholder="Vendor, laundry, handler — optional"
              choices={parties.map((v) => ({ id: v.id, label: v.name, sublabel: v.code }))}
              onSelect={setRecipientId}
            />

            <Field
              label="Why"
              value={reason}
              onChangeText={setReason}
              placeholder="Arrived at 11 degrees"
              autoCapitalize="sentences"
              hint="What you would say to the vendor. It goes on the dispatch note."
            />

            {returnable ? (
              <DateField
                label="Expected back"
                value={returnDate}
                onChange={setReturnDate}
                hint="This kind of departure comes back, so it stays on the returnable register until it does."
              />
            ) : null}
          </Card>

          <View style={{ height: space.xl }} />

          <Label>Pick what is going</Label>
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

function LotRow({
  lot,
  alreadyTaken,
  divider,
  onAdd,
}: {
  lot: DispatchableLot;
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
  const rejected = lot.state === "REJECT_HOLD";

  return (
    <View
      style={{
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: p.border,
        opacity: left <= 0 ? 0.45 : 1,
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
          <View style={{ marginTop: space.xs }}>
            <StatusPill
              icon={rejected ? "close-circle" : "cube-outline"}
              label={rejected ? "Rejected — owed back to the vendor" : "In the store"}
              tone={rejected ? "bad" : "neutral"}
            />
          </View>
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
  line: DraftDispatchLine;
  divider: boolean;
  onRemove: () => void;
}) {
  const p = usePalette();
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
      </View>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${line.lot.itemName}`}
        hitSlop={10}
        style={({ pressed }) =>
          ({
            width: 40,
            height: 40,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.sm,
            backgroundColor: pressed ? p.dangerSurface : "transparent",
            cursor: "pointer",
          }) as ViewStyle
        }
      >
        <Ionicons name="close" size={18} color={p.textMuted} />
      </Pressable>
    </View>
  );
}

function Label({ children }: { children: string }) {
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

/** A lot is a batch, in a place, in a state. Rejected and available are different things. */
function key(lot: DispatchableLot): string {
  return `${lot.batchId}:${lot.locationId}:${lot.state}`;
}
