import { createSessionStorage } from "./session-storage";

/**
 * A stable identity for this installation.
 *
 * Two consumers need it, both named in CLAUDE.md: Sentry events are tagged `device_id`
 * so a fleet problem separates from a single bad device, and number leasing (ADR 0005)
 * records which device a range was issued to so every gap in the series resolves to a
 * device and a shift. One identity serves both — two would make a Sentry report and a
 * lease about the same physical device look like two devices.
 *
 * Persistence rides the existing session-storage seam: durable localStorage on web,
 * in-memory on native. The native consequence is the same one `session-storage.ts`
 * already states for sessions — a fresh id per launch — and it is acceptable for
 * exactly as long as native is unshipped (Phase 9, ADR 0014).
 */

const KEY = "golai.device-id";

const storage = createSessionStorage();

let cached: string | null = null;
let pending: Promise<string> | null = null;

export function getDeviceId(): Promise<string> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;

  pending = (async () => {
    const existing = await storage.getItem(KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
    const minted = randomId();
    await storage.setItem(KEY, minted);
    cached = minted;
    return minted;
  })();

  return pending;
}

/**
 * `crypto.randomUUID` where the runtime has it — every browser this app ships to —
 * with a plain fallback for a Hermes build that might not. The id needs uniqueness
 * across a fleet of dozens of devices, not cryptographic strength.
 */
function randomId(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
