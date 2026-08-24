import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Field, FieldError, Notice, PrimaryButton, Text } from "../components/ui";
import { useSession } from "../lib/session";
import { radius, space, usePalette } from "../theme";

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
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
      keyboardShouldPersistTaps="handled"
    >
      {/*
        A full-width band of the product's own colour, with the form on the page
        beneath it. Colour blocking rather than a shadow: this is a flat design, and a
        contrasting section does the work an elevation would have done — it gives the
        screen a top edge and somewhere for the identity to live, instead of a logo
        floating in the middle of an empty page.
      */}
      <View
        style={{
          // p.brand, not p.primary. `primary` is a FOREGROUND colour and flips to a
          // near-white in dark mode, so using it as a background produced a pale band
          // across a near-black page with a hard seam through the middle.
          backgroundColor: p.brand,
          paddingTop: insets.top + space.xxxl,
          paddingBottom: space.xxxl + space.xl,
          paddingHorizontal: space.xl,
          alignItems: "center",
        }}
      >
        <View
          style={{
            width: 58,
            height: 58,
            borderRadius: radius.lg,
            backgroundColor: p.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="cube" size={29} color={p.onAccent} />
        </View>
        <Text role="display" tone="onBrand" style={{ marginTop: space.lg }}>
          Golai
        </Text>
        <Text role="label" tone="onBrandMuted" weight="medium" style={{ marginTop: space.xxs }}>
          Quantity. Movement. Accountability.
        </Text>
      </View>

      <View
        style={{
          width: "100%",
          maxWidth: 400,
          alignSelf: "center",
          paddingHorizontal: space.xl,
          paddingBottom: space.xxl,
          // Lifts the card over the band's lower edge, so the two sections read as one
          // composition rather than two stacked blocks.
          marginTop: -space.xxl,
        }}
      >
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

        <Text role="caption" tone="muted" align="center" style={{ marginTop: space.xl }}>
          Accounts are created by an administrator.{"\n"}There is no public sign-up.
        </Text>
      </View>
    </ScrollView>
  );
}
