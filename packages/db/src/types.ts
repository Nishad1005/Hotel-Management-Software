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
    };
    CompositeTypes: Record<never, never>;
  };
};
