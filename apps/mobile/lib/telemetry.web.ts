import * as Sentry from "@sentry/browser";
import Constants from "expo-constants";
import { getDeviceId } from "./device";

/**
 * Error tracking, so the pilot does not run blind. Web half of the seam.
 *
 * Sentry has been named in the stack (CLAUDE.md) since the beginning and installed in
 * nothing — which meant a client-side failure at the dock would surface as a phone call,
 * or not at all. A pilot's first weeks are exactly when the unknown failures happen, and
 * "the storekeeper said it froze yesterday" is not a bug report anyone can act on.
 *
 * This is `@sentry/browser`, not `@sentry/react-native`, and that is a considered swap
 * rather than a shortcut. The react-native SDK on web disables its native layer and
 * delegates to exactly these browser integrations (verified in its source) — but it
 * drags in `@sentry/cli` with seven per-platform ~9MB binaries whose downloads this
 * machine's antivirus kills mid-body, breaking `pnpm install` outright. The pilot ships
 * to browsers; the browser SDK is the whole of what runs there. When native builds
 * arrive (Phase 9, ADR 0014), the react-native SDK lands in `telemetry.ts` the same way
 * the camera and printing already split across this seam.
 *
 * The DSN is an `EXPO_PUBLIC_*` build variable like the Supabase pair — inlined by Metro
 * at export time, set in Cloudflare's build environment, absent locally. Absent means
 * telemetry is off and every function here is a deliberate no-op: a dev machine should
 * not be filing events, and a build must never fail for lack of a DSN.
 *
 * Errors only for the pilot — `tracesSampleRate` stays 0. Performance tracing is volume
 * and cost with nobody yet asking the questions it answers.
 */

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN ?? "";

export const telemetryEnabled = dsn.length > 0;

export function initTelemetry(): void {
  if (!telemetryEnabled) return;

  Sentry.init({
    dsn,
    tracesSampleRate: 0,
  });

  Sentry.setTag("app_version", Constants.expoConfig?.version ?? "unknown");
  // Async by nature; the first events of a session may precede it, and that is fine —
  // a missing device tag on the first event beats holding initialisation for storage.
  void getDeviceId().then((id) => Sentry.setTag("device_id", id));
}

/**
 * Who and where, once the session knows.
 *
 * `org_id` / `property_id` are the tags CLAUDE.md specifies, and they are what turns
 * "an error happened" into "an error happened at Vivanta" — which during a multi-tenant
 * pilot is the difference between a fix tonight and a support call tomorrow.
 */
export function setTelemetryTags(tags: {
  orgId: string | null;
  propertyId: string | null;
  propertyCode: string | null;
}): void {
  if (!telemetryEnabled) return;
  Sentry.setTag("org_id", tags.orgId ?? "none");
  Sentry.setTag("property_id", tags.propertyId ?? "none");
  Sentry.setTag("property_code", tags.propertyCode ?? "none");
}

/**
 * An error worth a human's attention, with the context that makes it actionable.
 *
 * Callers pass real context — a record id, a capture type, a reason string — rather
 * than prose. The one non-negotiable rule: never put personal data (names, phone
 * numbers, photographs) in here. DPDP obligations attach to what we hold, and error
 * telemetry is the easiest place to hold it by accident.
 */
export function captureError(error: unknown, context?: Record<string, string | number>): void {
  if (!telemetryEnabled) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
