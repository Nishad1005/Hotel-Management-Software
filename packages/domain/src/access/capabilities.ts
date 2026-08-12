/**
 * What each role may do — PRD section 11.
 *
 * ## This is ergonomics, not security
 *
 * Read that again before relying on it. Everything here runs on the device, which
 * means a determined user can reach any screen it hides. It exists so that a security
 * guard on a night shift sees four large buttons instead of nineteen, and so that a
 * storekeeper is not offered a screen that will refuse them at the end of it.
 *
 * The actual boundary is in the database: RLS policies on every table, and an explicit
 * role check as the first statement of every write function. If a capability here and
 * a policy there disagree, the policy wins and the app has a bug. golaiv1's migration
 * 0017 records the same lesson from the other side — it had to go back and remove
 * direct table writes after discovering that "the sidebar respected module access, but
 * a crafted API call could still reach the data".
 *
 * ## Why a capability rather than a role check at each call site
 *
 * `roles.includes("ADMIN") || roles.includes("OWNER")` scattered through the app is how
 * a new role gets added and silently locked out of half of it. Naming the capability
 * puts the whole grant table in one file, next to the PRD section it implements.
 */

/**
 * Declared here rather than imported from the database types, because this is the
 * PRD's list of roles, not Postgres's. `apps/mobile/lib/access.ts` asserts at compile
 * time that the two agree — that is the boundary where they meet.
 */
export const GOLAI_ROLES = [
  "OWNER",
  "ADMIN",
  "GM",
  "SECURITY",
  "STOREKEEPER",
  "CHEF",
  "FSO",
  "PURCHASE",
  "BANQUET",
  "AUDITOR",
] as const;

export type GolaiRole = (typeof GOLAI_ROLES)[number];

export const CAPABILITIES = [
  "gate.capture", // Gate 0 — security capture, inbound
  "gate.pass", // Gate 10 — security gate-out
  "receiving", // Gates 1-5 — arrival, quantity, quality, decision, GRN
  "putaway", // Gate 6 — into a zone, destination scanned
  "transfer", // Gate 7 — inter-zone
  "issue", // Gate 8 — zone to department
  "dispatch", // Gate 9 — Terminal 2 staging
  "terminal.clear", // Gate 11 — terminal clearance
  "quality.signoff", // Gate 3 — perishable quality
  "quality.hold", // Place a batch on BLOCKED
  "variance.approve", // Gate 2/4 — quantity variance against the challan
  "stock.view",
  "reports.view",
  "masters.edit", // Items, categories, units, locations
  "parties.edit", // Vendors and every other counterparty
  "people.edit", // The staff master and its cards
  "users.manage", // App logins and role grants
  "overrides",
  "enforcement.configure",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Read-only, and meant literally. The Auditor sees the full trail including every
 * override, and can change nothing — which is what makes their sign-off worth having.
 */
const READ_ONLY: Capability[] = ["stock.view", "reports.view"];

const ROLE_CAPABILITIES: Record<GolaiRole, readonly Capability[]> = {
  OWNER: CAPABILITIES,
  ADMIN: CAPABILITIES,

  // Overrides and enforcement, not the day-to-day flow. A GM who is also working the
  // dock should hold a second membership row saying so, rather than this role being
  // widened until it means nothing.
  GM: ["overrides", "enforcement.configure", "gate.pass", ...READ_ONLY],

  // Gate 0 and Gate 10, and nothing else (PRD section 4 Gate 0a). Deliberately the
  // narrowest role in the system: Security is frequently outsourced agency staff with
  // high churn, and the flow has to be learnable in one shift.
  //
  // Note the omission of stock.view. A guard has no reason to know what is in the cold
  // room, and a screen they never need is a screen they can get lost in at 2am.
  SECURITY: ["gate.capture", "gate.pass"],

  // Gates 1-9 and 11 — the primary operator inside the property.
  //
  // No gate.capture: if the storekeeper creates the gate entry as well as the GRN, the
  // two records agree by construction and the reconciliation control is gone. No
  // masters.edit either — recording stock must not require authority over the master it
  // is recorded against, which pgTAP 008 already proves at the database.
  STOREKEEPER: [
    "receiving",
    "putaway",
    "transfer",
    "issue",
    "dispatch",
    "terminal.clear",
    ...READ_ONLY,
  ],

  // Signs off perishable quality at Gate 3 and receives issues at Gate 8 — but
  // receiving an issue means presenting a card to be scanned, not operating the app.
  CHEF: ["quality.signoff", ...READ_ONLY],

  // Temperature and hygiene escalation, and the only role that can stop a batch.
  FSO: ["quality.signoff", "quality.hold", "dispatch", ...READ_ONLY],

  // Variance approval and supplier returns. Holds the vendor master because Purchase
  // owns the relationship that the party record describes.
  PURCHASE: ["variance.approve", "parties.edit", "dispatch", ...READ_ONLY],

  // Outdoor catering despatch and the returnables that come back from it.
  BANQUET: ["dispatch", ...READ_ONLY],

  AUDITOR: READ_ONLY,
};

/**
 * The union of everything these roles grant.
 *
 * Union rather than intersection: a small property doubles people up, and someone
 * holding both SECURITY and STOREKEEPER needs both sets. Where that combination
 * defeats a segregation rule — PRD section 11 requires that the person who stages at
 * Terminal 2 is not the person who verifies at Security — the rule is enforced at the
 * moment of the action against the actual user, not by withholding a capability.
 *
 * A fresh Set each call. Returning the shared table would let one caller's mutation
 * widen every other caller's access.
 */
export function capabilitiesFor(roles: readonly GolaiRole[]): ReadonlySet<Capability> {
  const granted = new Set<Capability>();

  for (const role of roles) {
    // A newer server can hold a role this build predates. Ignoring it grants nothing,
    // which is the safe direction; throwing would lock the user out of the whole app
    // over a role they may not even depend on.
    const capabilities = ROLE_CAPABILITIES[role];
    if (!capabilities) continue;

    for (const capability of capabilities) granted.add(capability);
  }

  return granted;
}

export function can(roles: readonly GolaiRole[], capability: Capability): boolean {
  return capabilitiesFor(roles).has(capability);
}
