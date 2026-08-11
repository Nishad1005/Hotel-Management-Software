-- Master data: units, categories, items, packs, locations, and rule configuration.
--
-- The item master is the gate on everything downstream. PRD section 4 Gate 2 makes it
-- a hard rule that an item must exist here before it can be received, with no creation
-- at the dock (CLAUDE.md rule 12). That is why this lands before receiving does.
--
-- Every table follows the Phase 1 pattern: property_id, RLS enabled and forced, a read
-- policy, and EXPLICIT GRANTS. RLS decides which rows; GRANT decides whether the role
-- may address the table at all, and it is checked first. Omitting grants raises
-- "permission denied" rather than returning nothing, which is how the tenancy
-- migration failed the first time it was tested.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

create type public.uom_kind as enum ('WEIGHT', 'VOLUME', 'COUNT');

-- Storage regime governs where stock may be put away. Chilled goods cannot go to an
-- ambient bin; PRD section 4 Gate 6 makes that a hard block with no override.
create type public.storage_regime as enum ('AMBIENT', 'CHILLED', 'FROZEN');

create type public.location_kind as enum (
  'SECURITY', -- SB-SEC, notional; holds nothing but every movement references it
  'RECEIVING', -- SB-T1-RCV
  'REJECT', -- SB-T1-REJ, physically segregated
  'ZONE', -- operating storage
  'DISPATCH' -- SB-T2-DSP
);

-- PRD section 8: every check carries a mode, not an on/off flag, and ships RECORD_ONLY.
-- The field must exist from day one; retrofitting it is a rewrite (CLAUDE.md rule 9).
create type public.enforcement_mode as enum ('RECORD_ONLY', 'WARN', 'BLOCK');

-- ---------------------------------------------------------------------------
-- Role helper
-- ---------------------------------------------------------------------------
--
-- Reading master data needs only membership. Writing it needs authority. Without this,
-- any authenticated user at a property could rewrite the item master, and the item
-- master is what receiving is checked against.

create or replace function app.has_property_role(
  target_property uuid,
  allowed public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.membership m
    join public.property p on p.org_id = m.org_id
    where m.user_id = (select auth.uid())
      and p.id = target_property
      and (m.property_id is null or m.property_id = p.id)
      and m.role = any(allowed)
  );
$$;

comment on function app.has_property_role(uuid, public.membership_role[]) is
  'Whether the current user holds any of these roles at this property. Used by write policies.';

revoke all on function app.has_property_role(uuid, public.membership_role[]) from public;
grant execute on function app.has_property_role(uuid, public.membership_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Units of measure
-- ---------------------------------------------------------------------------

create table public.uom (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.property (id) on delete cascade,
  code         text not null check (length(trim(code)) between 1 and 12),
  name         text not null check (length(trim(name)) > 0),
  kind         public.uom_kind not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),

  constraint uom_code_unique_per_property unique (property_id, code)
);

comment on table public.uom is
  'Units of measure. Local units matter here: bora, peti, tin (PRD section 10).';

create index uom_property_id_idx on public.uom (property_id);

-- ---------------------------------------------------------------------------
-- Item categories
-- ---------------------------------------------------------------------------

create table public.item_category (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.property (id) on delete cascade,
  code         text not null check (length(trim(code)) between 1 and 24),
  name         text not null check (length(trim(name)) > 0),
  -- Self-referencing, giving the Category -> Sub-category resolution the inspection
  -- template engine will later need (PRD section 4 Gate 3a).
  parent_id    uuid references public.item_category (id) on delete restrict,

  -- PRD section 4: dairy and bakery 60%, chilled meat and fish 70%, frozen and
  -- packaged 75%, dry provisions 70%. Held as data because a property adjusts these;
  -- an item may override its category.
  default_min_shelf_life_pct  numeric(5, 2) check (
    default_min_shelf_life_pct is null
    or (default_min_shelf_life_pct >= 0 and default_min_shelf_life_pct <= 100)
  ),
  default_storage_regime      public.storage_regime not null default 'AMBIENT',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),

  constraint item_category_code_unique_per_property unique (property_id, code),
  constraint item_category_not_own_parent check (id <> parent_id),
  -- A sub-category must belong to the same property as its parent.
  constraint item_category_property_id_id_unique unique (property_id, id)
);

