import type { SessionStorage } from "@golai/db";

/**
 * Web session storage, backed by localStorage.
 *
 * Wrapped in try/catch because localStorage throws rather than returning null in
 * private browsing and when a storage quota is exceeded. A signed-in user losing their
 * session is far better than the app failing to render at all.
 */
export function createSessionStorage(): SessionStorage {
  const available = (() => {
    try {
      const probe = "__golai_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  })();

  if (!available) {
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

  return {
    getItem: async (key) => window.localStorage.getItem(key),
    setItem: async (key, value) => {
      window.localStorage.setItem(key, value);
    },
    removeItem: async (key) => {
      window.localStorage.removeItem(key);
    },
  };
}
