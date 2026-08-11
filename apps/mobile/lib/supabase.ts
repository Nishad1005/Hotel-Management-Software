import { createGolaiClient } from "@golai/db";
import { createSessionStorage } from "./session-storage";

/**
 * The app's Supabase client.
 *
 * URL and key come from EXPO_PUBLIC_ variables, which Expo inlines into the bundle at
 * build time. Both are public by design: the URL names the project, and the anon key
 * only ever reaches rows row level security already permits. The service_role key —
 * which bypasses RLS entirely — must never appear anywhere in this app.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * Whether the app is configured at all.
 *
 * Checked rather than assumed so a missing .env.local produces a screen that says so,
 * instead of a login form that fails with an opaque network error. Setup mistakes
 * should be legible.
 */
export const isConfigured = url.length > 0 && anonKey.length > 0;

export const supabase = isConfigured
  ? createGolaiClient({ url, anonKey, storage: createSessionStorage() })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Copy apps/mobile/.env.example to .env.local and fill in the two values.",
    );
  }
  return supabase;
}