create index item_category_property_id_idx on public.item_category (property_id);
create index item_category_parent_id_idx on public.item_category (parent_id);

-- ---------------------------------------------------------------------------
-- Locations
-- ---------------------------------------------------------------------------

create table public.location (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.property (id) on delete cascade,
  code         text not null check (length(trim(code)) between 1 and 48),
  name         text not null check (length(trim(name)) > 0),
  kind         public.location_kind not null,
  parent_id    uuid references public.location (id) on delete restrict,
  regime       public.storage_regime not null default 'AMBIENT',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),

  constraint location_code_unique_per_property unique (property_id, code),
  constraint location_not_own_parent check (id <> parent_id),
  constraint location_property_id_id_unique unique (property_id, id)
);

comment on table public.location is
  'The location tree from PRD section 3.1. SB-SEC holds nothing but every movement references it.';

create index location_property_id_idx on public.location (property_id);

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------

create table public.item (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.property (id) on delete cascade,
  code         text not null check (length(trim(code)) between 1 and 32),
  name         text not null check (length(trim(name)) > 0),
  category_id  uuid not null references public.item_category (id) on delete restrict,
  base_uom_id  uuid not null references public.uom (id) on delete restrict,

  is_perishable      boolean not null default false,
  is_cold_chain      boolean not null default false,
  is_batch_controlled boolean not null default false,

  -- Total shelf life from manufacture, used to compute remaining percentage.
  shelf_life_days    integer check (shelf_life_days is null or shelf_life_days > 0),
  -- Overrides the category default when set (PRD section 4 minimum shelf life).
  min_shelf_life_pct_at_receipt numeric(5, 2) check (
    min_shelf_life_pct_at_receipt is null
    or (min_shelf_life_pct_at_receipt >= 0 and min_shelf_life_pct_at_receipt <= 100)
  ),

  storage_regime     public.storage_regime not null default 'AMBIENT',
  temp_min_c         numeric(5, 2),
  temp_max_c         numeric(5, 2),
  default_location_id uuid references public.location (id) on delete set null,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint item_code_unique_per_property unique (property_id, code),
  constraint item_property_id_id_unique unique (property_id, id),

  -- A perishable with no shelf life cannot have its expiry computed, and a perishable
  -- that silently never expires is worse than a rejected form.
  constraint item_perishable_has_shelf_life
    check (not is_perishable or shelf_life_days is not null),

  -- Cold chain without a range means the probe reading at Gate 3 has nothing to be
  -- checked against.
  constraint item_cold_chain_has_range
    check (not is_cold_chain or (temp_min_c is not null and temp_max_c is not null)),

  constraint item_temp_range_ordered
    check (temp_min_c is null or temp_max_c is null or temp_min_c <= temp_max_c),

  -- Perishables are tracked by batch by definition; expiry has nowhere else to live.
  constraint item_perishable_is_batch_controlled
    check (not is_perishable or is_batch_controlled)
);

comment on table public.item is
  'The item master. Nothing can be received against an item that does not exist here (PRD section 4 Gate 2).';

create index item_property_id_idx on public.item (property_id);
create index item_category_id_idx on public.item (category_id);
-- Name search on the receiving and opening-stock screens.
create index item_name_search_idx on public.item using gin (to_tsvector('simple', name));

create trigger item_touch_updated_at
  before update on public.item
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Item packs — alternate receiving units
-- ---------------------------------------------------------------------------

