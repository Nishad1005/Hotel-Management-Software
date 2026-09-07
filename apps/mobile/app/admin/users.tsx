import { Ionicons } from "@expo/vector-icons";
import { GOLAI_ROLES, looksLikePhone, moduleLabel } from "@golai/domain";
import type { MembershipRole } from "@golai/db";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import {
  Card,
  Dialog,
  Field,
  FieldError,
  Loading,
  Notice,
  PrimaryButton,
  Screen,
  Section,
  SelectRow,
  SkeletonList,
  StatusPill,
  Text,
  Toggle,
} from "../../components/ui";
import { listMemberModules, setMemberModule, type MemberModule } from "../../lib/modules";
import { useSession } from "../../lib/session";
import { createUser, listTeam, type CreatedUser, type TeamMember } from "../../lib/users";
import { radius, space, usePalette } from "../../theme";

/**
 * Who works here, and adding somebody.
 *
 * This screen is why the pilot can run at all. Without it the only way to add a person
 * is the Supabase dashboard, which in practice means one shared login — and a shared
 * login collapses the separation between Security and the storekeeper that the whole
 * reconciliation control depends on.
 *
 * No email is ever sent. The password appears once, on screen, for the administrator to
 * read out. That is not a shortcut: floor staff mostly have no email address, and
 * requiring one is precisely how a shared account gets invented.
 */
