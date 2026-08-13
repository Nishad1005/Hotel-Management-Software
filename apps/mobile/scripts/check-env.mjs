/**
 * Refuse to build a bundle that cannot talk to Supabase.
 *
 * EXPO_PUBLIC_* values are inlined by Metro at export time, so a wrong value produces
 * a build that succeeds, deploys cleanly, and then shows "Not configured" on the
 * sign-in screen with nothing to explain why. That is the worst kind of failure: green
 * everywhere, broken only in front of whoever you were showing it to.
 *
 * It happened. Cloudflare's build variables were set to the string
 * "apps/mobile/.env.local" — the path to the file the values live in, rather than the
 * values themselves. Nothing in the pipeline noticed.
 *
 * The rule is deliberately asymmetric:
 *
 *   unset      -> warn, and carry on. CI builds the app to prove it bundles, and has
 *                 no reason to hold Supabase credentials. Failing there would force a
 *                 secret into CI for no benefit.
 *   set, wrong -> fail. Somebody meant to configure this and got it wrong, and that is
 *                 exactly the case worth catching.
 */

const URL_VAR = "EXPO_PUBLIC_SUPABASE_URL";
const KEY_VAR = "EXPO_PUBLIC_SUPABASE_ANON_KEY";

/**
 * This runs before `expo export`, so it does not inherit the .env files Expo reads for
 * itself. Without loading them, every local build would print the "not set" warning
 * while being perfectly configured — and a warning that is usually wrong is a warning
 * everyone learns to scroll past.
 *
 * On Cloudflare there is no .env file and the values arrive as real environment
 * variables, so this is a no-op there. Either way process.env wins: a real variable is
 * a deliberate override of a file.
 */
if (!process.env[URL_VAR] || !process.env[KEY_VAR]) {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Absent, unreadable, or a Node without loadEnvFile. None is worth failing over.
    }
  }
}

const url = process.env[URL_VAR];
const key = process.env[KEY_VAR];

const problems = [];

if (url !== undefined && url.trim() !== "") {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url.trim())) {
    problems.push(
      `${URL_VAR} is "${url}".\n` +
        `    Expected something like https://abcdefghijkl.supabase.co\n` +
        `    Supabase dashboard -> Project Settings -> Data API -> Project URL`,
    );
  }
}

if (key !== undefined && key.trim() !== "") {
  const trimmed = key.trim();
  // Supabase anon keys are JWTs: three base64url segments separated by dots. The
  // length floor catches a truncated paste, which looks plausible and is not.
  const looksLikeJwt = trimmed.split(".").length === 3 && trimmed.length > 100;
  if (!looksLikeJwt) {
    const shown = trimmed.length > 24 ? `${trimmed.slice(0, 12)}... (${trimmed.length} chars)` : trimmed;
    problems.push(
      `${KEY_VAR} is "${shown}".\n` +
        `    Expected a JWT: three dot-separated segments, a couple of hundred characters.\n` +
        `    Supabase dashboard -> Project Settings -> API Keys -> anon / public`,
    );
  }
}

if (problems.length > 0) {
  console.error("\n  Build stopped: the Supabase configuration is set but not usable.\n");
  for (const problem of problems) console.error(`  - ${problem}\n`);
  console.error(
    "  These are read at BUILD time and baked into the bundle, so a wrong value here\n" +
      "  ships an app that loads and then cannot sign anybody in.\n\n" +
      "  On Cloudflare these are the build variables, not the Worker's runtime\n" +
      "  variables — a static-asset Worker never reads its own vars.\n",
  );
  process.exit(1);
}

if (!url || !key) {
  console.warn(
    `\n  ${URL_VAR} / ${KEY_VAR} not set — building an app that cannot reach Supabase.\n` +
      "  Fine for a bundle check in CI. Not fine for anything anyone is meant to use.\n",
  );
}