create table public.item_pack (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.property (id) on delete cascade,
  item_id        uuid not null references public.item (id) on delete cascade,
  uom_id         uuid not null references public.uom (id) on delete restrict,
  -- 25 kg bora, 15 L tin, eggs by peti (PRD section 10). Gate 2 converts to base
  -- automatically, which is only possible because the factor lives here.
  factor_to_base numeric(14, 4) not null check (factor_to_base > 0),
  created_at     timestamptz not null default now(),

  constraint item_pack_unique_per_item_uom unique (item_id, uom_id)
);

create index item_pack_property_id_idx on public.item_pack (property_id);
create index item_pack_item_id_idx on public.item_pack (item_id);

-- ---------------------------------------------------------------------------
-- Rule configuration
-- ---------------------------------------------------------------------------

create table public.rule_config (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references public.property (id) on delete cascade,
  rule_key        text not null check (length(trim(rule_key)) > 0),
  category_id     uuid references public.item_category (id) on delete cascade,
  enforcement_mode public.enforcement_mode not null default 'RECORD_ONLY',
  threshold_value numeric(14, 4),
  reason          text,
  changed_by      uuid references auth.users (id) on delete set null,
  changed_at      timestamptz not null default now(),

  constraint rule_config_unique_per_scope unique nulls not distinct (property_id, rule_key, category_id)
);

comment on table public.rule_config is
  'Every check carries a mode, not an on/off flag (PRD section 8). Ships RECORD_ONLY with no UI to change it; the property ratchets rules upward later as a dated management decision.';

create index rule_config_property_id_idx on public.rule_config (property_id);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- Read for anyone with membership; write only for OWNER and ADMIN, enforced again by
-- policy below. Both layers are needed: the grant permits the verb, the policy
-- restricts the rows.

grant select on public.uom, public.item_category, public.location,
                public.item, public.item_pack, public.rule_config to authenticated;

grant insert, update, delete on public.uom, public.item_category, public.location,
                                public.item, public.item_pack to authenticated;

-- rule_config is not writable from the app at all yet. PRD section 8 is explicit that
-- rules ship RECORD_ONLY "with no UI to change it"; the dashboard that ratchets them
-- arrives at P2 as a deliberate management decision.
grant insert, update on public.rule_config to service_role;

grant all on public.uom, public.item_category, public.location,
             public.item, public.item_pack, public.rule_config to service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.uom             enable row level security;
alter table public.item_category   enable row level security;
alter table public.location        enable row level security;
alter table public.item            enable row level security;
alter table public.item_pack       enable row level security;
alter table public.rule_config     enable row level security;

alter table public.uom             force row level security;
alter table public.item_category   force row level security;
alter table public.location        force row level security;
alter table public.item            force row level security;
alter table public.item_pack       force row level security;
alter table public.rule_config     force row level security;

-- Read: any membership at the property.
create policy uom_select on public.uom
  for select to authenticated
  using (property_id in (select app.accessible_properties()));

create policy item_category_select on public.item_category
  for select to authenticated
  using (property_id in (select app.accessible_properties()));

create policy location_select on public.location
  for select to authenticated
  using (property_id in (select app.accessible_properties()));

create policy item_select on public.item
  for select to authenticated
  using (property_id in (select app.accessible_properties()));

create policy item_pack_select on public.item_pack
  for select to authenticated
  using (property_id in (select app.accessible_properties()));

create policy rule_config_select on public.rule_config
  for select to authenticated
  using (property_id in (select app.accessible_properties()));

-- Write: administrators only. `with check` on insert and on update guards the new row,
-- so a row cannot be moved to another property by editing property_id.
create policy uom_write on public.uom
  for all to authenticated
  using (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[]))
  with check (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[]));

create policy item_category_write on public.item_category
  for all to authenticated
  using (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[]))
  with check (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[]));

create policy location_write on public.location
  for all to authenticated
  using (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[]))
  with check (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[]));

create policy item_write on public.item
  for all to authenticated
  using (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[]))
  with check (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[]));

create policy item_pack_write on public.item_pack
  for all to authenticated
  using (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[]))
  with check (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[]));
