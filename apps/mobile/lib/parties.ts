import type { PartyType } from "@golai/db";
import { assertAffected } from "@golai/db";
import { requireSupabase } from "./supabase";

/**
 * Counterparties — vendors, laundries, waste handlers, carriers, sister properties.
 *
 * One entity with a type discriminator rather than a vendor table, because Terminal 2
 * scans the laundry exactly as Terminal 1 scans the vendor. A vendor-only table would be
 * rebuilt the moment dispatch arrived, which is now.
 *
 * Purchase owns the relationship, so Purchase owns the record (PRD section 11). Everyone
 * with membership can read it — a storekeeper receives from this list.
 */

export interface Party {
  id: string;
  code: string;
  name: string;
  partyType: PartyType;
  phone: string | null;
  gstin: string | null;
  fssaiLicence: string | null;
  /** Shown in red at the gate before anything is unloaded. */
  onHold: boolean;
  holdReason: string | null;
  isActive: boolean;
}

export const PARTY_TYPES: { id: PartyType; label: string; hint: string }[] = [
  { id: "VENDOR", label: "Vendor", hint: "Supplies material" },
  { id: "LAUNDRY", label: "Laundry", hint: "Linen goes and comes back" },
  { id: "AGGREGATOR", label: "Waste handler", hint: "Used cooking oil, food waste" },
  { id: "CONTRACTOR", label: "Contractor", hint: "Works on site" },
  { id: "CARRIER", label: "Carrier", hint: "Moves goods" },
  { id: "SISTER_PROPERTY", label: "Sister property", hint: "Inter-property transfer" },
];

export async function listParties(includeInactive = false): Promise<Party[]> {
  let query = requireSupabase()
    .from("party")
    .select(
      "id, code, name, party_type, phone, gstin, fssai_licence, on_hold, hold_reason, is_active",
    )
    .order("name")
    .limit(500);

  if (!includeInactive) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    partyType: r.party_type,
    phone: r.phone,
    gstin: r.gstin,
    fssaiLicence: r.fssai_licence,
    onHold: r.on_hold,
    holdReason: r.hold_reason,
    isActive: r.is_active,
  }));
}

export interface PartyWrite {
  code: string;
  name: string;
  partyType: PartyType;
  phone: string | null;
  gstin: string | null;
  fssaiLicence: string | null;
  onHold: boolean;
  holdReason: string | null;
  isActive: boolean;
}

/**
 * The next code in the property's own series.
 *
 * Read from `number_sequence` rather than allocated, because allocation belongs to the
 * server-side function and there is no RPC that mints a party code yet. What this gives
 * is a sensible SUGGESTION the person can overwrite — a unique-constraint violation on
 * save is the backstop, and it says so in words.
 */
export async function suggestPartyCode(propertyCode: string): Promise<string> {
  const { data } = await requireSupabase()
    .from("number_sequence")
    .select("next_value")
    .eq("doc_type", "PARTY")
    .maybeSingle();

  const next = data?.next_value ?? 1;
  return `${propertyCode}-VEN-${String(next).padStart(6, "0")}`;
}

export async function createParty(propertyId: string, write: PartyWrite): Promise<string> {
  const { data, error } = await requireSupabase()
    .from("party")
    .insert({
      property_id: propertyId,
      code: write.code,
      name: write.name,
      party_type: write.partyType,
      phone: write.phone,
      gstin: write.gstin,
      fssai_licence: write.fssaiLicence,
      on_hold: write.onHold,
      hold_reason: write.holdReason,
      is_active: write.isActive,
    })
    .select("id")
    .single();

  if (error) throw new Error(friendly(error.code, error.message));
  return data.id;
}

export async function updateParty(id: string, write: PartyWrite): Promise<void> {
  const { data, error } = await requireSupabase()
    .from("party")
    .update({
      code: write.code,
      name: write.name,
      party_type: write.partyType,
      phone: write.phone,
      gstin: write.gstin,
      fssai_licence: write.fssaiLicence,
      on_hold: write.onHold,
      hold_reason: write.holdReason,
      is_active: write.isActive,
    })
    .eq("id", id)
    .select("id");

  if (error) throw new Error(friendly(error.code, error.message));
  // RLS denies UPDATE silently — the rows are simply invisible and the statement succeeds
  // having changed nothing. Without this a refused edit would look like it worked
  // (CLAUDE.md rule 4b).
  assertAffected("party", data);
}

function friendly(code: string | undefined, message: string): string {
  if (code === "23505") return "A counterparty with that code already exists at this property.";
  if (code === "42501")
    return "Changing the vendor list needs Purchase or an Administrator — they own the relationship this record describes.";
  if (code === "23514" && message.includes("hold_has_a_reason"))
    return "Say why the vendor is on hold. A hold nobody can explain is one nobody can lift.";
  return message;
}
