import type { ModuleKey } from "@golai/db";
import { requireSupabase } from "./supabase";

/**
 * Reading and setting module access.
 *
 * Two audiences with two functions each, and they are deliberately not shared: what a
 * customer holds is ours to decide, and who inside that customer may open it is theirs.
 * The database enforces that split — the platform pair refuses anyone who is not
 * platform staff, the member pair refuses anyone who is not an administrator at that
 * property, and neither of them will let a caller edit themselves.
 *
 * What a signed-in person may open is not here: it arrives with the session
 * (`lib/session.tsx`), because the navigation needs it before any screen renders.
 */

export interface PropertyModule {
  moduleKey: ModuleKey;
  label: string;
  /** An add-on: off until sold, rather than on until switched off. */
  requiresLicence: boolean;
  enabled: boolean;
  /** True when a row decided this, false when the default did. */
  isExplicit: boolean;
  note: string | null;
  changedAt: string | null;
}

export async function listPropertyModules(propertyId: string): Promise<PropertyModule[]> {
  const { data, error } = await requireSupabase().rpc("platform_list_property_modules", {
    p_property_id: propertyId,
  });

  if (error) throw new Error(friendly(error.code, error.message));

  return (data ?? []).map((r) => ({
    moduleKey: r.module_key,
    label: r.label,
    requiresLicence: r.requires_licence,
    enabled: r.enabled,
    isExplicit: r.is_explicit,
    note: r.note,
    changedAt: r.changed_at,
  }));
}

export async function setPropertyModule(
  propertyId: string,
  moduleKey: ModuleKey,
  enabled: boolean,
  note: string | null,
): Promise<void> {
  const { error } = await requireSupabase().rpc("platform_set_property_module", {
    p_property_id: propertyId,
    p_module_key: moduleKey,
    p_enabled: enabled,
    p_note: note,
  });

  if (error) throw new Error(friendly(error.code, error.message));
}

/** Removes the explicit decision, returning the module to what it would be by default. */
export async function resetPropertyModule(propertyId: string, moduleKey: ModuleKey): Promise<void> {
  const { error } = await requireSupabase().rpc("platform_reset_property_module", {
    p_property_id: propertyId,
    p_module_key: moduleKey,
  });

  if (error) throw new Error(friendly(error.code, error.message));
}

export interface MemberModule {
  userId: string;
  moduleKey: ModuleKey;
  allowed: boolean;
  /** Whether a personal exception produced that answer, rather than their role. */
  isOverride: boolean;
}

export async function listMemberModules(propertyId: string): Promise<MemberModule[]> {
  const { data, error } = await requireSupabase().rpc("list_member_modules", {
    p_property_id: propertyId,
  });

  if (error) throw new Error(friendly(error.code, error.message));

  return (data ?? []).map((r) => ({
    userId: r.user_id,
    moduleKey: r.module_key,
    allowed: r.allowed,
    isOverride: r.is_override,
  }));
}

/**
 * Narrows one person, or clears the exception.
 *
 * `allowed: null` deletes the row and returns them to their role's default. Passing
 * `true` records that they are deliberately not restricted — it grants nothing their
 * role does not already carry, because the server checks the role separately.
 */
export async function setMemberModule(
  propertyId: string,
  userId: string,
  moduleKey: ModuleKey,
  allowed: boolean | null,
): Promise<void> {
  const { error } = await requireSupabase().rpc("set_member_module", {
    p_property_id: propertyId,
    p_user_id: userId,
    p_module_key: moduleKey,
    p_allowed: allowed,
  });

  if (error) throw new Error(friendly(error.code, error.message));
}

function friendly(code: string | undefined, message: string): string {
  // The server's refusals here are already written for the person reading them — they
  // name the module and say who can change it — so they pass through. Only the case no
  // server message covers is rewritten.
  if (code === "PGRST202")
    return "This build is talking to a database that does not have module access yet. The migration has not been deployed.";
  return message;
}
