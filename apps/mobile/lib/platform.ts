import type { OrganisationLifecycle, PropertyLifecycle } from "@golai/db";
import { requireSupabase } from "./supabase";

/**
 * The vendor console.
 *
 * Everything else in this app is scoped to one property. This is not — it is our side of
 * the product, and the only place that crosses the tenancy boundary. That makes it the
 * part most worth being careful with: the guard is a named-people table checked inside
 * SECURITY DEFINER functions, never a widened RLS predicate, because widening a predicate
 * to let the vendor see everything is how a customer ends up seeing everything too
 * (CLAUDE.md rule 2).
 */

export async function amIPlatformAdmin(): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc("am_i_platform_admin");
  // A failure here means "no console", not an error screen. The rest of the app is a
  // property administrator's and works perfectly without this answer.
  if (error) return false;
  return data === true;
}

export interface Tenant {
  orgId: string;
  orgName: string;
  orgLifecycle: OrganisationLifecycle;
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  propertyLifecycle: PropertyLifecycle;
  createdAt: string;
  people: number;
  items: number;
  bins: number;
  vendors: number;
  receipts: number;
  /** Null means nothing has ever moved here — a stalled onboarding, not a quiet one. */
  lastActivity: string | null;
}

export async function listTenants(): Promise<Tenant[]> {
  const { data, error } = await requireSupabase().rpc("list_tenants");
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    orgId: r.org_id,
    orgName: r.org_name,
    orgLifecycle: r.org_lifecycle,
    propertyId: r.property_id,
    propertyCode: r.property_code,
    propertyName: r.property_name,
    propertyLifecycle: r.property_lifecycle,
    createdAt: r.created_at,
    people: r.people,
    items: r.items,
    bins: r.bins,
    vendors: r.vendors,
    receipts: r.receipts,
    lastActivity: r.last_activity,
  }));
}

export interface NewTenant {
  orgName: string;
  propertyCode: string;
  propertyName: string;
  ownerName: string;
  ownerEmail?: string;
  ownerPhone?: string;
}

export interface ProvisionedTenant {
  propertyId: string;
  propertyCode: string;
  wasNew: boolean;
  ownerLoginId: string | null;
  /** True when the owner already had a login — a group opening its second hotel. */
  ownerExisted: boolean;
  /** Shown once and stored nowhere. Null when the owner already existed. */
  tempPassword: string | null;
}

/**
 * Onboards a customer.
 *
 * Through an edge function rather than the client, because minting the owner's login
 * needs the service-role key and that key must never reach a browser. The function asks
 * the database whether the caller may do this, as the caller — so there is one answer to
 * that question rather than two that drift apart.
 */
export async function provisionTenant(input: NewTenant): Promise<ProvisionedTenant> {
  const { data, error } = await requireSupabase().functions.invoke("provision-tenant", {
    body: {
      org_name: input.orgName,
      property_code: input.propertyCode,
      property_name: input.propertyName,
      owner_name: input.ownerName,
      owner_email: input.ownerEmail ?? null,
      owner_phone: input.ownerPhone ?? null,
    },
  });

  if (error) {
    // The edge function's own message is the useful one — "that is not a valid property
    // code" beats "Edge Function returned a non-2xx status code" — and it arrives in the
    // body rather than in the error.
    const body = (data ?? null) as { error?: string } | null;
    throw new Error(body?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);

  return {
    propertyId: data.property_id,
    propertyCode: data.property_code,
    wasNew: data.was_new,
    ownerLoginId: data.owner_login_id,
    ownerExisted: data.owner_existed,
    tempPassword: data.temp_password,
  };
}

export async function setPropertyLifecycle(
  propertyId: string,
  state: PropertyLifecycle,
): Promise<void> {
  const { error } = await requireSupabase().rpc("set_property_lifecycle", {
    p_property_id: propertyId,
    p_state: state,
  });
  if (error) throw new Error(error.message);
}

/**
 * What a property still needs before it can work.
 *
 * Derived here rather than stored, because it is a question about the data and storing
 * the answer means storing something that goes stale the moment somebody imports an item.
 * This is ADR 0010's readiness checklist in the smallest form that is honest.
 */
export function readiness(t: Tenant): { label: string; done: boolean }[] {
  return [
    { label: "Items imported", done: t.items > 0 },
    { label: "Bins built", done: t.bins > 0 },
    { label: "Vendors added", done: t.vendors > 0 },
    { label: "People beyond the owner", done: t.people > 1 },
    { label: "First delivery received", done: t.receipts > 0 },
  ];
}
