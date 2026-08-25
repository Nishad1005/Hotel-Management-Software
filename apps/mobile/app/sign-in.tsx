import { useState } from "react";
import { View } from "react-native";
import { AuthLayout } from "../components/auth-layout";
import { Card, Field, FieldError, Notice, PrimaryButton, Text } from "../components/ui";
import { useSession } from "../lib/session";
import { space, usePalette } from "../theme";

/** Both inputs declare themselves described by this one message. */
const SIGN_IN_ERROR_ID = "sign-in-error";

export default function SignIn() {
  const p = usePalette();
  const { signIn, configured } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Whether the form has been sent yet.
   *
   * The button used to be `disabled` whenever either field was empty — which is always
   * true on load, so the **first thing anybody ever saw was the disabled state**. Before
   * Stage A that rendered at 1.87:1 and read as a broken control; even legible, a form
   * whose only action is greyed out before you have touched it is telling you the wrong
   * thing.
   *
   * So the button is live from the start and the form answers on submit. Errors appear
   * only after an attempt, matching the gate capture screen: showing them while the form
   * is still blank reads as scolding somebody who has not done anything yet.
   */
  const [attempted, setAttempted] = useState(false);

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

  const missingEmail = email.trim().length === 0;
  const missingPassword = password.length === 0;
  const incomplete = missingEmail || missingPassword;

  async function submit() {
    setAttempted(true);
    setError(null);
    // Nothing is sent for a blank field — the two red borders below say what is wrong,
    // and a round trip to Supabase to be told "invalid credentials" would be a slower way
    // of saying something we already know.
    if (incomplete) return;

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

  /**
   * A rejected sign-in marks both fields and explains once.
   *
   * The message is about the pair — either could be the wrong one, and Supabase will not
   * say which — so putting it under each field would state one problem twice and imply
   * two. `invalid` draws the border; the single message sits above the button.
   */
  const rejected = error !== null && !incomplete;

  return (
    <AuthLayout
      footer={
        <Text role="caption" tone="muted" align="center" style={{ marginTop: space.xl }}>
          Accounts are created by an administrator.{"\n"}There is no public sign-up.
        </Text>
      }
    >
      <Card>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          returnKeyType="next"
          invalid={rejected}
          {...(rejected ? { describedBy: SIGN_IN_ERROR_ID } : {})}
          {...(attempted && missingEmail
            ? { error: "Enter the email address you sign in with." }
            : {})}
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          autoComplete="current-password"
          returnKeyType="go"
          // Enter submits. On a phone at the gate that saves reaching for the button
          // with the keyboard covering half the screen.
          onSubmitEditing={() => void submit()}
          invalid={rejected}
          {...(rejected ? { describedBy: SIGN_IN_ERROR_ID } : {})}
          {...(attempted && missingPassword ? { error: "Enter your password." } : {})}
        />

        {/*
          One message for a failure that implicates both inputs, and both inputs point at
          it. Supabase will not say which of the two was wrong and should not — but a red
          outline with nothing behind it is a state only a sighted user can perceive.
        */}
        {error ? (
          <View style={{ marginBottom: space.md }}>
            <FieldError message={error} id={SIGN_IN_ERROR_ID} />
          </View>
        ) : null}

        <PrimaryButton label="Sign in" onPress={() => void submit()} loading={busy} />
      </Card>
    </AuthLayout>
  );
}
