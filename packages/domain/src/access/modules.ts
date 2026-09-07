/**
 * The parts the product is sold in.
 *
 * ## Two questions, not one
 *
 * `capabilities.ts` answers "may this role do this job" — a statement about the work,
 * fixed by the PRD, the same at every property. Modules answer something the PRD has
 * no opinion about: what this particular customer is paying for, and which of their
 * people their own administrator has narrowed. A capability is a rule; a module is a
 * commercial fact about one property on one day.
 *
 * They compose by AND, and both are ergonomics rather than security. The boundary is
 * `app.has_module_access` in the database, checked inside every write function and
 * every direct-write policy — see migration `20260907055949_module_access.sql`, which
 * exists because golaiv1 learned that a hidden screen is not a closed door.
 *
 * ## This file does not decide anything
 *
 * It is a registry: labels and ordering for the two screens that show modules, and one
 * pure lookup. The decision arrives from the server as a map, already computed. That
 * asymmetry is deliberate — golaiv1 kept a full client-side copy of the rule and it
 * drifted, putting modules into the navigation of people the server then refused.
 */

/** Mirrors `ModuleKey` in `@golai/db`; the two are pinned in `apps/mobile/lib/access.ts`. */
export const GOLAI_MODULES = [
  {
    key: "GATE",
    label: "Gate",
    blurb: "Recording arrivals at the security gate, and passing goods back out.",
  },
  {
    key: "RECEIVING",
    label: "Receiving",
    blurb: "Checking a delivery in and posting the goods receipt.",
  },
  {
    key: "PUTAWAY",
    label: "Put away",
    blurb: "Moving received stock into a labelled bin.",
  },
  {
    key: "ISSUE",
    label: "Issue",
    blurb: "Handing stock out to a department.",
  },
  {
    key: "DISPATCH",
    label: "Dispatch",
    blurb: "Staging anything that is leaving the property.",
  },
  {
    key: "RETURNABLES",
    label: "Returnables",
    blurb: "Crates, cylinders and linen that were promised back, and recording their return.",
  },
  {
    key: "TEMPERATURE",
    label: "Temperature rounds",
    blurb: "The twice-daily cold room and freezer readings.",
  },
  {
    key: "STOCK",
    label: "Stock",
    blurb: "What is on hand, what is expiring, and the opening count.",
  },
  {
    key: "REGISTERS",
    label: "FSSAI registers",
    blurb: "The compliance registers and batch traceability.",
  },
  {
    key: "MASTERS",
    label: "Master data",
    blurb: "Items, storage locations, units and vendors.",
  },
  {
    key: "USERS",
    label: "Logins and roles",
    blurb: "Creating logins for their own staff and setting what each may reach.",
  },
] as const;

export type GolaiModule = (typeof GOLAI_MODULES)[number];
export type GolaiModuleKey = GolaiModule["key"];

/** What the server said, keyed by module. Absent while the answer is still in flight. */
export type ModuleAccessMap = Readonly<Record<string, boolean>> | undefined;

/**
 * Whether a module may be opened, according to a map the server produced.
 *
 * Fails closed on an absent map, and that case is real rather than theoretical: it is
 * the moment between sign-in and the first response. Returning true there would flash
 * every module into the navigation and then take some away, which reads as a bug to
 * the person watching and is a data leak in miniature — golaiv1 pinned exactly this
 * with a test after shipping it the other way round.
 *
 * Fails closed on an unknown key too, matching `app.has_module_access`, where a
 * mistyped key resolves to `not true`.
 */
export function moduleAllows(map: ModuleAccessMap, key: string): boolean {
  if (!map) return false;
  return map[key] === true;
}

export function moduleLabel(key: string): string {
  return GOLAI_MODULES.find((m) => m.key === key)?.label ?? key;
}
