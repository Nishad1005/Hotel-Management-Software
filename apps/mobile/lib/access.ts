import type { MembershipRole } from "@golai/db";
import { can, capabilitiesFor, type Capability, type GolaiRole } from "@golai/domain";

/**
 * Where the role list in the domain package meets the one in the database types.
 *
 * `packages/domain/src/access/capabilities.ts` owns `GOLAI_ROLES` because roles are a
 * rule — PRD section 11 — and rules belong in the domain package with tests.
 * `packages/db/src/types.ts` owns `MembershipRole` because it mirrors the Postgres
 * enum. Neither can import the other: domain has zero dependencies by design, and the
 * db types are meant to become generated from the migrations.
 *
 * So they meet here, in the one place that already imports both, and the assertion
 * below is what stops them drifting. Add a role to the enum without adding it to the
 * capability table and this file stops compiling — which is the point, because the
 * alternative is a role that silently holds no capabilities and a user who quietly
 * cannot do their job.
 *
 * `capabilities.ts` has claimed this file exists since it was written. It did not.
 */

/** True only when the two unions are the same set, in both directions. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export const ROLE_PARITY: Exact<GolaiRole, MembershipRole> = true;

/**
 * The capability each route needs.
 *
 * Absent means the route is open to anyone signed in with a property — the home screen
 * and the property picker. Everything else names what it requires.
 *
 * This is ergonomics, not security. It runs on the device and a determined user can
 * reach any screen it hides; the boundary is the RLS policies and the role check inside
 * each write function. What it buys is a guard on a night shift seeing four buttons
 * instead of nineteen, and nobody being offered a screen that will refuse them at the
 * end of it.
 */
export const ROUTE_CAPABILITY: Record<string, Capability> = {
  items: "masters.edit",
  perishables: "stock.view",
  stock: "stock.view",
  "stock/opening": "stock.view",
  registers: "reports.view",
  "registers/trace/[batch]": "reports.view",
  "gate/new": "gate.capture",
  "gate/recorded": "gate.capture",
  receive: "receiving",
  receipts: "reports.view",
  "receipts/[grn]": "reports.view",
  // The register is readable on report access; recording a return is gated inside the
  // screen on `dispatch`, mirroring the server's role set. The server also lets
  // SECURITY record — returns arrive at the gate — but the guard's screen is deferred
  // until the guard joins the pilot, so no route grant reflects that yet.
  returnables: "reports.view",
  "receive/[entry]": "receiving",
  putaway: "putaway",
  issue: "issue",
  dispatch: "dispatch",
  "gate-out": "gate.pass",
  vendors: "parties.edit",
  // Both routes have existed and been linked from the home screen since they were built,
  // and neither was ever listed here — so this table has been quietly incomplete for as
  // long as it has had no consumer. The sidebar is its first, which is how the gap
  // surfaced.
  "admin/locations": "masters.edit",
  "admin/users": "users.manage",
  // The hub. It shows when any of the four screens behind it does, which `NavItem.covers`
  // works out — this entry is the floor, so the route itself is never open to nobody.
  setup: "masters.edit",
  // Deliberately absent: `platform` is vendor staff, not a property capability, and the
  // server decides it. A route capability here would imply a property role grants it.
};

export function capabilitiesForMembership(
  roles: readonly MembershipRole[],
): ReadonlySet<Capability> {
  return capabilitiesFor(roles);
}

export function memberCan(roles: readonly MembershipRole[], capability: Capability): boolean {
  return can(roles, capability);
}
