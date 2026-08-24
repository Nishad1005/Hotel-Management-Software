import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Card, Notice, PrimaryButton, Screen, StatusPill, Text } from "../../../components/ui";
import {
  REASON_LABELS,
  REJECT_LABELS,
  traceBatch,
  type Provenance,
  type TraceStep,
} from "../../../lib/registers";
import { useSession } from "../../../lib/session";
import { STATE_LABELS } from "../../../lib/stock-report";
import { space, usePalette } from "../../../theme";

/**
 * The forward trace — PRD section 7.5.
 *
 * This batch came through gate entry X from this vendor, was checked by this person, sits
 * in these bins, went to these departments, and its waste left on this gate pass. One
 * screen, and the whole of it read off records that already existed.
 *
 * It is built from the append-only ledger rather than from a purpose-made audit table. An
 * audit trail assembled separately can disagree with the stock it describes, and the
 * disagreement surfaces during a recall — the one moment it must not.
 */
export default function BatchTrace() {
  const p = usePalette();
  const router = useRouter();
  const { activeProperty } = useSession();
  const { batch } = useLocalSearchParams<{ batch: string }>();

  const [provenance, setProvenance] = useState<Provenance | null>(null);
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const propertyId = activeProperty?.propertyId ?? null;

  useEffect(() => {
    if (!propertyId || !batch) return;
    let alive = true;
    void (async () => {
      try {
        const result = await traceBatch(propertyId, batch);
        if (!alive) return;
        setProvenance(result.provenance);
        setSteps(result.steps);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [propertyId, batch]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background, justifyContent: "center" }}>
        <ActivityIndicator size="large" color={p.accent} />
      </View>
    );
  }

  if (error || !provenance) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background, justifyContent: "center" }}>
        <Notice
          icon={error ? "cloud-offline-outline" : "help-circle-outline"}
          tone="bad"
          title={error ? "Could not trace it" : "No such batch here"}
          body={error ?? "That batch does not belong to this property."}
          action={
            <PrimaryButton label="Back to registers" onPress={() => router.replace("/registers")} />
          }
        />
      </View>
    );
  }

  return (
    <Screen
      title={provenance.itemName}
      subtitle={`Batch ${provenance.batchNo}${provenance.isSystemGenerated ? " · generated" : ""}`}
      onBack={() => router.back()}
    >
      <Label>Where it came from</Label>
      <Card>
        {provenance.source === "OPENING_STOCK" ? (
          /*
                Said plainly rather than shown as blanks. An opening balance has no vendor
                and no gate entry because nobody delivered it — it was counted onto the
                books on day one — and a trace with empty fields reads as missing data
                rather than as an honest answer.
              */
          <Text role="caption" tone="muted">
            Recorded as opening stock. There is no vendor or gate entry behind it: this batch was
            counted onto the books when the property started using Golai, not received through the
            gate. Everything after that point is traced below.
          </Text>
        ) : (
          <>
            <Fact label="Vendor" value={provenance.vendorName ?? "Not named"} />
            {provenance.vendorFssai ? (
              <Fact label="FSSAI licence" value={provenance.vendorFssai} />
            ) : null}
            <Fact label="Arrived at the gate" value={dateTime(provenance.arrivedAt)} />
            <Fact label="Gate entry" value={provenance.gateEntryNo ?? "—"} mono />
            <Fact label="Goods receipt" value={provenance.grnNo ?? "—"} mono />
            <Fact label="Received by" value={provenance.receivedBy ?? "—"} />
          </>
        )}
      </Card>

      <View style={{ height: space.xl }} />

      <Label>What was checked</Label>
      <Card>
        <Fact label="Best before" value={provenance.bestBefore ?? "Does not expire"} />
        {provenance.mfgDate ? <Fact label="Manufactured" value={provenance.mfgDate} /> : null}
        {provenance.receiptTempC !== null ? (
          <Fact label="Probe temperature" value={`${provenance.receiptTempC} °C`} />
        ) : null}
        {provenance.pctAtReceipt !== null ? (
          <Fact
            label="Shelf life at receipt"
            value={`${provenance.pctAtReceipt}%`}
            hint="Frozen at the moment of receiving, never recomputed — it records how old the delivery already was."
          />
        ) : null}
        {provenance.decision ? (
          <Fact
            label="Decision"
            value={
              provenance.decision === "ACCEPT"
                ? "Accepted"
                : provenance.decision === "REJECT"
                  ? "Rejected"
                  : "Part accepted"
            }
            {...(provenance.rejectReason ? { hint: REJECT_LABELS[provenance.rejectReason] } : {})}
          />
        ) : null}

        {provenance.dwellBreach ? (
          <View style={{ marginTop: space.sm }}>
            <StatusPill
              icon="hourglass"
              label="Stood at Terminal 1 longer than allowed"
              tone="warn"
            />
          </View>
        ) : null}
      </Card>

      <View style={{ height: space.xl }} />

      <Label>Everywhere it went</Label>
      {steps.length === 0 ? (
        <Card>
          <Text role="caption" tone="muted">
            No movements recorded against this batch yet.
          </Text>
        </Card>
      ) : (
        <Card padded={false}>
          {steps.map((s, i) => (
            <Step
              key={`${s.occurredAt}-${i}`}
              step={s}
              first={i === 0}
              last={i === steps.length - 1}
            />
          ))}
        </Card>
      )}

      <Text role="caption" tone="muted" style={{ marginTop: space.lg }}>
        Nothing on this screen was entered for a register. Every line is a record made at a gate for
        an operational reason, read back — which is what makes it worth showing to an inspector.
      </Text>
    </Screen>
  );
}

