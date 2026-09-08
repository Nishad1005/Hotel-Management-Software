import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { View } from "react-native";
import {
  Card,
  Dialog,
  Field,
  FieldError,
  Notice,
  PrimaryButton,
  Screen,
  SelectRow,
  SkeletonList,
  StatusPill,
  Text,
} from "../../components/ui";
import { listDepartments, type Department } from "../../lib/issuing";
import { createPerson, listPeople, setPersonActive, type Person } from "../../lib/people";
import { useSession } from "../../lib/session";
import { radius, space, usePalette } from "../../theme";

/**
 * Staff cards — who may take custody of material.
 *
 * Separate from People, which is about logins, and the separation is the product rather
 * than an accident of navigation. Most of the property never signs in: the steward who
 * collects a sack of rice at six in the morning holds a card and no password. Merging the
 * two screens would push everyone here through an account-creation flow they do not need
 * and cannot use (PRD section 4 Gate 8, "identity is not access").
 */
export default function StaffCards() {
  const p = usePalette();
  const router = useRouter();
  const { activeProperty, canEditMasters } = useSession();

  const [people, setPeople] = useState<Person[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ name: string; code: string } | null>(null);
  const [stopping, setStopping] = useState<Person | null>(null);

  const propertyId = activeProperty?.propertyId ?? null;

  const refresh = useCallback(async () => {
    if (!propertyId) return;
    try {
      const [list, depts] = await Promise.all([listPeople(propertyId), listDepartments()]);
      setPeople(list);
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

  async function add() {
    if (!propertyId || !fullName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await createPerson({
        propertyId,
        fullName: fullName.trim(),
        departmentId: departmentId || null,
      });
      setIssued({ name: fullName.trim(), code: made.personCode });
      setFullName("");
      setDepartmentId("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const active = people.filter((x) => x.isActive);
  const stopped = people.filter((x) => !x.isActive);

  return (
    <Screen
      onSubmit={() => void add()}
      title="Staff cards"
      subtitle="Who may take custody of material"
      onBack={() => router.back()}
    >
      {/*
        The number, shown once and large. It goes onto a printed card, and the moment to
        read it out is now — there is no reissue flow that changes it, because the number
        is the person's identity in every record that already names them.
      */}
      {issued ? (
        <View
          style={{
            backgroundColor: p.accentSurface,
            borderRadius: radius.lg,
            padding: space.lg,
            marginBottom: space.xl,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.md }}>
            <Ionicons name="card" size={18} color={p.accent} />
            <Text tone="accent" weight="bold" style={{ marginLeft: space.sm }}>
              {issued.name} has a card
            </Text>
          </View>
          <Text role="caption" tone="muted" style={{ marginBottom: space.xs }}>
            Card number — print it with their name and photograph
          </Text>
          <Text selectable role="title" weight="heavy">
            {issued.code}
          </Text>
          <Text role="caption" tone="muted" style={{ marginTop: space.md }}>
            This number never changes, including on a reissued card. A lost card is stopped and
            replaced with the same number.
          </Text>
          <View style={{ marginTop: space.lg }}>
            <PrimaryButton label="Done" tone="neutral" onPress={() => setIssued(null)} />
          </View>
        </View>
      ) : null}

      {canEditMasters ? (
        <View style={{ marginBottom: space.xl }}>
          <Card>
            <Text role="overline" tone="muted" style={{ marginBottom: space.md }}>
              Add somebody
            </Text>
            <Field
              label="Full name"
              value={fullName}
              onChangeText={setFullName}
              placeholder="As it should read on the card"
              autoCapitalize="words"
              density="field"
            />
            <SelectRow
              label="Department"
              value={departmentId || null}
              placeholder="Optional — agency staff often have none"
              choices={departments.map((d) => ({ id: d.id, label: d.name, sublabel: d.code }))}
              onSelect={setDepartmentId}
            />
            {error ? <FieldError message={error} /> : null}
            <PrimaryButton
              label="Issue a card"
              icon="add"
              tone="neutral"
              onPress={() => void add()}
              loading={busy}
            />
          </Card>
        </View>
      ) : null}

      {loading ? (
        <SkeletonList />
      ) : loadError ? (
        <Notice
          icon="cloud-offline-outline"
          title="Could not load the staff master"
          body={loadError}
          tone="bad"
        />
      ) : people.length === 0 ? (
        <Notice
          icon="card-outline"
          title="Nobody holds a card yet"
          body="A card identifies whoever takes material from the store. Until somebody holds one, every issue is recorded as unverified — which is honest, and countable, but it is not the control."
        />
      ) : (
        <>
          <Text role="overline" tone="muted" style={{ marginBottom: space.sm }}>
            Holding a card · {active.length}
          </Text>
          {active.map((x) => (
            <PersonRow
              key={x.id}
              person={x}
              onStop={canEditMasters ? () => setStopping(x) : undefined}
            />
          ))}

          {stopped.length > 0 ? (
            <>
              <Text
                role="overline"
                tone="muted"
                style={{ marginTop: space.xl, marginBottom: space.sm }}
              >
                Stopped · {stopped.length}
              </Text>
              {/*
                Kept on screen rather than filtered away. A stopped card is a fact about
                the property — somebody left and their plastic is still out there — and a
                register that hides it cannot answer "whose card stopped working".
              */}
              {stopped.map((x) => (
                <PersonRow key={x.id} person={x} />
              ))}
            </>
          ) : null}
        </>
      )}

      <StopDialog
        person={stopping}
        propertyId={propertyId}
        onClose={() => setStopping(null)}
        onStopped={() => {
          setStopping(null);
          void refresh();
        }}
      />
    </Screen>
  );
}

function PersonRow({ person, onStop }: { person: Person; onStop?: (() => void) | undefined }) {
  const p = usePalette();

  return (
    <View style={{ marginBottom: space.sm, opacity: person.isActive ? 1 : 0.7 }}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Text weight="semibold">{person.fullName}</Text>
            <Text role="caption" tone="muted" style={{ marginTop: 2 }}>
              {person.personCode}
              {person.departmentName ? ` · ${person.departmentName}` : ""}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            {person.hasLogin ? (
              <StatusPill icon="log-in-outline" label="Also signs in" tone="brass" />
            ) : null}
            {person.isActive ? null : <StatusPill icon="lock-closed" label="Stopped" tone="bad" />}
          </View>
        </View>

        {onStop ? (
          <View style={{ marginTop: space.md }}>
            <PrimaryButton
              label="Stop this card"
              icon="lock-closed"
              tone="neutral"
              onPress={onStop}
            />
          </View>
        ) : null}

        {/*
        Photographs are criterion 18 and need an image store this build does not have.
        Said on screen rather than left as a blank space, so the absence reads as a known
        gap rather than a card that failed to load one.
      */}
        {person.isActive && !person.photoRef ? (
          <Text role="caption" tone="muted" style={{ marginTop: space.sm, color: p.textFaint }}>
            No photograph yet — the storekeeper cannot check the face against the card.
          </Text>
        ) : null}
      </Card>
    </View>
  );
}

/**
 * Stopping a card, which the server refuses without a reason.
 *
 * The reason is not paperwork. "Contract ended" and "card lost" lead to different
 * actions — one is finished, the other means a card is loose on the property — and a
 * revocation nobody can review is not a control.
 */
function StopDialog({
  person,
  propertyId,
  onClose,
  onStopped,
}: {
  person: Person | null;
  propertyId: string | null;
  onClose: () => void;
  onStopped: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function stop() {
    if (!propertyId || !person || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setPersonActive({ propertyId, personId: person.id, active: false, reason });
      setReason("");
      onStopped();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      visible={person !== null}
      title={person ? `Stop ${person.fullName}'s card` : ""}
      onClose={onClose}
      footer={
        <PrimaryButton
          label="Stop the card"
          icon="lock-closed"
          density="field"
          onPress={() => void stop()}
          loading={busy}
        />
      }
    >
      {person ? (
        <>
          <Text tone="muted" style={{ marginBottom: space.md }}>
            {person.personCode} stops working the moment this is saved — on every device, whether or
            not it has synced. {person.fullName} stays on the register, because they are named on
            everything they ever signed for.
          </Text>
          <Field
            label="Why"
            value={reason}
            onChangeText={setReason}
            placeholder="Contract ended, card lost, dismissed"
            autoCapitalize="sentences"
            density="field"
          />
          {error ? <FieldError message={error} /> : null}
        </>
      ) : null}
    </Dialog>
  );
}
