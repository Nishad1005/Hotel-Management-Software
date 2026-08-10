/**
 * The stock state machine. PRD section 3.2 for the states, section 4-6 for the gates
 * that drive them.
 *
 * This is the canonical definition. The mobile app consults it to validate offline,
 * edge functions consult it server-side, and Postgres enforces the subset that must
 * never be bypassed. See docs/decisions/0009-domain-package-has-no-io.md.
 */

export const STOCK_STATES = [
  "QUARANTINE",
  "AVAILABLE",
  "TRANSIT",
  "ISSUED",
  "STAGED_OUT",
  "REJECT_HOLD",
  "BLOCKED",
] as const;

export type StockState = (typeof STOCK_STATES)[number];

export const STOCK_TRIGGERS = [
  "PUT_AWAY",
  "ISSUE",
  "RETURN_TO_STORE",
  "TRANSFER_DESPATCH",
  "TRANSFER_RECEIPT",
  "STAGE_OUT",
  "DISPATCH_CANCELLED",
  "FSO_HOLD",
  "FSO_RELEASE",
] as const;

export type StockTrigger = (typeof STOCK_TRIGGERS)[number];

/**
 * States that represent stock held somewhere inside the property's zone tree.
 * Rejected goods may never enter any of them.
 */
const ZONE_STATES = new Set<StockState>(["AVAILABLE", "TRANSIT", "ISSUED", "BLOCKED"]);

interface Transition {
  readonly trigger: StockTrigger;
  readonly from: StockState;
  readonly to: StockState;
}

const TRANSITIONS: readonly Transition[] = [
  // Gate 6 — put-away. Requires a scanned destination bin; the scan is enforced at
  // the call site, but no other trigger may make quarantined stock issuable.
  { trigger: "PUT_AWAY", from: "QUARANTINE", to: "AVAILABLE" },

  // Gate 7 — inter-zone transfer. TRANSIT is its own state so stock walking between
  // zones is neither double-counted nor invisible.
  { trigger: "TRANSFER_DESPATCH", from: "AVAILABLE", to: "TRANSIT" },
  { trigger: "TRANSFER_RECEIPT", from: "TRANSIT", to: "AVAILABLE" },

  // Gate 8 — department issue and return.
  { trigger: "ISSUE", from: "AVAILABLE", to: "ISSUED" },
  { trigger: "RETURN_TO_STORE", from: "ISSUED", to: "AVAILABLE" },

  // Gate 9 — dispatch staging. Rejected goods leave the property this way and only
  // this way; they never travel back inward.
  { trigger: "STAGE_OUT", from: "AVAILABLE", to: "STAGED_OUT" },
  { trigger: "STAGE_OUT", from: "REJECT_HOLD", to: "STAGED_OUT" },
  { trigger: "DISPATCH_CANCELLED", from: "STAGED_OUT", to: "AVAILABLE" },

  // FSO hold and release.
  { trigger: "FSO_HOLD", from: "AVAILABLE", to: "BLOCKED" },
  { trigger: "FSO_RELEASE", from: "BLOCKED", to: "AVAILABLE" },
];

/** Only stock sitting in a zone bin and free of holds can be issued. PRD section 3.2. */
export function isIssuable(state: StockState): boolean {
  return state === "AVAILABLE";
}

/**
 * Whether `trigger` may legally move stock from `from` to `to`.
 *
 * The rejected-stock rule is asserted explicitly rather than left to emerge from the
 * transition table. It is a hard rule with no enforcement mode and no override
 * (PRD section 8), so it should fail at the source if the table is ever edited.
 */
export function canTransition(from: StockState, to: StockState, trigger: StockTrigger): boolean {
  if (from === "REJECT_HOLD" && ZONE_STATES.has(to)) return false;

  return TRANSITIONS.some((t) => t.trigger === trigger && t.from === from && t.to === to);
}

export class IllegalStockTransitionError extends Error {
  readonly from: StockState;
  readonly to: StockState;
  readonly trigger: StockTrigger;

  constructor(from: StockState, to: StockState, trigger: StockTrigger) {
    super(`Illegal stock transition: ${from} -> ${to} via ${trigger}`);
    this.name = "IllegalStockTransitionError";
    this.from = from;
    this.to = to;
    this.trigger = trigger;
  }
}

/** Throws {@link IllegalStockTransitionError} unless the transition is legal. */
export function assertTransition(from: StockState, to: StockState, trigger: StockTrigger): void {
  if (!canTransition(from, to, trigger)) {
    throw new IllegalStockTransitionError(from, to, trigger);
  }
}
