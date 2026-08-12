import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Field, FieldError, Notice, PrimaryButton } from "../components/ui";
import { useSession } from "../lib/session";
import { font, radius, space, type, usePalette } from "../theme";

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
            "Copy apps/mobile/.env.example to .env.local, fill in the Supabase URL and anon key, " +
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
          ? "Wrong email or password — or the account has not been confirmed yet."
          : result.error,
      );
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: p.background }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        padding: space.xl,
        paddingTop: insets.top + space.xxl,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ width: "100%", maxWidth: 400, alignSelf: "center" }}>
        <View style={{ alignItems: "center", marginBottom: space.xxl }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: radius.lg,
              backgroundColor: p.accent,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="cube" size={28} color={p.onAccent} />
          </View>
          <Text
            style={{
              fontSize: type.display,
              ...font("heavy"),
              color: p.text,
              marginTop: space.lg,
              letterSpacing: -1,
            }}
          >
            Golai
          </Text>
          <Text style={{ fontSize: type.label, color: p.textMuted, marginTop: space.xxs }}>
            Quantity. Movement. Accountability.
          </Text>
        </View>

        <Card>
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
              <FieldError message={error} />
            </View>
          ) : null}

          <PrimaryButton
            label={busy ? "Signing in…" : "Sign in"}
            onPress={submit}
            disabled={busy || email.trim().length === 0 || password.length === 0}
          />
        </Card>

        <Text
          style={{
            fontSize: type.caption,
            color: p.textFaint,
            marginTop: space.xl,
            textAlign: "center",
            lineHeight: 18,
          }}
        >
          Accounts are created by an administrator.{"\n"}There is no public sign-up.
        </Text>
      </View>
    </ScrollView>
  );
}
