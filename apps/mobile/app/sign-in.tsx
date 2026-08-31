import { useState } from "react";
import { View } from "react-native";
import { AuthLayout } from "../components/auth-layout";
import { Card, Field, FieldError, Notice, PrimaryButton, Text } from "../components/ui";
import { useSession } from "../lib/session";
import { space, usePalette } from "../theme";

/** Both inputs declare themselves described by this one message. */
const SIGN_IN_ERROR_ID = "sign-in-error";

/**
 * Turn a rejection into a sentence, and never invent one.
 *
 * The previous version mapped a single known string and sent everything else to "Could not
 * reach PARGOLAI. Check the internet connection." That was wrong in the one case that
 * mattered: Supabase answered `phone_provider_disabled` — "Phone logins are disabled" — a
 * precise, actionable fact, and the screen replaced it with a guess about the network. The
 * person then checked their connection, found it fine, and had nowhere left to look.
 *
 * So: recognised codes get copy written for a storekeeper. Anything unrecognised shows what
 * the server actually said. An unfamiliar sentence a person can read out to whoever
 * administers the system beats a familiar one that is not true.
 */
function explain({ error, code }: { error: string | null; code: string | null }): string {
  if (code === "invalid_credentials") {
    return "Those details and that password do not match. Check both — and if the account is new, ask whoever set it up to finish activating it.";
  }
  if (code === "phone_provider_disabled") {
    return "Signing in with a mobile number is not switched on for this system yet. Use the email address on the account, or ask your administrator to enable phone sign-in.";
  }
  if (code === "email_provider_disabled") {
    return "Signing in with an email address is not switched on for this system. Use the mobile number on the account instead.";
  }
  if (code === "incomplete_phone" || code === "not_configured") return error ?? "";
  // Genuinely the network: supabase-js surfaces a thrown fetch as this, with no code.
  if (!code && /fetch|network|timeout/i.test(error ?? "")) {
    return "Could not reach PARGOLAI. Check the internet connection and try again.";
  }
  return (error ?? "Sign-in failed.") + " — show this to whoever administers the system.";
}

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
    if (result.error) setError(explain(result));
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
        {/*
          One field for both, because an account may have been created with either and the
          person signing in should not have to know which. `looksLikePhone` decides in
          `signIn`; the label just has to stop insisting on an email.

          `keyboardType` stays default rather than `email-address`: a numeric-leaning
          keypad would be wrong for half the users and the @-key wrong for the other half,
          and the plain keyboard has both.
        */}
        <Field
          label="Email or mobile number"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com  ·  +91…"
          textContentType="username"
          autoComplete="username"
          returnKeyType="next"
          invalid={rejected}
          {...(rejected ? { describedBy: SIGN_IN_ERROR_ID } : {})}
          {...(attempted && missingEmail
            ? { error: "Enter the email address or mobile number you sign in with." }
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
