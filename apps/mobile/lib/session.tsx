import type { MembershipRole } from "@golai/db";
import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isConfigured, supabase } from "./supabase";

/**
 * Session, memberships, and which property the user is currently working in.
 *
 * The property is not a preference — it is the tenancy boundary. Every query is
 * scoped to it, so a user with access to several properties must choose one
 * explicitly rather than have the app guess. A wrong guess would silently show one
 * hotel's stock while the user believed they were looking at another's.
 */

export interface PropertyAccess {
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  organisationName: string;
  roles: MembershipRole[];
}

interface SessionState {
  loading: boolean;
  configured: boolean;
  session: Session | null;
  properties: PropertyAccess[];
  activeProperty: PropertyAccess | null;
  setActiveProperty: (propertyId: string) => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** True when the active property allows editing master data. */
  canEditMasters: boolean;
}

const SessionContext = createContext<SessionState | null>(null);

const EDIT_ROLES: MembershipRole[] = ["OWNER", "ADMIN"];

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [properties, setProperties] = useState<PropertyAccess[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let alive = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setProperties([]);
        setActiveId(null);
        setLoading(false);
      }
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Memberships resolve the properties this user may see. RLS would filter them
  // anyway, but the app needs the list to offer a choice and to label the header.
  useEffect(() => {
    if (!supabase || !session) return;
    let alive = true;

    void (async () => {
      const { data, error } = await supabase
        .from("membership")
        .select(
          "role, property_id, property:property_id(id, code, name, organisation:org_id(name))",
        )
        .not("property_id", "is", null);

      if (!alive) return;

      if (error) {
        // An empty app is confusing; a stated failure is not.
        console.warn("Could not load memberships:", error.message);
        setProperties([]);
        setLoading(false);
        return;
      }

      const byProperty = new Map<string, PropertyAccess>();
      for (const row of (data ?? []) as unknown as MembershipJoin[]) {
        const p = row.property;
        if (!p) continue;
        const existing = byProperty.get(p.id);
        if (existing) existing.roles.push(row.role);
        else
          byProperty.set(p.id, {
            propertyId: p.id,
            propertyCode: p.code,
            propertyName: p.name,
            organisationName: p.organisation?.name ?? "",
            roles: [row.role],
          });
      }

      const list = [...byProperty.values()].sort((a, b) =>
        a.propertyCode.localeCompare(b.propertyCode),
      );
      setProperties(list);
      // Only auto-select when there is genuinely no choice to make.
      setActiveId(
        (current) => current ?? (list.length === 1 ? (list[0]?.propertyId ?? null) : null),
      );
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [session]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: "Supabase is not configured." };
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      setLoading(false);
      return { error: error.message };
    }
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  const activeProperty = useMemo(
    () => properties.find((p) => p.propertyId === activeId) ?? null,
    [properties, activeId],
  );

  const value: SessionState = {
    loading,
    configured: isConfigured,
    session,
    properties,
    activeProperty,
    setActiveProperty: setActiveId,
    signIn,
    signOut,
    canEditMasters: (activeProperty?.roles ?? []).some((r) => EDIT_ROLES.includes(r)),
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside a SessionProvider");
  return ctx;
}

interface MembershipJoin {
  role: MembershipRole;
  property: {
    id: string;
    code: string;
    name: string;
    organisation: { name: string } | null;
  } | null;
}
