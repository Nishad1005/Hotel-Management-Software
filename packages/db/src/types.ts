/**
 * Database types.
 *
 * HAND-MAINTAINED, not generated — and that is a known gap, not a preference.
 *
 * The intent (ADR 0013) is for CI to generate these from the replayed migrations so
 * they are provably a function of the schema. That cannot be bootstrapped from this
 * machine: generation needs either Docker or a database password, and neither is
 * available here. So this file is written by hand against the migrations, and CI
 * compares it against the real generated output — see the `Types match the schema`
 * step in ci.yml. When it disagrees, CI prints the diff and this file is corrected.
 *
 * Until that loop has run at least once, treat this as trusted-but-unverified.
 *
 * **When you add a migration, update this file in the same commit.** The whole point
 * of the CI check is that forgetting is caught, not that forgetting is impossible.
 */

/**
 * NOTE ON `type` VERSUS `interface` — IMPLICIT INDEX SIGNATURE
 *
 * Every row shape below is a type ALIAS, deliberately. supabase-js constrains a
 * schema to Record<string, unknown>, and TypeScript only gives an implicit index
 * signature to type aliases, never to interfaces. Declaring these as interfaces makes
 * the schema fail that constraint, whereupon every insert and update builder silently
 * resolves to `never` while reads keep working - which is a genuinely confusing way
 * to spend an afternoon. Do not convert these to interfaces.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type OrganisationLifecycle =
  | "TRIAL"
  | "ACTIVE"
  | "PAST_DUE"
  | "SUSPENDED"
  | "CHURNED"
  | "PURGED";

export type PropertyLifecycle =
  | "PROVISIONING"
  | "ONBOARDING"
  | "LIVE"
  | "SUSPENDED"
  | "CHURNED"
  | "PURGED";

export type MembershipRole =
  | "OWNER"
  | "ADMIN"
  | "GM"
  | "SECURITY"
  | "STOREKEEPER"
  | "CHEF"
  | "FSO"
  | "PURCHASE"
  | "BANQUET"
  | "AUDITOR";

/**
 * The parts the product is sold in.
 *
 * A union rather than a Postgres enum, because `module.key` is text with a check
 * constraint — a module is a row, so that a customer's grant can reference it and an
 * add-on can be registered by the migration that builds it. This union is therefore
 * the narrowing, not the source: adding a module means a migration row AND this line,
 * the same discipline every hand-maintained type in this file carries.
 */
export type ModuleKey =
  | "GATE"
  | "RECEIVING"
  | "PUTAWAY"
  | "ISSUE"
  | "DISPATCH"
  | "RETURNABLES"
  | "TEMPERATURE"
  | "STOCK"
  | "REGISTERS"
  | "MASTERS"
  | "USERS";

export type UomKind = "WEIGHT" | "VOLUME" | "COUNT";
export type StorageRegime = "AMBIENT" | "CHILLED" | "FROZEN";

/**
 * Every counterparty that transacts at a gate. One entity with a discriminator, because
 * Terminal 2 scans the laundry exactly as Terminal 1 scans the vendor.
 */
export type PartyType =
  | "VENDOR"
  | "CONTRACTOR"
  | "LAUNDRY"
  | "AGGREGATOR"
  | "CARRIER"
  | "SISTER_PROPERTY";

export type DocumentNumberType =
  | "GATE_ENTRY"
  | "GRN"
  | "GATE_PASS"
  | "DISPATCH_NOTE"
  | "ISSUE"
  | "PARTY";
/**
 * RACK groups; BIN is the leaf that carries a scannable label and is the only lawful
 * put-away destination (PRD section 4 Gate 6, hard rule 13).
 */
export type LocationKind =
  | "SECURITY"
  | "RECEIVING"
  | "REJECT"
  | "ZONE"
  | "RACK"
  | "BIN"
  | "DISPATCH"
  /** A consuming department. Holds issued stock without holding store stock. */
  | "DEPARTMENT";
export type EnforcementMode = "RECORD_ONLY" | "WARN" | "BLOCK";

