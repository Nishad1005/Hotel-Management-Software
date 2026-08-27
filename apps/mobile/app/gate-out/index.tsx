import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  Card,
  Field,
  FieldError,
  Notice,
  PrimaryButton,
  Screen,
  SkeletonList,
  StatusPill,
  Text,
} from "../../components/ui";
import {
  DISPATCH_TYPES,
  issueGatePass,
  listAwaitingGatePass,
  type StagedDispatch,
} from "../../lib/dispatch";
import { useSession } from "../../lib/session";
import { newSubmissionId } from "../../lib/stock";
import { radius, space, usePalette } from "../../theme";

/**
 * Gate 10 — Security passes it out.
 *
 * Hard rule 15: nothing leaves the property without a gate pass, and there is no
 * exception path in this UI. There is no "let it go this once" button, because a rule with
 * one is a rule the property learns to route around within a week.
 *
 * PRD section 11 also requires that whoever staged a consignment is not whoever verifies
 * it out. The server refuses it; this screen says so BEFORE the attempt, because being
 * told after typing a driver's name reads as a bug rather than as a control.
 */
export default function GateOut() {
  const p = usePalette();
  const router = useRouter();
  const { activeProperty, session } = useSession();

  const [waiting, setWaiting] = useState<StagedDispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StagedDispatch | null>(null);
  const [passed, setPassed] = useState<{ no: string; dispatch: string } | null>(null);

  const propertyId = activeProperty?.propertyId ?? null;
  const me = session?.user.id ?? null;

  const refresh = useCallback(async () => {
    if (!propertyId) return;
    try {
      const next = await listAwaitingGatePass(propertyId);
      setWaiting(next);
      setSelected((current) =>
        current ? (next.find((d) => d.dispatchId === current.dispatchId) ?? null) : null,
      );
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

  return (
    <Screen
      title="Gate out"
      subtitle={
        loading
          ? "Loading Terminal 2"
          : waiting.length === 0
            ? "Nothing waiting to leave"
            : `${waiting.length} consignment${waiting.length === 1 ? "" : "s"} at the dispatch bay`
      }
      onBack={() => router.back()}
    >
      {passed ? (
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
            <Text role="overline" tone="muted" style={{ marginTop: space.lg }}>
              Gate pass issued
            </Text>
            <Text selectable role="title" weight="heavy" numeric style={{ marginTop: space.xs }}>
              {passed.no}
            </Text>
            <Text role="caption" tone="muted" align="center" style={{ marginTop: space.sm }}>
              {passed.dispatch} has left the property. Write this number on the driver&apos;s copy —
              it is what ties the vehicle at the gate to the goods that went with it.
            </Text>
          </View>
          <View style={{ marginTop: space.lg }}>
            <PrimaryButton label="Done" tone="neutral" onPress={() => setPassed(null)} />
          </View>
        </Card>
      ) : loading ? (
        <SkeletonList />
      ) : loadError ? (
        <Notice
          icon="cloud-offline-outline"
          title="Could not load Terminal 2"
          body={loadError}
          tone="bad"
        />
      ) : waiting.length === 0 ? (
        <Notice
          icon="checkmark-circle-outline"
          action={
            <PrimaryButton label="Stage something" onPress={() => router.push("/dispatch")} />
          }
          title="Nothing is waiting to leave"
          body="Consignments appear here once they are staged at Terminal 2. Nothing leaves the property except through this screen."
        />
      ) : selected ? (
        <PassPanel
          dispatch={selected}
          propertyId={propertyId ?? ""}
          blocked={me !== null && selected.stagedBy === me}
          onCancel={() => setSelected(null)}
          onDone={(no) => {
            setPassed({ no, dispatch: selected.dispatchNo });
            setSelected(null);
            void refresh();
          }}
        />
      ) : (
        <Card padded={false}>
          {waiting.map((d, i) => (
            <StagedRow
              key={d.dispatchId}
              dispatch={d}
              mine={me !== null && d.stagedBy === me}
              divider={i < waiting.length - 1}
              onPress={() => setSelected(d)}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}

function StagedRow({
  dispatch,
  mine,
  divider,
  onPress,
}: {
  dispatch: StagedDispatch;
  mine: boolean;
  divider: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  const kind =
    DISPATCH_TYPES.find((t) => t.id === dispatch.dispatchType)?.label ?? dispatch.dispatchType;

  return (
    <View
      style={{
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: p.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text lines={1} role="heading">
            {kind}
            {dispatch.recipientName ? ` · ${dispatch.recipientName}` : ""}
          </Text>
          <Text lines={1} role="caption" tone="muted" style={{ marginTop: 1 }}>
            {dispatch.dispatchNo} · {dispatch.lineCount} line
            {dispatch.lineCount === 1 ? "" : "s"} · staged by {dispatch.stagedByName ?? "someone"}
          </Text>
          <View style={{ flexDirection: "row", gap: space.xs, marginTop: space.xs }}>
            {dispatch.isReturnable ? (
              <StatusPill icon="repeat-outline" label="Comes back" tone="warn" />
            ) : null}
            {mine ? <StatusPill icon="lock-closed" label="You staged this" tone="bad" /> : null}
          </View>
        </View>
      </View>

      <View style={{ marginTop: space.md }}>
        <PrimaryButton
          label={mine ? "Someone else has to pass this out" : "Pass it out"}
          icon={mine ? "lock-closed" : "exit-outline"}
          density="field"
          tone={mine ? "neutral" : "accent"}
          onPress={onPress}
          disabled={mine}
        />
      </View>
    </View>
  );
}

function PassPanel({
  dispatch,
  propertyId,
  blocked,
  onCancel,
  onDone,
}: {
  dispatch: StagedDispatch;
  propertyId: string;
  blocked: boolean;
  onCancel: () => void;
  onDone: (gatePassNo: string) => void;
}) {
  const p = usePalette();
  const [carrier, setCarrier] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [packages, setPackages] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = packages.trim() ? Number(packages) : null;
  const countValid = count === null || (Number.isFinite(count) && count >= 1);
  const ready = carrier.trim().length > 0 && countValid && !blocked;

  async function pass() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await issueGatePass({
        propertyId,
        dispatchNoteId: dispatch.dispatchId,
        carrier: carrier.trim(),
        vehicleNumber: vehicle.trim() || null,
        packageCount: count,
        submissionId: newSubmissionId(),
      });
      onDone(result.gatePassNo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <Text role="title">{dispatch.dispatchNo}</Text>
        <Text role="caption" tone="muted" style={{ marginTop: 2 }}>
          {dispatch.lineCount} line{dispatch.lineCount === 1 ? "" : "s"} · {dispatch.totalQty} in
          total · staged by {dispatch.stagedByName ?? "someone"}
        </Text>

        {blocked ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              backgroundColor: p.dangerSurface,
              borderRadius: radius.sm,
              padding: space.sm,
              marginTop: space.md,
            }}
          >
            <Ionicons name="lock-closed" size={15} color={p.danger} style={{ marginTop: 1 }} />
            <Text role="caption" tone="danger" style={{ flex: 1, marginLeft: space.xs }}>
              You staged this consignment, so you cannot also verify it out. Two people is the
              control, and there is no override.
            </Text>
          </View>
        ) : null}

        <View style={{ height: space.xl }} />

        <Field
          label="Who is carrying it out"
          value={carrier}
          onChangeText={setCarrier}
          placeholder="The driver or the person collecting"
          autoCapitalize="words"
          hint="Typed, not scanned from a card. This records who the gate says took it."
        />

        <Field
          label="Vehicle number"
          value={vehicle}
          onChangeText={setVehicle}
          placeholder="AS-23-C-4471 — optional"
          autoCapitalize="characters"
        />

        <Field
          label="Packages"
          value={packages}
          onChangeText={setPackages}
          placeholder="Optional"
          keyboardType="numeric"
          error={countValid ? "" : "A count is one or more, or leave it blank."}
        />

        {error ? <FieldError message={error} /> : null}

        <PrimaryButton
          label="Issue the gate pass"
          icon="exit-outline"
          density="field"
          onPress={() => void pass()}
          loading={busy}
          disabled={!ready}
        />
      </Card>

      <View style={{ marginTop: space.lg }}>
        <PrimaryButton label="Back to the list" tone="neutral" onPress={onCancel} />
      </View>
    </>
  );
}
