import type { SessionStorage } from "@golai/db";

/**
 * Default session storage: in memory.
 *
 * Metro resolves `./session-storage.web` on web, where the real implementation lives.
 * Native has no persistent implementation yet — it needs AsyncStorage, and native
 * builds are Phase 9 under ADR 0014, so adding that dependency now would be carrying
 * weight for a platform we do not ship to.
 *
 * The consequence, stated plainly rather than discovered later: on native the session
 * does not survive a restart, so the user is asked to sign in again. That is
 * acceptable while native is unshipped and unacceptable the moment it is not.
 */
export function createSessionStorage(): SessionStorage {
  const memory = new Map<string, string>();
  return {
    getItem: async (key) => memory.get(key) ?? null,
    setItem: async (key, value) => {
      memory.set(key, value);
    },
    removeItem: async (key) => {
      memory.delete(key);
    },
  };
}
