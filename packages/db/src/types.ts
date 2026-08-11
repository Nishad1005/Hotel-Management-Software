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

export interface OrganisationRow {
  id: string;
  name: string;
  gstin: string | null;
  plan: string;
  lifecycle_state: OrganisationLifecycle;
  dpa_signed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PropertyRow {
  id: string;
  org_id: string;
  code: string;
  name: string;
  timezone: string;
  lifecycle_state: PropertyLifecycle;
  went_live_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MembershipRow {
  id: string;
  user_id: string;
  org_id: string;
  property_id: string | null;
  role: MembershipRole;
  created_at: string;
}

export interface UomRow {
  id: string;
  property_id: string;
  code: string;
  name: string;
  kind: UomKind;
  is_active: boolean;
  created_at: string;
}

export interface ItemCategoryRow {
  id: string;
  property_id: string;
  code: string;
  name: string;
  parent_id: string | null;
  default_min_shelf_life_pct: number | null;
  default_storage_regime: StorageRegime;
  is_active: boolean;
  created_at: string;
}

export interface LocationRow {
  id: string;
  property_id: string;
  code: string;
  name: string;
  kind: LocationKind;
  parent_id: string | null;
  regime: StorageRegime;
  is_active: boolean;
  created_at: string;
}

export interface ItemRow {
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
}

export interface ItemPackRow {
  id: string;
  property_id: string;
  item_id: string;
  uom_id: string;
  factor_to_base: number;
  created_at: string;
}

export interface RuleConfigRow {
  id: string;
  property_id: string;
  rule_key: string;
  category_id: string | null;
  enforcement_mode: EnforcementMode;
  threshold_value: number | null;
  reason: string | null;
  changed_by: string | null;
  changed_at: string;
}

/**
 * Columns the database fills in. Modelled explicitly rather than making everything
 * optional, so an insert that forgets a required column fails to compile instead of
 * failing at runtime against a NOT NULL constraint.
 */
type Generated = "id" | "created_at" | "updated_at";

type InsertOf<T, Optional extends keyof T = never> = Omit<T, Generated | Optional> &
  Partial<Pick<T, Extract<Generated | Optional, keyof T>>>;

export interface Database {
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
}
