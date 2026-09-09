/**
 * What a location looks like when the property has not said.
 *
 * This is the hotel vertical's adapter and the only file under `floorplan/` that knows
 * what a storage regime is. The registry and the packer are deliberately ignorant of it,
 * so swapping this file and the registry entries swaps the vertical (ADR 0017).
 *
 * The direction of travel is one-way and load-bearing: **`storage_regime` decides the
 * picture, and the picture never decides anything.** Regime carries the rules — what may
 * be stored where, whether a cold chain applies — and `plan_visual_type` is presentation.
 * A chiller drawn on an AMBIENT location is a data-entry mistake for the setup screen to
 * point at, never a cold chain to enforce. Nothing in the app may read a visual to answer
 * an operational question, and this function existing is what makes that easy to obey:
 * the visual is derivable, so there is never a reason to consult it for the truth.
 */

/** Mirrors `location_kind` in the schema; the two are pinned by `planRole`'s tests. */
export type LocationKind =
  | "SECURITY"
  | "RECEIVING"
  | "REJECT"
  | "ZONE"
  | "RACK"
  | "BIN"
  | "DISPATCH"
  | "DEPARTMENT";

// The package's existing definition, not a second copy. Two spellings of the same three
// values is exactly the divergence rule 16 is about, and the first draft here had one.
import type { StorageRegime } from "../items/storage-regime";

export type { StorageRegime };

/**
 * Whether and how a location appears on the plan.
 *
 * Keyed on `kind` rather than on any plan column, deliberately. `kind` is an enum that
 * already carries rules, so it is the honest place for a question about what a location
 * *is* — and keying on "has a visual been set" would leave the plan blank until somebody
 * opened the setup screen, which is the opposite of the feature.
 */
export type PlanRole =
  /** Drawn inside a room. */
  | "LOCATION"
  /** Drawn as fixed scenery outside the building — the gate, the dock, the staging bay. */
  | "SCENERY"
  /** Never drawn. Bins and racks are shelf-level; a property has hundreds. */
  | "HIDDEN";

export function planRole(kind: LocationKind): PlanRole {
  switch (kind) {
    case "ZONE":
      return "LOCATION";
    case "SECURITY":
    case "RECEIVING":
    case "DISPATCH":
      return "SCENERY";
    case "REJECT":
    case "RACK":
    case "BIN":
    case "DEPARTMENT":
      return "HIDDEN";
  }
}

/**
 * The visual a location gets when `plan_visual_type` is null.
 *
 * This is why a property that has never opened the Floor Plan step still sees a correct
 * plan of the seven locations provisioning gave it: the cold room draws as a chiller
 * because its regime says CHILLED, not because anyone told the plan so.
 */
export function deriveVisual(kind: LocationKind, regime: StorageRegime): string {
  switch (planRole(kind)) {
    case "SCENERY":
      return kind === "SECURITY" ? "gate" : kind === "RECEIVING" ? "dock" : "staging";
    case "HIDDEN":
      // Answered rather than refused: a caller that asks about a bin has made a mistake,
      // and a plain box is a better outcome than a thrown error on the dashboard.
      return "store";
    case "LOCATION":
      return regime === "FROZEN" ? "freezer" : regime === "CHILLED" ? "chiller" : "dry";
  }
}

/**
 * The visual to draw: what the property chose, or what their regime implies.
 *
 * Note the asymmetry with `resolveBehavior` — there is no case in which a stored visual
 * is overruled by the regime. A "Cheese Cave" that a property has drawn as a chiller
 * stays a chiller even though its regime is CHILLED and would have derived the same
 * thing anyway, and a property that draws its ambient spice room as a chiller gets what
 * it asked for. The setup screen warns; the renderer obeys.
 */
export function resolveVisual(
  stored: string | null | undefined,
  kind: LocationKind,
  regime: StorageRegime,
): string {
  return stored ?? deriveVisual(kind, regime);
}

/**
 * Whether a stored visual disagrees with what the regime implies — the thing the setup
 * screen shows a quiet note about.
 *
 * It is a note and not a refusal, on purpose. "Cheese Cave", "Chocolate Room" and
 * "Charcuterie" are real places in real hotels that a property will legitimately want
 * drawn as a chiller for reasons the regime does not capture. Blocking it would teach
 * them the plan is wrong about their building; saying nothing would let a genuine typo
 * sit there looking deliberate. So: witness, do not enforce (CLAUDE.md 18).
 */
export function visualContradictsRegime(
  stored: string | null | undefined,
  kind: LocationKind,
  regime: StorageRegime,
): boolean {
  if (stored == null) return false;
  if (planRole(kind) !== "LOCATION") return false;
  const cold = stored === "chiller" || stored === "freezer";
  return cold ? regime === "AMBIENT" : regime !== "AMBIENT";
}
