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
export type LocationKind = "SECURITY" | "RECEIVING" | "REJECT" | "ZONE" | "DISPATCH";
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
  | "DISPATCH_STAGING"
  | "WRITE_OFF_EXPIRED"
  | "WRITE_OFF_DAMAGED"
  | "CORRECTION";

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

export type DispatchNoteRow = {
  id: string;
  property_id: string;
  dispatch_no: string;
  dispatch_type: DispatchType;
  reason_code: string | null;
  origin_location_id: string | null;
  batch_id: string | null;
  item_id: string | null;
  qty: number | null;
  uom_id: string | null;
  recipient_party_id: string | null;
  is_returnable: boolean;
  expected_return_date: string | null;
  authorised_by: string | null;
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
  printed_at: string | null;
  created_at: string;
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
  idempotency_key: string;
  note: string | null;
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
        Insert: InsertOf<LocationRow, "parent_id" | "regime" | "is_active">;
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
          | "note"
        >;
        // Append-only in the database (ADR 0003). Declared for completeness; the
        // trigger refuses it.
        Update: Partial<StockMovementRow>;
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
    Functions: Record<never, never>;
    Enums: {
      organisation_lifecycle: OrganisationLifecycle;
      property_lifecycle: PropertyLifecycle;
      membership_role: MembershipRole;
      uom_kind: UomKind;
      storage_regime: StorageRegime;
      location_kind: LocationKind;
      enforcement_mode: EnforcementMode;
    };
    CompositeTypes: Record<never, never>;
  };
};
