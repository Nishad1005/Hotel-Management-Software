import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Field, Notice, PrimaryButton } from "../components/ui";
import { useSession } from "../lib/session";
import { space, type, usePalette } from "../theme";

/**
 * Sign in.
 *
 * Accounts are provisioned, never self-served (ADR 0010), so there is no sign-up link
 * and no password reset yet — a password reset needs SMTP configured, and offering a
 * link that silently does nothing is worse than not offering one.
 */
export default function SignIn() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { signIn, configured } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!configured) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background, justifyContent: "center" }}>
        <Notice
          icon="construct-outline"
          tone="bad"
          title="Not configured"
          body={
            "Copy apps/mobile/.env.example to .env.local and fill in the Supabase URL and anon key, " +
            "then restart the dev server. Expo reads these at build time, so a running server will " +
            "not pick them up."
          }
        />
      </View>
    );
  }

  async function submit() {
    setError(null);
    setBusy(true);
    const result = await signIn(email, password);
    setBusy(false);
    if (result.error) {
      // Supabase returns "Invalid login credentials" for a wrong password AND for an
      // unconfirmed account, which sends people hunting for a typo that is not there.
      setError(
        result.error === "Invalid login credentials"
          ? "Wrong email or password — or the account has not been confirmed. An administrator can confirm it under Authentication."
          : result.error,
      );
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: p.background }}
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: insets.top + space.xxl,
        flexGrow: 1,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ fontSize: type.display, fontWeight: "800", color: p.text }}>Golai</Text>
      <Text style={{ fontSize: type.label, color: p.textMuted, marginBottom: space.xl }}>
        Quantity. Movement. Accountability.
      </Text>

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
      />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />

      {error ? (
        <View style={{ marginBottom: space.md }}>
          <Text style={{ color: p.danger, fontSize: type.label, lineHeight: 21 }}>{error}</Text>
        </View>
      ) : null}

      <PrimaryButton
        label={busy ? "Signing in…" : "Sign in"}
        icon="log-in-outline"
        onPress={submit}
        disabled={busy || email.trim().length === 0 || password.length === 0}
      />

      <Text
        style={{
          fontSize: type.caption,
          color: p.textMuted,
          marginTop: space.xl,
          lineHeight: 19,
        }}
      >
        Accounts are created by an administrator. There is no public sign-up.
      </Text>
    </ScrollView>
  );
}