export default function Users() {
  const p = usePalette();
  const router = useRouter();
  const { activeProperty, canEditMasters } = useSession();

  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedUser | null>(null);
  const [editingAccess, setEditingAccess] = useState<TeamMember | null>(null);

  const [fullName, setFullName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<MembershipRole>("STOREKEEPER");

  const load = useCallback(async () => {
    if (!activeProperty) return;
    setLoading(true);
    try {
      setTeam(await listTeam(activeProperty.propertyId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activeProperty]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // One field for both, decided by shape. Asking somebody to choose "email or mobile"
  // before typing is a decision the input can make for them.
  const asPhone = looksLikePhone(identifier);
  const ready = fullName.trim().length > 0 && identifier.trim().length > 0;

  async function add() {
    if (!activeProperty || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createUser({
        propertyId: activeProperty.propertyId,
        fullName: fullName.trim(),
        role,
        ...(asPhone ? { phone: identifier.trim() } : { email: identifier.trim() }),
      });
      setCreated(result);
      setFullName("");
      setIdentifier("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      onSubmit={() => void add()}
      title="People"
      subtitle="Who works here, and what they may do"
      onBack={() => router.back()}
    >
      {/*
            The password is shown once and stored nowhere, so this panel stays until it
            is dismissed deliberately — navigating away by accident and losing it means
            resetting the account.
          */}
      {created ? (
        <View
          style={{
            backgroundColor: p.accentSurface,
            borderRadius: radius.lg,
            padding: space.lg,
            marginBottom: space.xl,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.md }}>
            <Ionicons name="key" size={18} color={p.accent} />
            <Text tone="accent" weight="bold" style={{ marginLeft: space.sm }}>
              {created.fullName} can now sign in
            </Text>
          </View>

          <Text role="caption" tone="muted" style={{ marginBottom: space.xs }}>
            They sign in with
          </Text>
          <Text selectable role="heading" style={{ marginBottom: space.md }}>
            {created.loginId}
          </Text>

          <Text role="caption" tone="muted" style={{ marginBottom: space.xs }}>
            Temporary password — read it out now
          </Text>
          <Text selectable role="title" weight="heavy">
            {created.tempPassword}
          </Text>

          <Text role="caption" tone="muted" style={{ marginTop: space.md }}>
            This is shown once and is not stored anywhere. If it is lost, set a new one rather than
            looking it up.
          </Text>

          <View style={{ marginTop: space.lg }}>
            <PrimaryButton
              label="I have handed it over"
              tone="neutral"
              onPress={() => setCreated(null)}
            />
          </View>
        </View>
      ) : null}

      {error ? (
        <View style={{ marginBottom: space.lg }}>
          <FieldError message={error} />
        </View>
      ) : null}

      {canEditMasters ? (
        <Section title="Add somebody">
          <Card>
            <Field
              label="Full name"
              value={fullName}
              onChangeText={setFullName}
              placeholder="Ravi Bora"
            />
            <Field
              label="Email or mobile number"
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="9829012345"
              autoCapitalize="none"
              hint={
                identifier.trim().length === 0
                  ? "Either will do. Most floor staff have no email address."
                  : asPhone
                    ? "Read as a mobile number — they will sign in with it."
                    : "Read as an email address."
              }
            />
            <SelectRow
              label="Role"
              value={role}
              placeholder="Choose a role"
              choices={GOLAI_ROLES.map((r) => ({
                id: r,
                label: ROLE_LABEL[r],
                sublabel: ROLE_BLURB[r],
              }))}
              onSelect={(next) => setRole(next as MembershipRole)}
            />
            <PrimaryButton
              label={busy ? "Creating…" : "Create login"}
              icon="person-add"
              onPress={() => void add()}
              disabled={busy || !ready}
            />
          </Card>
        </Section>
      ) : null}

      <Section title={loading ? "The team" : `The team · ${team.length}`}>
        {loading ? (
          <SkeletonList rows={3} />
        ) : team.length === 0 ? (
          <Notice
            icon="people-outline"
            title="Nobody yet"
            body="Add the storekeeper and the security officer as separate people. If they share one login, the gate entry and the goods receipt are written by the same account, and the check between them stops meaning anything."
          />
        ) : (
          <Card padded={false}>
            {team.map((member, index) => (
              <MemberRow
                key={member.userId}
                member={member}
                divider={index < team.length - 1}
                onPress={
                  canEditMasters && !member.isSelf ? () => setEditingAccess(member) : undefined
                }
              />
            ))}
          </Card>
        )}
      </Section>

      <AccessDialog
        member={editingAccess}
        propertyId={activeProperty?.propertyId ?? null}
        onClose={() => setEditingAccess(null)}
      />
    </Screen>
  );
}

function MemberRow({
  member,
  divider,
  onPress,
}: {
  member: TeamMember;
  divider: boolean;
  onPress?: (() => void) | undefined;
}) {
  const p = usePalette();

  const body = (
    <>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text lines={1} weight="semibold" style={{ flex: 1 }}>
          {member.fullName}
          {member.isSelf ? (
            <Text role="caption" tone="muted">
              {" "}
              · you
            </Text>
          ) : null}
        </Text>
        {onPress ? <Ionicons name="chevron-forward" size={18} color={p.textFaint} /> : null}
      </View>
      <Text lines={1} role="caption" tone="muted" style={{ marginTop: 1 }}>
        {member.phone ?? member.email ?? "No sign-in identifier"}
      </Text>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: space.xs,
          marginTop: space.sm,
        }}
      >
        {member.roles.map((r) => (
          <StatusPill key={r} label={ROLE_LABEL[r]} tone={r === "SECURITY" ? "warn" : "neutral"} />
        ))}
      </View>
    </>
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
      accessibilityLabel={`Change what ${member.fullName} can reach`}
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

/**
 * What one person may reach.
 *
 * Narrowing only, and the dialog says so. A switch that is off takes a module away; a
 * switch that is on means "not restricted", which is not the same as granted — their
 * role still has to carry the job, and the server checks that separately. Offering a
 * toggle that appeared to grant something it could not is how golaiv1 ended up showing
 * people screens that then refused them.
 *
 * A module the property does not hold is shown off and cannot be switched on here: it
 * is not this administrator's to give.
 */
function AccessDialog({
  member,
  propertyId,
  onClose,
}: {
  member: TeamMember | null;
  propertyId: string | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<MemberModule[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!propertyId || !member) return;
    setLoading(true);
    try {
      const all = await listMemberModules(propertyId);
      setRows(all.filter((r) => r.userId === member.userId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId, member]);

  // Keyed on the subject rather than run in an effect: the dialog stays mounted, so an
  // effect would refetch on every render while the administrator is still deciding.
  if (member !== null && member.userId !== loadedFor) {
    setLoadedFor(member.userId);
    setRows([]);
    setError(null);
    void load();
  }

  async function change(row: MemberModule, next: boolean) {
    if (!propertyId || !member) return;
    setBusyKey(row.moduleKey);
    setError(null);
    try {
      // Switching back on clears the exception rather than writing `true`: their role
      // decides from then on, which is what "not restricted" actually means.
      await setMemberModule(propertyId, member.userId, row.moduleKey, next ? null : false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  const restricted = rows.filter((r) => r.isOverride && !r.allowed).length;

  return (
    <Dialog
      visible={member !== null}
      title={member ? `What ${member.fullName} can reach` : ""}
      onClose={onClose}
      footer={<PrimaryButton label="Done" icon="checkmark" onPress={onClose} />}
    >
      {member ? (
        <>
          <Text tone="muted" style={{ marginBottom: space.md }}>
            Switching one off takes it away from {member.fullName} alone. Switching it back on
            returns them to what their role carries — it does not grant anything extra.
          </Text>

          {loading ? (
            <Loading label="Reading their access" />
          ) : (
            <Card>
              {rows.map((row) => (
                <View key={row.moduleKey} style={{ opacity: busyKey === row.moduleKey ? 0.5 : 1 }}>
                  <Toggle
                    label={moduleLabel(row.moduleKey)}
                    hint={
                      row.isOverride && !row.allowed
                        ? "Switched off for them"
                        : row.allowed
                          ? "On, from their role"
                          : "Their role does not carry this, or the property does not hold it"
                    }
                    value={row.allowed}
                    onValueChange={(next) => void change(row, next)}
                  />
                </View>
              ))}
            </Card>
          )}

          {restricted > 0 ? (
            <Text role="caption" tone="muted" style={{ marginTop: space.sm }}>
              {restricted} switched off for them specifically.
            </Text>
          ) : null}

          {error ? <FieldError message={error} /> : null}
        </>
      ) : null}
    </Dialog>
  );
}

const ROLE_LABEL: Record<MembershipRole, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  GM: "General Manager",
  SECURITY: "Security",
  STOREKEEPER: "Storekeeper",
  CHEF: "Chef",
  FSO: "Food Safety Officer",
  PURCHASE: "Purchase",
  BANQUET: "Banquet",
  AUDITOR: "Auditor",
};

/** What the role actually lets somebody do, in the words of the job rather than the code. */
const ROLE_BLURB: Record<MembershipRole, string> = {
  OWNER: "Everything, including other administrators",
  ADMIN: "Everything at this property",
  GM: "Overrides and enforcement, not the daily flow",
  SECURITY: "The gate only — arrivals in, goods out",
  STOREKEEPER: "Receiving, put-away, issuing",
  CHEF: "Signs off perishable quality",
  FSO: "Temperature and hygiene; can stop a batch",
  PURCHASE: "Variance approval and the vendor list",
  BANQUET: "Outdoor catering and returnables",
  AUDITOR: "Reads everything, changes nothing",
};
