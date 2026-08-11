import { MemoryOutboxStore, type OutboxStore } from "@golai/outbox";

/**
 * Default storage driver, and the reason the platform split works.
 *
 * Metro resolves `./outbox-store` to `outbox-store.web.ts` when bundling for web and
 * `outbox-store.native.ts` for iOS and Android, so neither platform's driver is ever
 * present in the other's bundle. That matters concretely: expo-sqlite imports a wasm
 * module the web bundler cannot resolve, and a runtime `if (Platform.OS === 'web')`
 * does not prevent it being bundled — the import is still statically reachable.
 *
 * This file is what TypeScript resolves, since tsc does not apply Metro's platform
 * extensions. All three exports share one signature, so typechecking here proves the
 * contract for the drivers it never sees.
 *
 * It is also the genuine fallback for any platform without a driver of its own.
 * In-memory means a queue lost on restart, which is bad — but a device that cannot
 * open its store must still let a guard record an arrival. Refusing to capture is
 * worse than capturing somewhere fragile.
 */
export function createOutboxStore(): OutboxStore {
  return new MemoryOutboxStore();
}
