import type { MembershipRole } from "@golai/db";
import { requireSupabase } from "./supabase";

/**
 * The team, and adding to it.
 *
 * Creating a login goes through an edge function rather than the client, because it
 * needs the service-role key to mint an auth user — and that key must never reach a
 * browser. Everything else is an ordinary RPC under the caller's own authority.
 */

export interface TeamMember {
  userId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  roles: MembershipRole[];
  isSelf: boolean;
}

export async function listTeam(propertyId: string): Promise<TeamMember[]> {
  const { data, error } = await requireSupabase().rpc("list_team", {
    p_property_id: propertyId,
  });

  if (error) throw new Error(friendly(error.code, error.message));

  return (data ?? []).map((row) => ({
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    roles: row.roles,
    isSelf: row.is_self,
  }));
}

export interface NewUser {
  propertyId: string;
  fullName: string;
  role: MembershipRole;
  email?: string;
  phone?: string;
  password?: string;
}

export interface CreatedUser {
  fullName: string;
  role: MembershipRole;
  /** What they type to sign in — their mobile number, or their email. */
  loginId: string;
  /**
   * Shown once and never stored anywhere. If it is lost the administrator resets it
   * rather than looking it up, because there is nowhere to look.
   */
  tempPassword: string;
}

export async function createUser(input: NewUser): Promise<CreatedUser> {
  const client = requireSupabase();

  // The caller's own session is forwarded, because the function checks authority as
  // them rather than trusting whoever invoked it.
  const { data, error } = await client.functions.invoke("create-user", {
    body: {
      property_id: input.propertyId,
      full_name: input.fullName,
      role: input.role,
      email: input.email ?? null,
      phone: input.phone ?? null,
      password: input.password ?? null,
    },
  });

  if (error) {
    // An edge function's non-2xx body carries the useful message; the thrown error only
    // says "non-2xx status code", which tells a user nothing they can act on.
    const detail = await readFunctionError(error);
    throw new Error(detail ?? error.message);
  }
  if (data?.error) throw new Error(data.error);

  return {
    fullName: data.full_name,
    role: data.role,
    loginId: data.login_id,
    tempPassword: data.temp_password,
  };
}

export async function grantRole(
  propertyId: string,
  userId: string,
  role: MembershipRole,
): Promise<void> {
  const { error } = await requireSupabase().rpc("grant_role", {
    p_property_id: propertyId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw new Error(friendly(error.code, error.message));
}

export async function revokeRole(
  propertyId: string,
  userId: string,
  role: MembershipRole,
): Promise<void> {
  const { error } = await requireSupabase().rpc("revoke_role", {
    p_property_id: propertyId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw new Error(friendly(error.code, error.message));
}

/** supabase-js hides the response body on a FunctionsHttpError; this digs it back out. */
async function readFunctionError(error: unknown): Promise<string | null> {
  const context = (error as { context?: { json?: () => Promise<{ error?: string }> } })?.context;
  if (!context?.json) return null;
  try {
    const body = await context.json();
    return body?.error ?? null;
  } catch {
    return null;
  }
}

function friendly(code: string | undefined, message: string): string {
  if (code === "42501") return "You do not have permission to manage users at this property.";
  return message;
}
