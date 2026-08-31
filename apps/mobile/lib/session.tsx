import type { MembershipRole } from "@golai/db";
import { looksLikePhone, normalisePhone } from "@golai/domain";
import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { amIPlatformAdmin } from "./platform";
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
  /** Takes an email address or a mobile number — whichever the account was made with. */
  signIn: (identifier: string, password: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  /** True when the active property allows editing master data. */
  canEditMasters: boolean;
  /**
   * Vendor staff, not a property's.
   *
   * Held here rather than asked per screen: it decides a section of the navigation and a
   * row on the home screen, and the home screen was asking on every focus. It is a fact
   * about the signed-in person, which is exactly what this context is for.
   */
  isPlatformAdmin: boolean;
}

/**
 * What went wrong, in the server's own words as well as ours.
 *
 * `code` is carried because the message is not a stable thing to branch on and, worse,
 * mapping only the codes we anticipated is how a precise server answer gets replaced by a
 * guess. Supabase said `phone_provider_disabled` — "Phone logins are disabled" — and the
 * screen told somebody to check their internet connection, which was both wrong and
 * unfalsifiable from where they were standing.
 */
export interface SignInResult {
  error: string | null;
  /** Supabase's own error code, where it gave one. */
  code: string | null;
}

const SessionContext = createContext<SessionState | null>(null);

const EDIT_ROLES: MembershipRole[] = ["OWNER", "ADMIN"];

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [properties, setProperties] = useState<PropertyAccess[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  /** Whether a session was already in hand, so a refresh is not mistaken for a sign-in. */
  const hadSession = useRef(false);

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
      if (next) {
        /*
          A session arriving where there was none — a successful sign-in. Memberships are
          not known yet, so the guard has to hold rather than send somebody to the property
          chooser for the moment it takes to find out they have one property.

          Guarded on the *transition*, not on `next` being truthy: this callback also fires
          for a token refresh mid-shift, and raising `loading` there would black out the app
          with a spinner while somebody is halfway through receiving a delivery.
        */
        if (!hadSession.current) setLoading(true);
        hadSession.current = true;
      } else {
        hadSession.current = false;
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

  // Vendor staff, asked once per session rather than on every focus of the home screen.
  // Deliberately not gated on `loading`: it decides a navigation section, not whether the
  // app renders, so it is allowed to arrive a moment late and add a section.
  useEffect(() => {
    if (!supabase || !session) {
      setIsPlatformAdmin(false);
      return;
    }
    let alive = true;
    void amIPlatformAdmin().then((yes) => {
      if (alive) setIsPlatformAdmin(yes);
    });
    return () => {
      alive = false;
    };
  }, [session]);

  /**
   * `loading` is "we do not yet know who you are", not "a request is in flight".
   *
   * This used to raise `loading` for the duration of the sign-in call, and the guard in
   * `app/_layout.tsx` renders a spinner *instead of the navigator* whenever `loading` is
   * true. So pressing Sign in unmounted the sign-in screen, and settling the request
   * mounted a brand new one — with blank fields and no error, because `setError` had
   * written to a component that no longer existed.
   *
   * The visible failure was that a wrong password did nothing at all: no message, no
   * marked fields, the typed email gone. The validation branch appeared to work only
   * because it returns before this call, so `loading` never moved.
   *
   * The button has its own `busy` state for the in-flight case. This flag belongs to
   * session resolution alone.
   *
   * ## Either identifier, because accounts are created with either
   *
   * `provision-tenant` and `create-user` both accept an email *or* a mobile number and
   * mint the account accordingly — so an owner can exist whose only credential is a phone.
   * This function only ever called `signInWithPassword({ email })`, which meant those
   * accounts could be created and then could not log in: the number went to Supabase as an
   * email address and came back "Invalid login credentials", which is indistinguishable
   * from a wrong password to the person holding the temporary one they were just given.
   *
   * `looksLikePhone` and `normalisePhone` already existed in `@golai/domain`, tested, with
   * a doc comment describing this exact decision. Nothing had imported them.
   *
   * Supabase wants E.164 with the leading plus for the phone grant, which is what
   * `normalisePhone` returns and what the edge functions store.
   */
  const signIn = useCallback(async (identifier: string, password: string) => {
    if (!supabase) return { error: "Supabase is not configured.", code: "not_configured" };

    if (looksLikePhone(identifier)) {
      const phone = normalisePhone(identifier);
      // Refused rather than guessed: a mangled number produces a rejection that reads as
      // a wrong password, and the person retypes the password instead of the number.
      if (!phone) {
        return {
          error:
            "That does not look like a complete mobile number. Include the country code, or use the email address instead.",
          code: "incomplete_phone",
        };
      }
      const { error } = await supabase.auth.signInWithPassword({ phone, password });
      return { error: error ? error.message : null, code: error?.code ?? null };
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: identifier.trim().toLowerCase(),
      password,
    });
    return { error: error ? error.message : null, code: error?.code ?? null };
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
    isPlatformAdmin,
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
