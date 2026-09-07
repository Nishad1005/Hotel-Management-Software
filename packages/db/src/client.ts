import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { withClockSkewRetry } from "./clock-skew";
import type { Database } from "./types";

export type GolaiClient = SupabaseClient<Database>;

/**
 * Where the session is kept. Supplied by the app rather than chosen here, because it
 * is a platform decision — localStorage on web, async storage on native — and this
 * package must not import from either platform.
 */
export interface SessionStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

export interface ClientOptions {
  url: string;
  anonKey: string;
  storage?: SessionStorage;
  /** Overridable so a test can drive the transport. Defaults to the platform's fetch. */
  fetch?: typeof fetch;
}

/**
 * Builds the client.
 *
 * The anon key is public by design: it identifies the project, and every row it can
 * reach is governed by RLS. It is not a secret and belongs in the bundle. The service
 * role key is a different matter entirely and must never appear in this package —
 * CLAUDE.md rule 3, and the reason cross-tenant leaks happen in Supabase apps.
 *
 * URL and key come from the environment, never hardcoded, so a dedicated deployment
 * for one hotel group is a configuration change rather than a code change
 * (CLAUDE.md rule 5).
 */
export function createGolaiClient(options: ClientOptions): GolaiClient {
  if (!options.url || !options.anonKey) {
    throw new Error(
      "Supabase URL and anon key are required. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const baseFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  return createClient<Database>(options.url, options.anonKey, {
    auth: {
      ...(options.storage ? { storage: options.storage } : {}),
      persistSession: true,
      autoRefreshToken: true,
      // There is no browser redirect flow here; sessions come from password sign-in.
      detectSessionInUrl: false,
    },
    global: {
      /*
        Every request goes through the clock-skew retry.

        It has to sit here rather than around individual calls, because the call it was
        found breaking is the membership bootstrap — the one that decides whether the
        app has a property at all. Wrapping callers one at a time would mean
        remembering to wrap the next one. See clock-skew.ts for why replaying is safe.
      */
      fetch: withClockSkewRetry(baseFetch),
    },
  });
}

/**
 * Thrown when a write succeeded at the protocol level but changed nothing.
 *
 * RLS refuses INSERT by raising, but refuses UPDATE and DELETE silently: the rows are
 * simply invisible to the statement, so it reports success having done nothing. Table
 * privileges belong to the `authenticated` database role and cannot tell an
 * administrator from a storekeeper — only policies can, and policy denial on update is
 * quiet. CLAUDE.md rule 4b.
 */
export class WriteDeniedError extends Error {
  readonly table: string;

  constructor(table: string) {
    super(
      `Write to ${table} affected no rows. This is how row level security refuses an ` +
        `update: the rows are not visible to you. Check your role at this property.`,
    );
    this.name = "WriteDeniedError";
    this.table = table;
  }
}

/**
 * Wraps an update or delete so a silent refusal becomes a loud one.
 *
 * Use this for every mutation that is not an insert. An insert raises on its own; an
 * update does not, and treating "zero rows" as success is how a storekeeper's rejected
 * edit would appear to have worked.
 */
export function assertAffected<T>(table: string, rows: T[] | null): T[] {
  if (!rows || rows.length === 0) throw new WriteDeniedError(table);
  return rows;
}