export type OrganisationRow = {
  id: string;
  name: string;
  gstin: string | null;
  plan: string;
  lifecycle_state: OrganisationLifecycle;
  dpa_signed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PropertyRow = {
  id: string;
  org_id: string;
  code: string;
  name: string;
  timezone: string;
  lifecycle_state: PropertyLifecycle;
  went_live_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MembershipRow = {
  id: string;
  user_id: string;
  org_id: string;
  property_id: string | null;
  role: MembershipRole;
  created_at: string;
};

export type UomRow = {
  id: string;
  property_id: string;
  code: string;
  name: string;
  kind: UomKind;
  is_active: boolean;
  created_at: string;
};

export type ItemCategoryRow = {
  id: string;
  property_id: string;
  code: string;
  name: string;
  parent_id: string | null;
  default_min_shelf_life_pct: number | null;
  default_storage_regime: StorageRegime;
  is_active: boolean;
  created_at: string;
};

export type LocationRow = {
  id: string;
  property_id: string;
  code: string;
  name: string;
  kind: LocationKind;
  parent_id: string | null;
  regime: StorageRegime;
  is_active: boolean;
  /** What this property calls this kind of place — Shelf, Rack, Ghoda, Peti stack. */
  fixture_type: string;
  /** Set together or not at all, for positions found by coordinate rather than label. */
  grid_block: number | null;
  grid_row: number | null;
  grid_col: number | null;
  /** Explicit walking order within a parent; null falls back to code order. */
  sort_key: number | null;
  created_at: string;
};

export type ItemRow = {
  id: string;
  property_id: string;
  code: string;
  name: string;
  category_id: string;
  base_uom_id: string;
  is_perishable: boolean;
  is_cold_chain: boolean;
  is_batch_controlled: boolean;
  shelf_life_days: number | null;
  min_shelf_life_pct_at_receipt: number | null;
  storage_regime: StorageRegime;
  temp_min_c: number | null;
  temp_max_c: number | null;
  default_location_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ItemPackRow = {
  id: string;
  property_id: string;
  item_id: string;
  uom_id: string;
  factor_to_base: number;
  created_at: string;
};

export type RuleConfigRow = {
  id: string;
  property_id: string;
  rule_key: string;
  category_id: string | null;
  enforcement_mode: EnforcementMode;
  threshold_value: number | null;
  reason: string | null;
  changed_by: string | null;
  changed_at: string;
};

// ---------------------------------------------------------------------------
// The flow spine — PRD section 9's "cannot be retrofitted" list
// ---------------------------------------------------------------------------

export type StockState =
  | "QUARANTINE"
  | "AVAILABLE"
  | "TRANSIT"
  | "ISSUED"
  | "STAGED_OUT"
  | "REJECT_HOLD"
  | "BLOCKED";

export type MovementReason =
  | "OPENING_STOCK"
  | "GRN_POSTING"
  | "PUT_AWAY"
  | "ZONE_TRANSFER"
  | "ISSUE"
  | "RETURN_TO_STORE"
  /** The move to Terminal 2. Still on the property. */
  | "DISPATCH_STAGING"
  /** The departure itself — the movement with no destination, because there is none. */
  | "GATE_OUT"
  | "WRITE_OFF_EXPIRED"
  | "WRITE_OFF_DAMAGED"
  | "CORRECTION";

/**
 * How a scanned code was established.
 *
 * Hard rule 13 permits only a scan. TYPED exists so the concession this build makes is
 * counted rather than invisible — the rule ships RECORD_ONLY and tightens to BLOCK once
 * labels are printed and scanners are on the floor.
 */
export type ScanMethod = "CAMERA" | "HARDWARE" | "TYPED";

/** What a document can be filed against. Polymorphic, per the PRD's DocumentAttachment. */
export type DocumentEntity =
  | "GATE_ENTRY"
  | "GRN_LINE"
  | "PERSON"
  | "TEMPERATURE_READING"
  | "DISPATCH_NOTE"
  | "RECEIPT_ACK";

export type DocumentKind =
  | "BILL"
  | "COLD_CHAIN"
  | "STAFF_PHOTO"
  | "CONDITION"
  | "COLLECTION_RECEIPT";

export type BatchSource = "OPENING_STOCK" | "GRN";
export type ArrivalType =
  | "PO_DELIVERY"
  | "MARKET_PURCHASE"
  | "RETURN_FROM_OUTLET"
  | "TRANSFER_IN"
  | "SAMPLE";
export type VehicleMode = "TRUCK" | "TEMPO" | "TWO_WHEELER" | "HAND_CART";
export type BillState = "UNANSWERED" | "PHOTOGRAPHED" | "NONE";
export type GrnLineDecision = "ACCEPT" | "ACCEPT_PARTIAL" | "REJECT";
export type RejectReason =
  | "SHORT_SHELF_LIFE"
  | "NOT_COLD_ENOUGH"
  | "POOR_QUALITY"
  | "DAMAGED"
  | "WRONG_ITEM"
  | "OTHER";
export type DispatchType =
  | "SUPPLIER_RETURN"
  | "EMPTIES"
  | "LINEN"
  | "EQUIPMENT_REPAIR"
  | "OUTDOOR_CATERING"
  | "INTER_PROPERTY"
  | "CONDEMNED"
  | "FOOD_WASTE"
  | "USED_COOKING_OIL"
  | "SCRAP";

export type BatchRow = {
  id: string;
  property_id: string;
  item_id: string;
  batch_no: string;
  is_system_generated: boolean;
  mfg_date: string | null;
  best_before: string | null;
  shelf_life_total_days: number | null;
  pct_at_receipt: number | null;
  receipt_temp_c: number | null;
  dwell_breach: boolean;
  source: BatchSource;
  created_at: string;
};

export type GateEntryRow = {
  id: string;
  property_id: string;
  gate_entry_no: string;
  timestamp_in: string;
  timestamp_out: string | null;
  party_id: string | null;
  unregistered_vendor_name: string | null;
  arrival_type: ArrivalType;
  bill: BillState;
  bill_photo_ref: string | null;
  package_count: number;
  vehicle_mode: VehicleMode | null;
  vehicle_number: string | null;
  captured_by: string | null;
  /** What the capturing device believed the time was. Never authoritative. */
  captured_at_device: string | null;
  created_at: string;
};

export type GrnRow = {
  id: string;
  property_id: string;
  grn_no: string;
  gate_entry_id: string | null;
  party_id: string | null;
  posted_at: string;
  posted_by: string | null;
  amendment_of: string | null;
  amendment_reason: string | null;
  /**
   * Identifies the submission, so an outbox retry returns the original receipt rather
   * than posting a second one. Set by `post_grn`; never written from a client.
   */
  idempotency_key: string | null;
  created_at: string;
};

export type GrnLineRow = {
  id: string;
  property_id: string;
  grn_id: string;
  item_id: string;
  batch_id: string | null;
  qty_challan: number | null;
  qty_physical: number;
  qty_accepted: number;
  qty_rejected: number;
  uom_id: string;
  decision: GrnLineDecision;
  reject_reason: RejectReason | null;
  created_at: string;
};

/**
 * One line handed to `post_grn`.
 *
 * Not a `GrnLineRow`: the caller supplies neither ids the server allocates nor the batch,
 * which is created or matched during posting. `best_before` and `receipt_temp_c` belong
 * to the batch rather than the line, but they are captured on the same screen at the same
 * moment, so they arrive here.
 */
export type PostGrnLine = {
  item_id: string;
  /** Defaults to the item's base unit when omitted. */
  uom_id?: string;
  /** The vendor's number. A system one is generated when there is none. */
  batch_no?: string | null;
  mfg_date?: string | null;
  /** Required on a perishable item. Part of the quality floor; no mode switches it off. */
  best_before?: string | null;
  /** Required on a cold-chain item. Same floor. */
  receipt_temp_c?: number | null;
  qty_challan?: number | null;
  qty_physical: number;
  qty_accepted: number;
  qty_rejected: number;
  decision: GrnLineDecision;
  reject_reason?: RejectReason | null;
};

export type DispatchNoteRow = {
  id: string;
  property_id: string;
  dispatch_no: string;
  dispatch_type: DispatchType;
  reason_code: string | null;
  origin_location_id: string | null;
  /**
   * The original single-line shape, kept nullable and no longer written.
   *
   * A dispatch has lines (`dispatch_line`) as of the Gate 9 migration — one rejected line
   * per delivery is the easy case, not the usual one. These stay for a release because an
   * offline device running older code may still write them (expand/contract).
   */
  batch_id: string | null;
  item_id: string | null;
  qty: number | null;
  uom_id: string | null;
  recipient_party_id: string | null;
  is_returnable: boolean;
  expected_return_date: string | null;
  authorised_by: string | null;
  staged_by_name: string | null;
  idempotency_key: string | null;
  created_at: string;
};

export type DispatchLineRow = {
  id: string;
  property_id: string;
  dispatch_note_id: string;
  batch_id: string;
  item_id: string;
  from_location_id: string;
  /** Where it came from. A supplier return and a linen collection differ only in this. */
  from_state: StockState;
  qty: number;
  uom_id: string;
  created_at: string;
};

export type GatePassRow = {
  id: string;
  property_id: string;
  gate_pass_no: string;
  dispatch_note_id: string | null;
  timestamp_out: string;
  carrier: string | null;
  vehicle_number: string | null;
  package_count: number | null;
  verified_by: string | null;
  verified_by_name: string | null;
  printed_at: string | null;
  idempotency_key: string | null;
  created_at: string;
};

export type PartyRow = {
  id: string;
  property_id: string;
  code: string;
  name: string;
  party_type: PartyType;
  phone: string | null;
  gstin: string | null;
  fssai_licence: string | null;
  /** Shown in red at the gate before anything is unloaded. */
  on_hold: boolean;
  hold_reason: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * Read-only from the client. The counter moves only through
 * app.next_document_number, which is what makes "sequential and immutable" true.
 */
/**
 * A block of document numbers issued to a device (ADR 0005). Read-only from the
 * client — the only writer is the lease_document_numbers SECURITY DEFINER RPC —
 * and retained forever, so every gap in a series resolves to a device and a shift.
 */
export type NumberLeaseRow = {
  id: string;
  property_id: string;
  doc_type: DocumentNumberType;
  device_id: string;
  range_start: number;
  range_end: number;
  issued_at: string;
  expires_at: string | null;
  consumed_upto: number | null;
};

export type NumberSequenceRow = {
  property_id: string;
  doc_type: DocumentNumberType;
  next_value: number;
  updated_at: string;
};

export type ReturnableItemRow = {
  id: string;
  property_id: string;
  dispatch_note_id: string;
  qty_out: number;
  qty_returned: number;
  condition_on_return: string | null;
  returned_at: string | null;
  responsible_dept: string | null;
  created_at: string;
};

export type ModuleRow = {
  key: ModuleKey;
  label: string;
  default_roles: MembershipRole[];
  /** false: on unless switched off. true: an add-on, off until sold. */
  requires_licence: boolean;
  sort: number;
};

export type PropertyModuleRow = {
  property_id: string;
  module_key: ModuleKey;
  enabled: boolean;
  note: string | null;
  changed_by: string | null;
  changed_at: string;
};

export type MemberModuleRow = {
  property_id: string;
  user_id: string;
  module_key: ModuleKey;
  /** Narrowing only — false removes access, true is merely explicit. */
  allowed: boolean;
  changed_by: string | null;
  changed_at: string;
};

export type TemperatureReadingRow = {
  id: string;
  property_id: string;
  location_id: string;
  temperature_c: number;
  recorded_by: string | null;
  /** Server-authoritative. The device's own claim is `taken_at_device`. */
  recorded_at: string;
  /** What the capturing device believed the time was. Never authoritative. */
  taken_at_device: string | null;
  /**
   * Set by the capture screen, unique per property. An outbox retry lands on the
   * `temperature_reading_idempotent` constraint and is recognised as its own.
   */
  idempotency_key: string;
  created_at: string;
};

/**
 * The staff master — a card identifies a person, it does not sign them in.
 *
 * `user_id` is the link to a login where one exists, and is null for most people:
 * stewards, commis and housekeeping attendants take custody of material every day and
 * will never hold app credentials. PRD section 4 Gate 8.
 */
export type PersonRow = {
  id: string;
  property_id: string;
  /** The printed card number, e.g. `TW-EMP-00013`. Immutable once issued. */
  person_code: string;
  person_seq: number;
  full_name: string;
  /** A location of kind DEPARTMENT, or null for staff on no departmental chart. */
  department_id: string | null;
  /** Null until an image store exists; criterion 18 needs it, criterion 17 does not. */
  photo_ref: string | null;
  user_id: string | null;
  is_active: boolean;
  deactivated_at: string | null;
  deactivated_by: string | null;
  deactivated_reason: string | null;
  created_at: string;
  created_by: string | null;
};

/**
 * The evidence vault — one store for cold-chain photographs, staff faces and bills.
 *
 * Content-addressed and immutable: `storage_key` is `{property_id}/{sha256}`, and there
 * is no update or delete path at any level. PRD section 7.2.
 */
export type DocumentRow = {
  id: string;
  property_id: string;
  entity_type: DocumentEntity;
  entity_id: string;
  kind: DocumentKind;
  /** SHA-256 of the bytes, lowercase hex. The address, not a checksum beside one. */
  sha256: string;
  storage_key: string;
  mime_type: string;
  /** Capped at 409600 by a check constraint, so PRD section 13 is a server rule too. */
  byte_size: number;
  captured_at: string;
  captured_by: string | null;
  /** Required. A photograph with no end date is a decision nobody made. */
  retention_until: string;
  created_at: string;
};

export type StockMovementRow = {
  id: string;
  property_id: string;
  batch_id: string;
  item_id: string;
  from_location_id: string | null;
  from_state: StockState | null;
  to_location_id: string | null;
  to_state: StockState | null;
  qty: number;
  uom_id: string;
  reason: MovementReason;
  occurred_at: string;
  recorded_by: string | null;
  /** The recorder's name as it was at the moment of the movement. */
  recorded_by_name: string | null;
  idempotency_key: string;
  note: string | null;
  /** Set where the movement had a scannable destination — put-away, and later transfer. */
  scan_method: ScanMethod | null;
};

/**
 * One line handed to `issue_stock`.
 *
 * The lot, not the item: which batch and which bin is the decision FEFO makes, and
 * flattening it to "20 kg of flour" would let the server pick — which is the same as
 * nobody having decided.
 */
export type IssueStockLine = {
  batch_id: string;
  from_location_id: string;
  qty: number;
};

/**
 * One line handed to `stage_for_dispatch`.
 *
 * `from_state` is supplied rather than inferred: the same batch can sit in the reject
 * hold and in a zone at once — half a delivery accepted, half turned away — and which one
 * is leaving is the difference between a supplier return and a transfer out.
 */
export type DispatchStageLine = {
  batch_id: string;
  from_location_id: string;
  from_state: StockState;
  qty: number;
};

/**
 * One corrected line handed to `amend_grn`.
 *
 * Only the lines being changed need sending. Anything omitted is carried forward from the
 * original exactly — restating the other five lines of a six-line receipt is how the other
 * five get restated wrongly.
 */
export type AmendGrnLine = {
  grn_line_id: string;
  qty_physical?: number;
  qty_accepted?: number;
  qty_rejected?: number;
  decision?: GrnLineDecision;
  reject_reason?: RejectReason | null;
};

export type IssueNoteRow = {
  id: string;
  property_id: string;
  issue_no: string;
  /** A DEPARTMENT location. Departments are places, so they live in the location tree. */
  department_id: string;
  purpose: string | null;
  issued_at: string;
  issued_by: string | null;
  issued_by_name: string | null;
  idempotency_key: string | null;
  created_at: string;
};

export type IssueLineRow = {
  id: string;
  property_id: string;
  issue_note_id: string;
  batch_id: string;
  item_id: string;
  from_location_id: string;
  qty: number;
  uom_id: string;
  /** The expiry rule ships RECORD_ONLY, so this is the register it produces. */
  was_expired: boolean;
  days_remaining_at_issue: number | null;
  created_at: string;
};

/**
 * Who took custody.
 *
 * `verified_by_scan` is the whole point of the table. Acceptance criterion 17 is met when
 * it is true and not before; a typed `receiver_name` is the storekeeper's assertion, not
 * the receiver's identity.
 */
export type ReceiptAckRow = {
  id: string;
  property_id: string;
  issue_note_id: string | null;
  dispatch_note_id: string | null;
  receiver_name: string;
  receiver_person_id: string | null;
  verified_by_scan: boolean;
  scan_method: ScanMethod | null;
  acknowledged_at: string;
  recorded_by: string | null;
  recorded_by_name: string | null;
};

/** Derived from stock_movement. Never inserted or updated directly. */
export type StockLotRow = {
  property_id: string;
  batch_id: string;
  location_id: string;
  state: StockState;
  qty: number;
  updated_at: string;
};

/**
 * Columns the database fills in. Modelled explicitly rather than making everything
 * optional, so an insert that forgets a required column fails to compile instead of
 * failing at runtime against a NOT NULL constraint.
 */
type Generated = "id" | "created_at" | "updated_at";

type InsertOf<T, Optional extends keyof T = never> = Omit<T, Generated | Optional> &
  Partial<Pick<T, Extract<Generated | Optional, keyof T>>>;

export type Database = {
  public: {
    Tables: {
      organisation: {
        Row: OrganisationRow;
        Insert: InsertOf<OrganisationRow, "gstin" | "plan" | "lifecycle_state" | "dpa_signed_at">;
        Update: Partial<OrganisationRow>;
        Relationships: [];
      };
      property: {
        Row: PropertyRow;
        Insert: InsertOf<PropertyRow, "timezone" | "lifecycle_state" | "went_live_at">;
        Update: Partial<PropertyRow>;
        Relationships: [];
      };
      membership: {
        Row: MembershipRow;
        Insert: InsertOf<MembershipRow, "property_id">;
        Update: Partial<MembershipRow>;
        Relationships: [];
      };
      uom: {
        Row: UomRow;
        Insert: InsertOf<UomRow, "is_active">;
        Update: Partial<UomRow>;
        Relationships: [];
      };
      item_category: {
        Row: ItemCategoryRow;
        Insert: InsertOf<
          ItemCategoryRow,
          "parent_id" | "default_min_shelf_life_pct" | "default_storage_regime" | "is_active"
        >;
        Update: Partial<ItemCategoryRow>;
        Relationships: [];
      };
      location: {
        Row: LocationRow;
        Insert: InsertOf<
          LocationRow,
          | "parent_id"
          | "regime"
          | "is_active"
          | "fixture_type"
          | "grid_block"
          | "grid_row"
          | "grid_col"
          | "sort_key"
        >;
        Update: Partial<LocationRow>;
        Relationships: [];
      };
      item: {
        Row: ItemRow;
        Insert: InsertOf<
          ItemRow,
          | "is_perishable"
          | "is_cold_chain"
          | "is_batch_controlled"
          | "shelf_life_days"
          | "min_shelf_life_pct_at_receipt"
          | "storage_regime"
          | "temp_min_c"
          | "temp_max_c"
          | "default_location_id"
          | "is_active"
        >;
        Update: Partial<ItemRow>;
        Relationships: [];
      };
      item_pack: {
        Row: ItemPackRow;
        Insert: InsertOf<ItemPackRow>;
        Update: Partial<ItemPackRow>;
        Relationships: [];
      };
      rule_config: {
        Row: RuleConfigRow;
        Insert: InsertOf<
          RuleConfigRow,
          "category_id" | "enforcement_mode" | "threshold_value" | "reason" | "changed_by"
        >;
        Update: Partial<RuleConfigRow>;
        Relationships: [];
      };
      batch: {
        Row: BatchRow;
        Insert: InsertOf<
          BatchRow,
          | "is_system_generated"
          | "mfg_date"
          | "best_before"
          | "shelf_life_total_days"
          | "pct_at_receipt"
          | "receipt_temp_c"
          | "dwell_breach"
        >;
        Update: Partial<BatchRow>;
        Relationships: [];
      };
      gate_entry: {
        Row: GateEntryRow;
        Insert: InsertOf<
          GateEntryRow,
          | "timestamp_in"
          | "timestamp_out"
          | "party_id"
          | "unregistered_vendor_name"
          | "arrival_type"
          | "bill"
          | "bill_photo_ref"
          | "vehicle_mode"
          | "vehicle_number"
          | "captured_by"
          | "captured_at_device"
        >;
        Update: Partial<GateEntryRow>;
        Relationships: [];
      };
      grn: {
        Row: GrnRow;
        Insert: InsertOf<
          GrnRow,
          | "gate_entry_id"
          | "party_id"
          | "posted_at"
          | "posted_by"
          | "amendment_of"
          | "amendment_reason"
          | "idempotency_key"
        >;
        Update: Partial<GrnRow>;
        Relationships: [];
      };
      grn_line: {
        Row: GrnLineRow;
        Insert: InsertOf<
          GrnLineRow,
          "batch_id" | "qty_challan" | "qty_accepted" | "qty_rejected" | "reject_reason"
        >;
        Update: Partial<GrnLineRow>;
        Relationships: [];
      };
      dispatch_note: {
        Row: DispatchNoteRow;
        Insert: InsertOf<
          DispatchNoteRow,
          | "reason_code"
          | "origin_location_id"
          | "batch_id"
          | "item_id"
          | "qty"
          | "uom_id"
          | "recipient_party_id"
          | "is_returnable"
          | "expected_return_date"
          | "authorised_by"
        >;
        Update: Partial<DispatchNoteRow>;
        Relationships: [];
      };
      // Written only by stage_for_dispatch, like every other document with a number.
      dispatch_line: {
        Row: DispatchLineRow;
        Insert: DispatchLineRow;
        Update: Partial<DispatchLineRow>;
        Relationships: [];
      };
      gate_pass: {
        Row: GatePassRow;
        Insert: InsertOf<
          GatePassRow,
          | "dispatch_note_id"
          | "timestamp_out"
          | "carrier"
          | "vehicle_number"
          | "package_count"
          | "verified_by"
          | "printed_at"
        >;
        Update: Partial<GatePassRow>;
        Relationships: [];
      };
      party: {
        Row: PartyRow;
        Insert: InsertOf<
          PartyRow,
          | "party_type"
          | "phone"
          | "gstin"
          | "fssai_licence"
          | "on_hold"
          | "hold_reason"
          | "is_active"
        >;
        Update: Partial<PartyRow>;
        Relationships: [];
      };
      number_lease: {
        Row: NumberLeaseRow;
        // Declared for completeness; the grant is SELECT only, and the single writer
        // is the SECURITY DEFINER lease RPC.
        Insert: never;
        Update: never;
        Relationships: [];
      };
      number_sequence: {
        Row: NumberSequenceRow;
        Insert: InsertOf<NumberSequenceRow, "next_value">;
        Update: Partial<NumberSequenceRow>;
        Relationships: [];
      };
      returnable_item: {
        Row: ReturnableItemRow;
        Insert: InsertOf<
          ReturnableItemRow,
          "qty_returned" | "condition_on_return" | "returned_at" | "responsible_dept"
        >;
        Update: Partial<ReturnableItemRow>;
        Relationships: [];
      };
      stock_movement: {
        Row: StockMovementRow;
        Insert: InsertOf<
          StockMovementRow,
          | "from_location_id"
          | "from_state"
          | "to_location_id"
          | "to_state"
          | "occurred_at"
          | "recorded_by"
          | "recorded_by_name"
          | "note"
          | "scan_method"
        >;
        // Append-only in the database (ADR 0003). Declared for completeness; the
        // trigger refuses it.
        Update: Partial<StockMovementRow>;
        Relationships: [];
      };
      // Written only by issue_stock. There is no insert policy, deliberately: a document
      // with a number cannot be assembled from several client statements.
      issue_note: {
        Row: IssueNoteRow;
        Insert: IssueNoteRow;
        Update: Partial<IssueNoteRow>;
        Relationships: [];
      };
      issue_line: {
        Row: IssueLineRow;
        Insert: IssueLineRow;
        Update: Partial<IssueLineRow>;
        Relationships: [];
      };
      receipt_ack: {
        Row: ReceiptAckRow;
        Insert: ReceiptAckRow;
        Update: Partial<ReceiptAckRow>;
        Relationships: [];
      };
      stock_lot: {
        Row: StockLotRow;
        // A maintained projection. Written only by the ledger trigger.
        Insert: StockLotRow;
        Update: Partial<StockLotRow>;
        Relationships: [];
      };
      // The three access tables. All read-only to a client: what a customer holds is
      // set by platform staff, and personal exceptions go through set_member_module,
      // which refuses an administrator editing themselves.
      module: {
        Row: ModuleRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      property_module: {
        Row: PropertyModuleRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      member_module: {
        Row: MemberModuleRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      document: {
        Row: DocumentRow;
        // Filed through attach_document, which checks the subject belongs to the
        // property. Never updated or deleted: evidence that can be edited is not.
        Insert: never;
        Update: never;
        Relationships: [];
      };
      person: {
        Row: PersonRow;
        // No client writes at all. Adding somebody and stopping a card both go through
        // functions, which is what makes criterion 19's "server-side and immediate"
        // something a client cannot undo by writing the row.
        Insert: never;
        Update: never;
        Relationships: [];
      };
      temperature_reading: {
        Row: TemperatureReadingRow;
        // Inserted directly by the capture screen through the outbox — the same
        // plain-append path as gate_entry. No UPDATE is granted at any level.
        Insert: InsertOf<TemperatureReadingRow, "recorded_by" | "recorded_at" | "taken_at_device">;
        Update: Partial<TemperatureReadingRow>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    /**
     * Callable functions in `public`.
     *
     * Only what the client may call. `system` is service-role only and `app` is not
     * exposed to PostgREST at all, so neither appears here — and neither should, or the
     * types would start describing a surface the app cannot reach.
     */
    Functions: {
      deactivate_location: {
        Args: { p_property_id: string; p_location_id: string };
        Returns: undefined;
      };
      list_team: {
        Args: { p_property_id: string };
        Returns: {
          user_id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          roles: MembershipRole[];
          is_self: boolean;
        }[];
      };
      can_manage_users: {
        Args: { p_property_id: string };
        Returns: boolean;
      };
      grant_role: {
        Args: { p_property_id: string; p_user_id: string; p_role: MembershipRole };
        Returns: undefined;
      };
      revoke_role: {
        Args: { p_property_id: string; p_user_id: string; p_role: MembershipRole };
        Returns: undefined;
      };
      /**
       * Gates 1-5 in one transaction. Replaying a key returns the original receipt
       * rather than posting a second one.
       */
      post_grn: {
        Args: {
          p_property_id: string;
          p_gate_entry_id: string | null;
          p_party_id: string | null;
          p_idempotency_key: string;
          p_lines: PostGrnLine[];
        };
        Returns: { grn_id: string; grn_no: string }[];
      };
      /**
       * Gate 6. The destination is resolved from a scanned code rather than an id, and
       * how it was established is recorded on the movement.
       */
      put_away: {
        Args: {
          p_property_id: string;
          p_batch_id: string;
          p_from_location_id: string;
          p_to_location_code: string;
          p_qty: number;
          p_scan_method: ScanMethod;
          p_idempotency_key: string;
        };
        Returns: {
          movement_id: string;
          to_location_id: string;
          to_location_code: string;
          remaining: number;
        }[];
      };
      /**
       * Gate 8. Moves AVAILABLE stock into ISSUED at a department and writes the
       * acknowledgement in the same transaction.
       */
      issue_stock: {
        Args: {
          p_property_id: string;
          p_department_id: string;
          p_receiver_name: string;
          p_purpose: string | null;
          p_idempotency_key: string;
          p_lines: IssueStockLine[];
          /**
           * The staff card that was scanned, or null when none was presented.
           *
           * Optional so a device on an older build still calls the six-argument form and
           * still records a shift's work — CLAUDE.md rule 20.
           */
          p_receiver_person_id?: string | null;
          /** Required whenever a card is given. A scan with no method is not a scan. */
          p_scan_method?: ScanMethod | null;
          /** Why there was no card. Refused alongside a scan, since they are alternatives. */
          p_override_reason?: string | null;
        };
        Returns: { issue_id: string; issue_no: string; expired_lines: number }[];
      };
      /** AVAILABLE stock in FEFO order. Quarantine and reject hold are absent by construction. */
      list_issuable_stock: {
        Args: { p_property_id: string; p_item_id?: string | null };
        Returns: {
          batch_id: string;
          batch_no: string;
          item_id: string;
          item_name: string;
          item_code: string;
          is_perishable: boolean;
          uom_id: string;
          uom_code: string;
          location_id: string;
          location_code: string;
          location_name: string;
          qty: number;
          best_before: string | null;
          days_remaining: number | null;
        }[];
      };
      /** Gate 9. Moves stock to STAGED_OUT at Terminal 2 against a numbered dispatch note. */
      stage_for_dispatch: {
        Args: {
          p_property_id: string;
          p_dispatch_type: DispatchType;
          p_recipient_party_id: string | null;
          p_reason_code: string | null;
          p_is_returnable: boolean;
          p_expected_return_date: string | null;
          p_idempotency_key: string;
          p_lines: DispatchStageLine[];
        };
        Returns: { dispatch_id: string; dispatch_no: string }[];
      };
      /**
       * Gate 10. Issues the gate pass and takes the staged stock off the property.
       * Refuses a pass verified by whoever staged it.
       */
      issue_gate_pass: {
        Args: {
          p_property_id: string;
          p_dispatch_note_id: string;
          p_carrier: string;
          p_vehicle_number: string | null;
          p_package_count: number | null;
          p_idempotency_key: string;
        };
        Returns: { gate_pass_id: string; gate_pass_no: string }[];
      };
      /** Stock that may leave: the reject hold first, then zones and departments. */
      list_dispatchable_stock: {
        Args: { p_property_id: string };
        Returns: {
          batch_id: string;
          batch_no: string;
          item_id: string;
          item_name: string;
          item_code: string;
          uom_id: string;
          uom_code: string;
          location_id: string;
          location_code: string;
          location_name: string;
          state: StockState;
          qty: number;
          best_before: string | null;
        }[];
      };
      /** Dispatch notes with no gate pass — staged, and still on the property. */
      list_awaiting_gate_pass: {
        Args: { p_property_id: string };
        Returns: {
          dispatch_id: string;
          dispatch_no: string;
          dispatch_type: DispatchType;
          recipient_name: string | null;
          is_returnable: boolean;
          expected_return_date: string | null;
          staged_by_name: string | null;
          staged_by: string | null;
          staged_at: string;
          line_count: number;
          total_qty: number;
        }[];
      };
      /**
       * PRD section 7.2 — the inward material check, the receipt temperature record and
       * the non-conforming register. One dataset; they differ only in which rows you
       * look at.
       */
      list_inward_register: {
        Args: { p_property_id: string; p_from?: string | null; p_to?: string | null };
        Returns: {
          received_at: string;
          grn_no: string;
          gate_entry_no: string | null;
          vendor_name: string | null;
          vendor_fssai: string | null;
          item_code: string;
          item_name: string;
          batch_no: string | null;
          batch_is_generated: boolean | null;
          qty_challan: number | null;
          qty_physical: number;
          qty_accepted: number;
          qty_rejected: number;
          uom_code: string;
          best_before: string | null;
          receipt_temp_c: number | null;
          temp_min_c: number | null;
          temp_max_c: number | null;
          temp_in_range: boolean | null;
          decision: GrnLineDecision;
          reject_reason: RejectReason | null;
          received_by: string;
          batch_id: string | null;
        }[];
      };
      /**
       * Corrects a posted receipt by superseding it. The original is never touched, and
       * the stock difference is a compensating CORRECTION movement.
       */
      amend_grn: {
        Args: {
          p_property_id: string;
          p_grn_id: string;
          p_reason: string;
          p_idempotency_key: string;
          p_lines: AmendGrnLine[];
        };
        Returns: { grn_id: string; grn_no: string; adjusted_lines: number }[];
      };
      /** Posted receipts with both ends of the amendment chain. */
      list_receipts: {
        Args: { p_property_id: string; p_from?: string | null; p_to?: string | null };
        Returns: {
          grn_id: string;
          grn_no: string;
          posted_at: string;
          posted_by_name: string | null;
          gate_entry_no: string | null;
          vendor_name: string | null;
          line_count: number;
          total_accepted: number;
          total_rejected: number;
          amends_grn_no: string | null;
          amendment_reason: string | null;
          superseded_by_grn_no: string | null;
        }[];
      };
      /** The lines of one receipt, with how much of each is still correctable. */
      list_receipt_lines: {
        Args: { p_property_id: string; p_grn_id: string };
        Returns: {
          line_id: string;
          item_id: string;
          item_code: string;
          item_name: string;
          batch_id: string | null;
          batch_no: string | null;
          uom_code: string;
          qty_challan: number | null;
          qty_physical: number;
          qty_accepted: number;
          qty_rejected: number;
          decision: GrnLineDecision;
          reject_reason: RejectReason | null;
          still_quarantined: number;
          still_rejected: number;
        }[];
      };
      /** PRD section 7.2 — waste disposal and used cooking oil, as a view of dispatch. */
      list_waste_register: {
        Args: { p_property_id: string; p_from?: string | null; p_to?: string | null };
        Returns: {
          dispatched_at: string;
          dispatch_no: string;
          dispatch_type: DispatchType;
          reason_code: string | null;
          recipient_name: string | null;
          recipient_fssai: string | null;
          item_code: string;
          item_name: string;
          batch_no: string;
          qty: number;
          uom_code: string;
          gate_pass_no: string | null;
          left_at: string | null;
          carrier: string | null;
          vehicle_number: string | null;
          staged_by_name: string | null;
          verified_by_name: string | null;
        }[];
      };
      /** PRD section 7.5 forward trace, read off the append-only ledger. */
      trace_batch: {
        Args: { p_property_id: string; p_batch_id: string };
        Returns: {
          occurred_at: string;
          reason: MovementReason;
          qty: number;
          uom_code: string;
          from_code: string | null;
          from_name: string | null;
          from_state: StockState | null;
          to_code: string | null;
          to_name: string | null;
          to_state: StockState | null;
          scan_method: ScanMethod | null;
          recorded_by_name: string | null;
          note: string | null;
        }[];
      };
      /** Where a batch came from — the header a forward trace hangs under. */
      batch_provenance: {
        Args: { p_property_id: string; p_batch_id: string };
        Returns: {
          batch_no: string;
          is_system_generated: boolean;
          item_code: string;
          item_name: string;
          category_name: string;
          uom_code: string;
          best_before: string | null;
          mfg_date: string | null;
          receipt_temp_c: number | null;
          pct_at_receipt: number | null;
          dwell_breach: boolean;
          source: BatchSource;
          received_at: string | null;
          grn_no: string | null;
          gate_entry_no: string | null;
          arrived_at: string | null;
          vendor_name: string | null;
          vendor_code: string | null;
          vendor_fssai: string | null;
          decision: GrnLineDecision | null;
          reject_reason: RejectReason | null;
          qty_accepted: number | null;
          qty_rejected: number | null;
          received_by: string | null;
        }[];
      };
      /** Whether the caller may onboard customers. Answers only about the caller. */
      am_i_platform_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      /**
       * Every tenant, for the vendor console. The one function here that crosses the
       * tenancy boundary, guarded by the platform-admin check rather than by RLS.
       */
      list_tenants: {
        Args: Record<string, never>;
        Returns: {
          org_id: string;
          org_name: string;
          org_lifecycle: OrganisationLifecycle;
          property_id: string;
          property_code: string;
          property_name: string;
          property_lifecycle: PropertyLifecycle;
          created_at: string;
          people: number;
          items: number;
          bins: number;
          vendors: number;
          receipts: number;
          last_activity: string | null;
        }[];
      };
      /**
       * Issues a device a block of document numbers to spend offline (ADR 0005).
       * Blocks are carved from number_sequence, so leases and server-side allocation
       * cannot overlap.
       */
      lease_document_numbers: {
        Args: {
          p_property_id: string;
          p_doc_type: string;
          p_device_id: string;
          p_count: number;
        };
        Returns: {
          range_start: number;
          range_end: number;
          property_code: string;
        }[];
      };
      /**
       * The returnable register: everything out on a promise to come back, aged
       * against that promise. SECURITY INVOKER — reads only what RLS shows the caller.
       */
      list_returnables: {
        Args: { p_property_id: string };
        Returns: {
          returnable_id: string;
          dispatch_id: string;
          dispatch_no: string;
          dispatch_type: DispatchType;
          recipient_name: string | null;
          qty_out: number;
          qty_returned: number;
          outstanding: number;
          expected_return_date: string | null;
          days_overdue: number | null;
          staged_at: string;
          returned_at: string | null;
          condition_on_return: string | null;
        }[];
      };
      /** Receives a returnable back — partially or fully, with condition. */
      record_return: {
        Args: {
          p_property_id: string;
          p_returnable_id: string;
          p_qty: number;
          p_condition: string | null;
        };
        Returns: {
          qty_out: number;
          qty_returned: number;
          outstanding: number;
        }[];
      };
      /**
       * Every module with whether the caller may open it here. The navigation reads
       * this rather than recomputing the rule, so the app can only ever offer what
       * the server would allow.
       */
      my_module_access: {
        Args: { p_property_id: string };
        Returns: { module_key: ModuleKey; allowed: boolean }[];
      };
      /** The effective grid for one customer. Platform staff only; others get nothing. */
      platform_list_property_modules: {
        Args: { p_property_id: string };
        Returns: {
          module_key: ModuleKey;
          label: string;
          requires_licence: boolean;
          enabled: boolean;
          /** True when a row says so, rather than the default deciding. */
          is_explicit: boolean;
          note: string | null;
          changed_at: string | null;
        }[];
      };
      platform_set_property_module: {
        Args: {
          p_property_id: string;
          p_module_key: ModuleKey;
          p_enabled: boolean;
          p_note: string | null;
        };
        Returns: undefined;
      };
      /** Removes the explicit row, returning the module to its default. */
      platform_reset_property_module: {
        Args: { p_property_id: string; p_module_key: ModuleKey };
        Returns: undefined;
      };
      /** Everyone at the property against every module, for the access editor. */
      list_member_modules: {
        Args: { p_property_id: string };
        Returns: {
          user_id: string;
          module_key: ModuleKey;
          allowed: boolean;
          /** Whether a personal exception is what produced that answer. */
          is_override: boolean;
        }[];
      };
      /** Narrows one person. `p_allowed: null` clears the exception. */
      set_member_module: {
        Args: {
          p_property_id: string;
          p_user_id: string;
          p_module_key: ModuleKey;
          p_allowed: boolean | null;
        };
        Returns: undefined;
      };
      /** Creates a customer, a property and its first owner. Idempotent. */
      provision_tenant: {
        Args: {
          p_org_name: string;
          p_property_code: string;
          p_property_name: string;
          p_owner_user_id: string;
        };
        Returns: {
          property_id: string;
          property_code: string;
          org_id: string;
          was_new: boolean;
        }[];
      };
      set_property_lifecycle: {
        Args: { p_property_id: string; p_state: PropertyLifecycle };
        Returns: undefined;
      };
      /** Every figure the home screen shows, counted where the rows are. */
      property_overview: {
        Args: { p_property_id: string; p_nearing_days?: number };
        Returns: {
          items: number;
          locations: number;
          bins: number;
          vendors: number;
          vendors_on_hold: number;
          stock_lines: number;
          expired: number;
          expiring_soon: number;
          arrivals_waiting: number;
          arrivals_overdue: number;
          quarantine_lines: number;
          quarantine_oldest_hours: number | null;
          awaiting_gate_pass: number;
        }[];
      };
      /** Every lot holding stock, in every state. */
      list_stock_on_hand: {
        Args: { p_property_id: string; p_search?: string | null };
        Returns: {
          batch_id: string;
          batch_no: string;
          is_system_generated: boolean;
          item_id: string;
          item_name: string;
          item_code: string;
          category_name: string;
          uom_code: string;
          location_id: string;
          location_code: string;
          location_name: string;
          location_kind: LocationKind;
          state: StockState;
          qty: number;
          best_before: string | null;
          days_remaining: number | null;
          dwell_breach: boolean;
        }[];
      };
      /** Stock in QUARANTINE, with how long it has stood there. */
      list_awaiting_putaway: {
        Args: { p_property_id: string };
        Returns: {
          batch_id: string;
          batch_no: string;
          is_system_generated: boolean;
          item_id: string;
          item_name: string;
          item_code: string;
          storage_regime: StorageRegime;
          uom_id: string;
          uom_code: string;
          location_id: string;
          location_code: string;
          qty: number;
          best_before: string | null;
          received_at: string | null;
          hours_waiting: number | null;
        }[];
      };
      /** Arrivals with no receipt against them yet — the receiving worklist. */
      /**
       * Files an object, and points a person at their newest face.
       *
       * The PERSON/STAFF_PHOTO case also sets `person.photo_ref`, so the staff master the
       * device caches carries the key — criterion 18 asks for the face with no network,
       * and a lookup per scan would fail in exactly that condition.
       */
      attach_document: {
        Args: {
          p_property_id: string;
          p_entity_type: DocumentEntity;
          p_entity_id: string;
          p_kind: DocumentKind;
          p_sha256: string;
          p_mime_type: string;
          p_byte_size: number;
          /** Defaults by kind: a year for a face, two for flow evidence. */
          p_retention_until?: string | null;
        };
        Returns: string;
      };
      list_documents: {
        Args: {
          p_property_id: string;
          p_entity_type: DocumentEntity;
          p_entity_id: string;
        };
        Returns: {
          id: string;
          kind: DocumentKind;
          /** A key, not a URL: signed URLs expire and a record outlives several. */
          storage_key: string;
          mime_type: string;
          byte_size: number;
          captured_at: string;
          retention_until: string;
        }[];
      };
      create_person: {
        Args: {
          p_property_id: string;
          p_full_name: string;
          p_department_id?: string | null;
          p_user_id?: string | null;
        };
        Returns: { person_id: string; person_code: string }[];
      };
      set_person_active: {
        Args: {
          p_property_id: string;
          p_person_id: string;
          p_active: boolean;
          p_reason?: string | null;
        };
        Returns: undefined;
      };
      list_people: {
        Args: { p_property_id: string };
        Returns: {
          id: string;
          person_code: string;
          full_name: string;
          department_id: string | null;
          department_name: string | null;
          photo_ref: string | null;
          has_login: boolean;
          is_active: boolean;
          deactivated_at: string | null;
        }[];
      };
      list_open_gate_entries: {
        Args: { p_property_id: string };
        Returns: {
          id: string;
          gate_entry_no: string;
          timestamp_in: string;
          party_id: string | null;
          party_name: string | null;
          arrival_type: ArrivalType;
          package_count: number;
          vehicle_number: string | null;
          hours_open: number;
        }[];
      };
    };
    Enums: {
      organisation_lifecycle: OrganisationLifecycle;
      property_lifecycle: PropertyLifecycle;
      membership_role: MembershipRole;
      uom_kind: UomKind;
      storage_regime: StorageRegime;
      location_kind: LocationKind;
      enforcement_mode: EnforcementMode;
      scan_method: ScanMethod;
      document_entity: DocumentEntity;
      document_kind: DocumentKind;
    };
    CompositeTypes: Record<never, never>;
  };
};
