import { Ionicons } from "@expo/vector-icons";
import { GOLAI_ROLES, looksLikePhone } from "@golai/domain";
import type { MembershipRole } from "@golai/db";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  Card,
  Field,
  FieldError,
  Notice,
  PrimaryButton,
  Screen,
  Section,
  SelectRow,
  StatusPill,
} from "../../components/ui";
import { useSession } from "../../lib/session";
import { createUser, listTeam, type CreatedUser, type TeamMember } from "../../lib/users";
import { font, radius, space, type, usePalette } from "../../theme";

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
            <Text
              style={{
                fontSize: type.body,
                ...font("bold"),
                color: p.accent,
                marginLeft: space.sm,
              }}
            >
              {created.fullName} can now sign in
            </Text>
          </View>

          <Text style={{ fontSize: type.caption, color: p.textMuted, marginBottom: space.xs }}>
            They sign in with
          </Text>
          <Text
            selectable
            style={{
              fontSize: type.subheading,
              ...font("semibold"),
              color: p.text,
              marginBottom: space.md,
            }}
          >
            {created.loginId}
          </Text>

          <Text style={{ fontSize: type.caption, color: p.textMuted, marginBottom: space.xs }}>
            Temporary password — read it out now
          </Text>
          <Text
            selectable
            style={{
              fontSize: type.title,
              ...font("heavy"),
              color: p.text,
              letterSpacing: 0.5,
            }}
          >
            {created.tempPassword}
          </Text>

          <Text
            style={{
              fontSize: type.caption,
              color: p.textMuted,
              marginTop: space.md,
              lineHeight: 18,
            }}
          >
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
          <ActivityIndicator style={{ marginTop: space.xl }} color={p.accent} />
        ) : team.length === 0 ? (
          <Notice
            icon="people-outline"
            title="Nobody yet"
            body="Add the storekeeper and the security officer as separate people. If they share one login, the gate entry and the goods receipt are written by the same account, and the check between them stops meaning anything."
          />
        ) : (
          <Card padded={false}>
            {team.map((member, index) => (
              <View
                key={member.userId}
                style={{
                  paddingHorizontal: space.lg,
                  paddingVertical: space.md,
                  borderBottomWidth: index < team.length - 1 ? StyleSheet.hairlineWidth : 0,
                  borderBottomColor: p.border,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text
                    style={{ fontSize: type.body, ...font("semibold"), color: p.text, flex: 1 }}
                    numberOfLines={1}
                  >
                    {member.fullName}
                    {member.isSelf ? (
                      <Text style={{ color: p.textFaint, ...font("regular") }}> · you</Text>
                    ) : null}
                  </Text>
                </View>
                <Text
                  style={{ fontSize: type.caption, color: p.textMuted, marginTop: 1 }}
                  numberOfLines={1}
                >
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
                    <StatusPill
                      key={r}
                      label={ROLE_LABEL[r]}
                      tone={r === "SECURITY" ? "warn" : "neutral"}
                    />
                  ))}
                </View>
              </View>
            ))}
          </Card>
        )}
      </Section>
    </Screen>
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
