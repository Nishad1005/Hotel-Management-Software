/**
 * Gate 0 — Security capture. PRD section 4.
 *
 * The record begins here, before anything is unloaded. Security establishes that
 * something arrived, from whom, with what paperwork, and how many packages. It does
 * not judge quality and does not weigh.
 *
 * These rules run on a device that may be offline and cannot ask the server, and
 * again on the server which is the final authority. One definition, both places.
 */

export const ARRIVAL_TYPES = [
  "PO_DELIVERY",
  "MARKET_PURCHASE",
  "RETURN_FROM_OUTLET",
  "TRANSFER_IN",
  "SAMPLE",
] as const;

export type ArrivalType = (typeof ARRIVAL_TYPES)[number];

export const VEHICLE_MODES = ["TRUCK", "TEMPO", "TWO_WHEELER", "HAND_CART"] as const;

export type VehicleMode = (typeof VEHICLE_MODES)[number];

/**
 * A vendor is either scanned from the party master or, where they are not registered,
 * captured by name. Refusing the second would stop most fresh supply on day one:
 * acceptance criterion 9 requires an unregistered vendor with no bill to be receivable
 * in under four minutes.
 */
export type VendorRef =
  | { kind: "REGISTERED"; partyId: string }
  | { kind: "UNREGISTERED"; name: string; phone?: string };

/**
 * "No bill" is one of the answers, not the absence of one.
 *
 * UNANSWERED exists so that a guard who has not yet dealt with the bill is
 * distinguishable from one who has looked and found none. Collapsing the two would
 * make a blank field mean "no bill", which is the click-through that section 8 warns
 * about: the record would carry a false assertion instead of an honest gap.
 */
export type BillState =
  | { kind: "UNANSWERED" }
  | { kind: "PHOTOGRAPHED"; photoRef: string }
  | { kind: "NONE" };

export interface GateEntryDraft {
  vendor: VendorRef;
  bill: BillState;
  packageCount: number;
  arrivalType: ArrivalType;
  vehicleMode?: VehicleMode;
  vehicleNumber?: string;
}

export type GateEntryError =
  | "VENDOR_REQUIRED"
  | "BILL_UNANSWERED"
  | "BILL_PHOTO_MISSING"
  | "PACKAGE_COUNT_REQUIRED"
  | "PACKAGE_COUNT_NOT_WHOLE";

export interface ValidationResult {
  ok: boolean;
  errors: GateEntryError[];
}

/**
 * Validates the minimal capture path: vendor, bill, package count. Everything else -
 * vehicle, driver, PO reference - is completed at T1 or not at all.
 *
 * Every problem is reported at once. A guard on a night shift should be told
 * everything that is wrong in one pass rather than resubmitting to discover the next.
 */
export function validateGateEntryDraft(draft: GateEntryDraft): ValidationResult {
  const errors: GateEntryError[] = [];

  if (draft.vendor.kind === "UNREGISTERED" && draft.vendor.name.trim().length === 0) {
    errors.push("VENDOR_REQUIRED");
  }

  if (draft.bill.kind === "UNANSWERED") {
    errors.push("BILL_UNANSWERED");
  } else if (draft.bill.kind === "PHOTOGRAPHED" && draft.bill.photoRef.trim().length === 0) {
    errors.push("BILL_PHOTO_MISSING");
  }

  if (!Number.isFinite(draft.packageCount) || draft.packageCount < 1) {
    errors.push("PACKAGE_COUNT_REQUIRED");
  } else if (!Number.isInteger(draft.packageCount)) {
    // Security counts packages. Weight and volume belong to Terminal 1.
    errors.push("PACKAGE_COUNT_NOT_WHOLE");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * `SB-GE-000042` — property code, document type, sequence.
 *
 * Padded to six digits for legibility on a printed challan, but never truncated: the
 * number's identity is the sequence, not its width. A property that outgrows six
 * digits keeps counting rather than wrapping.
 */
export function formatDocumentNumber(
  propertyCode: string,
  docType: string,
  sequence: number,
): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Document sequence must be a positive integer, received ${sequence}`);
  }
  return `${propertyCode}-${docType}-${String(sequence).padStart(6, "0")}`;
}
