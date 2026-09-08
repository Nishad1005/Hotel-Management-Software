import { requireSupabase } from "./supabase";

/**
 * The staff master — who may take custody of material.
 *
 * Distinct from `users.ts`, and the distinction is the point. That file is about logins:
 * who can sign in and what they may do. This one is about identity: who can be handed a
 * sack of rice and be on the record for it. Most people here will never appear there —
 * stewards, commis and housekeeping attendants take custody every shift and hold no
 * credentials — which is why the card links to a login where one exists rather than the
 * other way round (PRD section 4 Gate 8).
 */

export interface Person {
  id: string;
  /** The printed card number, e.g. `TW-EMP-00013`. */
  personCode: string;
  fullName: string;
  departmentId: string | null;
  departmentName: string | null;
  photoRef: string | null;
  /** Whether this person also holds an app login. Most do not. */
  hasLogin: boolean;
  isActive: boolean;
  deactivatedAt: string | null;
}

/**
 * Everybody, including stopped cards.
 *
 * Stopped ones are kept in the list on purpose. A device holding only active people
 * shows "no such card" for a revoked one, which reads as damage and invites a retry;
 * "this card was stopped" ends the conversation at the counter.
 */
export async function listPeople(propertyId: string): Promise<Person[]> {
  const { data, error } = await requireSupabase().rpc("list_people", {
    p_property_id: propertyId,
  });

  if (error) throw new Error(friendly(error.code, error.message));

  return (data ?? []).map((r) => ({
    id: r.id,
    personCode: r.person_code,
    fullName: r.full_name,
    departmentId: r.department_id,
    departmentName: r.department_name,
    photoRef: r.photo_ref,
    hasLogin: r.has_login,
    isActive: r.is_active,
    deactivatedAt: r.deactivated_at,
  }));
}

export interface CreatedPerson {
  personId: string;
  /** Minted by the server, which is the only thing holding the sequence. */
  personCode: string;
}

export async function createPerson(input: {
  propertyId: string;
  fullName: string;
  departmentId?: string | null;
}): Promise<CreatedPerson> {
  const { data, error } = await requireSupabase().rpc("create_person", {
    p_property_id: input.propertyId,
    p_full_name: input.fullName,
    p_department_id: input.departmentId ?? null,
  });

  if (error) throw new Error(friendly(error.code, error.message));

  const row = (data ?? [])[0];
  if (!row) throw new Error("The card was not issued. Nothing was recorded; try again.");
  return { personId: row.person_id, personCode: row.person_code };
}

/**
 * Stops or restores a card.
 *
 * Stopping needs a reason, and the server refuses without one — a revocation nobody can
 * review is not a control. The person is never deleted: they are referenced by every
 * acknowledgement they signed for, and removing them would take the accountability with
 * them.
 */
export async function setPersonActive(input: {
  propertyId: string;
  personId: string;
  active: boolean;
  reason?: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().rpc("set_person_active", {
    p_property_id: input.propertyId,
    p_person_id: input.personId,
    p_active: input.active,
    p_reason: input.reason ?? null,
  });

  if (error) throw new Error(friendly(error.code, error.message));
}

function friendly(code: string | undefined, message: string): string {
  if (code === "PGRST202")
    return "This build is talking to a database that does not have the staff master yet. The migration has not been deployed.";
  // The server's own words otherwise: it says "a card needs a name on it" and "say why
  // the card is being stopped", which are already the sentences a person needs.
  return message;
}
