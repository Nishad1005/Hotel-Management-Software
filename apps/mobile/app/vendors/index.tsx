import { Ionicons } from "@expo/vector-icons";
import type { PartyType } from "@golai/db";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import {
  Card,
  Dialog,
  Field,
  FieldError,
  IconButton,
  Notice,
  PrimaryButton,
  Screen,
  SelectRow,
  SkeletonList,
  StatusPill,
  Text,
  Toggle,
} from "../../components/ui";
import {
  createParty,
  listParties,
  PARTY_TYPES,
  suggestPartyCode,
  updateParty,
  type Party,
  type PartyWrite,
} from "../../lib/parties";
import { useSession } from "../../lib/session";
import { space, usePalette } from "../../theme";

/**
 * The counterparty master.
 *
 * Not "vendors", underneath — one entity with a type discriminator, because Terminal 2
 * scans the laundry exactly as Terminal 1 scans the vendor. The screen is called Vendors
 * because that is what a hotel calls the list, and the type sits on the record rather
 * than in the navigation.
 *
 * The control that earns its place is `on_hold`. A vendor under a food safety complaint
 * shows red at the gate before anything comes off the vehicle — and because status is
 * resolved at scan time rather than printed on a card, lifting or applying it takes
 * effect immediately.
 */
export default function Vendors() {
  const router = useRouter();
  const { activeProperty } = useSession();

  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Party | "new" | null>(null);

  const propertyId = activeProperty?.propertyId ?? null;

  const refresh = useCallback(async () => {
    try {
      setParties(await listParties(true));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const held = parties.filter((v) => v.onHold).length;

  return (
    <Screen
      title="Vendors"
      subtitle={
        loading
          ? "Loading"
          : `${parties.length} counterpart${parties.length === 1 ? "y" : "ies"}${
              held > 0 ? ` · ${held} on hold` : ""
            }`
      }
      onBack={() => router.back()}
      actions={
        <IconButton
          icon="add"
          label="Add a counterparty"
          tone="accent"
          onPress={() => setEditing("new")}
        />
      }
    >
      {loading ? (
        <SkeletonList />
      ) : error ? (
        <Notice icon="cloud-offline-outline" title="Could not load" body={error} tone="bad" />
      ) : parties.length === 0 ? (
        <Notice
          icon="business-outline"
          title="No vendors yet"
          body="A gate entry can name an unregistered vendor, but a registered one carries the hold status, the FSSAI licence and the GSTIN — which is what makes the register a register."
          action={<PrimaryButton label="Add the first" onPress={() => setEditing("new")} />}
        />
      ) : (
        <Card padded={false}>
          {parties.map((v, i) => (
            <PartyRow
              key={v.id}
              party={v}
              divider={i < parties.length - 1}
              onPress={() => setEditing(v)}
            />
          ))}
        </Card>
      )}

      <PartyEditor
        subject={editing}
        propertyId={propertyId}
        propertyCode={activeProperty?.propertyCode ?? ""}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void refresh();
        }}
      />
    </Screen>
  );
}

function PartyRow({
  party,
  divider,
  onPress,
}: {
  party: Party;
  divider: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  const kind = PARTY_TYPES.find((t) => t.id === party.partyType)?.label ?? party.partyType;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${party.name}, ${kind}${party.onHold ? ", on hold" : ""}`}
      style={({ pressed, hovered }) =>
        ({
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          minHeight: 64,
          backgroundColor: pressed ? p.border : hovered ? p.surfaceSunken : "transparent",
          borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: p.border,
          cursor: "pointer",
        }) as ViewStyle
      }
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* Muted, not dimmed — see the note on the item row. The "Not in use" pill
            below says what the fade was trying to say, and says it legibly. */}
        <Text weight="semibold" lines={1} tone={party.isActive ? "default" : "muted"}>
          {party.name}
        </Text>
        <Text role="caption" tone="muted" lines={1} style={{ marginTop: 1 }}>
          {party.code} · {kind}
          {party.phone ? ` · ${party.phone}` : ""}
        </Text>
        {party.onHold || !party.isActive ? (
          <View style={{ flexDirection: "row", gap: space.xs, marginTop: space.xs }}>
            {party.onHold ? (
              <StatusPill icon="hand-left" label={party.holdReason ?? "On hold"} tone="bad" />
            ) : null}
            {!party.isActive ? <StatusPill label="Not in use" tone="neutral" /> : null}
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={p.textFaint} />
    </Pressable>
  );
}

function PartyEditor({
  subject,
  propertyId,
  propertyCode,
  onClose,
  onSaved,
}: {
  subject: Party | "new" | null;
  propertyId: string | null;
  propertyCode: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = subject === "new";
  const existing = subject === "new" || subject === null ? null : subject;

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [partyType, setPartyType] = useState<PartyType>("VENDOR");
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");
  const [fssai, setFssai] = useState("");
  const [onHold, setOnHold] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Keyed on the subject rather than run in an effect: the modal is mounted the whole
  // time, so an effect on `subject` would fight the user's typing on every re-render.
  const subjectKey = isNew ? "new" : (existing?.id ?? null);
  if (subject !== null && subjectKey !== loadedFor) {
    setLoadedFor(subjectKey);
    setError(null);
    setName(existing?.name ?? "");
    setPartyType(existing?.partyType ?? "VENDOR");
    setPhone(existing?.phone ?? "");
    setGstin(existing?.gstin ?? "");
    setFssai(existing?.fssaiLicence ?? "");
    setOnHold(existing?.onHold ?? false);
    setHoldReason(existing?.holdReason ?? "");
    setIsActive(existing?.isActive ?? true);
    if (existing) {
      setCode(existing.code);
    } else {
      setCode("");
      void suggestPartyCode(propertyCode).then(setCode);
    }
  }

  const problems: string[] = [];
  if (!code.trim()) problems.push("A code is needed. It goes on the vendor's card later.");
  if (!name.trim()) problems.push("A name is needed.");
  if (onHold && !holdReason.trim())
    problems.push("Say why they are on hold. A hold nobody can explain is one nobody can lift.");

  async function save() {
    if (!propertyId || problems.length > 0) return;
    setSaving(true);
    setError(null);
    const write: PartyWrite = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      partyType,
      phone: phone.trim() || null,
      gstin: gstin.trim().toUpperCase() || null,
      fssaiLicence: fssai.trim() || null,
      onHold,
      holdReason: onHold ? holdReason.trim() : null,
      isActive,
    };
    try {
      if (existing) await updateParty(existing.id, write);
      else await createParty(propertyId, write);
      onSaved();
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
      title={isNew ? "New counterparty" : (existing?.name ?? "")}
      onClose={onClose}
      footer={
        <PrimaryButton
          label={isNew ? "Add" : "Save"}
          icon="checkmark"
          onPress={() => void save()}
          loading={saving}
          disabled={problems.length > 0}
        />
      }
    >
      <Card>
        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Bhaskar Fish Supply"
          autoCapitalize="words"
        />

        <SelectRow
          label="What they are"
          value={partyType}
          placeholder="Choose"
          choices={PARTY_TYPES.map((t) => ({ id: t.id, label: t.label, sublabel: t.hint }))}
          onSelect={(id) => setPartyType(id as PartyType)}
        />

        <Field
          label="Code"
          value={code}
          onChangeText={setCode}
          placeholder="SB-VEN-000001"
          autoCapitalize="characters"
          hint="Suggested from the property's series. Change it if the property already numbers its vendors."
        />

        <Field
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          placeholder="+91…"
          keyboardType="numeric"
        />
      </Card>

      <View style={{ height: space.xl }} />

      <Card>
        <Field
          label="FSSAI licence"
          value={fssai}
          onChangeText={setFssai}
          placeholder="Optional"
          autoCapitalize="characters"
          hint="A food vendor's licence number. It belongs on the register whether or not anybody checks it today."
        />
        <Field
          label="GSTIN"
          value={gstin}
          onChangeText={setGstin}
          placeholder="Optional"
          autoCapitalize="characters"
        />
      </Card>

      <View style={{ height: space.xl }} />

      <Toggle
        label="On hold"
        hint="Shown in red at the gate before anything comes off the vehicle. Takes effect immediately — there is no card to reissue."
        value={onHold}
        onValueChange={setOnHold}
      />
      {onHold ? (
        <Field
          label="Why"
          value={holdReason}
          onChangeText={setHoldReason}
          placeholder="Failed temperature three deliveries running"
          autoCapitalize="sentences"
        />
      ) : null}

      <Toggle
        label="In use"
        hint="Turn off rather than delete. Deleting would orphan every gate entry and receipt that names them."
        value={isActive}
        onValueChange={setIsActive}
      />

      {error ? <FieldError message={error} /> : null}
      {problems.map((msg) => (
        <FieldError key={msg} message={msg} />
      ))}
    </Dialog>
  );
}
