import type { LocationKind, StorageRegime } from "@golai/db";
import { requireSupabase } from "./supabase";

export interface LocationOption {
  id: string;
  code: string;
  name: string;
  kind: LocationKind;
  regime: StorageRegime;
}

/**
 * Storage locations, for putting stock somewhere.
 *
 * SECURITY is excluded: SB-SEC is a notional location that holds nothing but which
 * every movement references (PRD section 3.1). Offering it as somewhere to store stock
 * would be wrong.
 */
export async function listLocations(): Promise<LocationOption[]> {
  const { data, error } = await requireSupabase()
    .from("location")
    .select("id, code, name, kind, regime")
    .eq("is_active", true)
    .neq("kind", "SECURITY")
    .order("code");

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    regime: r.regime,
  }));
}