/**
 * One movement, on a rail.
 *
 * A vertical line with a node per step, because a trace is read as a sequence and a flat
 * list of rows does not say that the third thing happened after the second.
 */
function Step({ step, first, last }: { step: TraceStep; first: boolean; last: boolean }) {
  const p = usePalette();

  const destination = step.toCode
    ? `${step.toCode}${step.toName ? ` · ${step.toName}` : ""}`
    : "Off the property";
  const origin = step.fromCode
    ? `${step.fromCode}${step.fromName ? ` · ${step.fromName}` : ""}`
    : null;
  const state = step.toState ? STATE_LABELS[step.toState] : null;

  return (
    <View style={{ flexDirection: "row", paddingHorizontal: space.lg }}>
      {/* The rail. Drawn either side of the node so the ends of the run stay open. */}
      <View style={{ width: 20, alignItems: "center" }}>
        <View
          style={{
            width: 2,
            flex: 0,
            height: space.md,
            backgroundColor: first ? "transparent" : p.border,
          }}
        />
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: last ? p.accent : p.borderStrong,
          }}
        />
        <View style={{ width: 2, flex: 1, backgroundColor: last ? "transparent" : p.border }} />
      </View>

      <View
        style={{
          flex: 1,
          minWidth: 0,
          paddingLeft: space.md,
          paddingBottom: space.lg,
          paddingTop: space.sm,
        }}
      >
        <Text weight="semibold">{REASON_LABELS[step.reason]}</Text>
        <Text role="caption" tone="muted" style={{ marginTop: 1 }}>
          {origin ? `${origin} → ` : ""}
          {destination}
        </Text>
        <Text role="caption" tone="muted" style={{ marginTop: 1 }}>
          {dateTime(step.occurredAt)}
          {step.recordedByName ? ` · ${step.recordedByName}` : ""}
        </Text>

        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.xs }}
        >
          <StatusPill label={`${fmt(step.qty)} ${step.uomCode}`} tone="neutral" />
          {state ? <StatusPill label={state.label} tone={state.tone} /> : null}
          {/*
            The concession, visible in the trail. Hard rule 13 wants a scanned bin, this
            build permits typing, and a trace that did not say which would be asserting
            more than happened.
          */}
          {step.scanMethod ? (
            <StatusPill
              icon={step.scanMethod === "TYPED" ? "create-outline" : "barcode-outline"}
              label={
                step.scanMethod === "TYPED"
                  ? "Bin typed, not scanned"
                  : step.scanMethod === "CAMERA"
                    ? "Scanned with the camera"
                    : "Scanned"
              }
              tone={step.scanMethod === "TYPED" ? "warn" : "good"}
            />
          ) : null}
        </View>

        {step.note ? (
          <Text role="caption" tone="muted" style={{ marginTop: space.xs }}>
            {step.note}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Fact({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: space.sm }}>
      <Text role="caption" tone="muted" style={{ width: 128 }}>
        {label}
      </Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text selectable role="label" weight="semibold" numeric={mono === true}>
          {value}
        </Text>
        {hint ? (
          <Text role="caption" tone="muted" style={{ marginTop: 1 }}>
            {hint}
          </Text>
        ) : null}
      </View>
    </View>
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

function dateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}
