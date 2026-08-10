-- Tenancy foundation: organisation -> property -> membership.
--
-- The property is the data boundary, not the organisation. A storekeeper at one
-- property must not see a sister property's stock even when one group owns both.
-- Group-level people get their breadth from additional membership rows, never from
-- a wider RLS predicate. See docs/decisions/0002-org-property-hierarchy.md.

-- ---------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------

-- Helper functions consulted by RLS policies. Deliberately NOT `public`: schemas
-- outside the exposed list are unreachable through PostgREST, so these cannot be
-- called by a client. Deliberately NOT `auth`: that schema is managed by Supabase
-- and our objects there could be dropped by a platform upgrade.
create schema if not exists app;

comment on schema app is
  'Internal helpers for RLS and shared logic. Never exposed through the API.';

revoke all on schema app from public;

-- `authenticated` needs USAGE because RLS policies call app.accessible_*().
-- `service_role` is deliberately excluded: it bypasses RLS entirely, so it has no
-- business calling helpers that exist to scope a user to their own properties.
-- Privileged system work belongs in the `system` schema, in reviewed SECURITY
-- DEFINER functions that take property_id explicitly (CLAUDE.md rule 3).
-- `anon` is excluded because nothing unauthenticated reads tenant data.
grant usage on schema app to authenticated;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

-- Suspension is read-only but devices keep capturing: a billing dispute must never
-- cause a hotel to lose gate records. See docs/decisions/0012.
create type public.organisation_lifecycle as enum (
  'TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CHURNED', 'PURGED'
);

-- A property cannot reach LIVE until the readiness checklist passes. See
-- docs/decisions/0010-sales-led-scripted-provisioning.md.
create type public.property_lifecycle as enum (
  'PROVISIONING', 'ONBOARDING', 'LIVE', 'SUSPENDED', 'CHURNED', 'PURGED'
);

-- Roles follow PRD section 11.
create type public.membership_role as enum (
  'OWNER',        -- billing and organisation administration
  'ADMIN',        -- property administration, builds inspection templates
  'GM',           -- overrides, high-value gate passes, enforcement modes
  'SECURITY',     -- Gate 0 and Gate 10 only
  'STOREKEEPER',  -- Gates 1-9 and 11, the primary operator inside the property
  'CHEF',         -- perishable quality sign-off, receives issues
  'FSO',          -- food safety officer; can place a batch on BLOCKED
  'PURCHASE',     -- variance approval, supplier returns
  'BANQUET',      -- outdoor catering despatch and returnables
  'AUDITOR'       -- read-only, full trail including every override
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.organisation (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(trim(name)) > 0),
  gstin             text,
  plan              text not null default 'trial',
  lifecycle_state   public.organisation_lifecycle not null default 'TRIAL',
  dpa_signed_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.organisation is
  'Billing and subscription boundary. A single independent hotel is an organisation of one.';

create table public.property (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisation (id) on delete restrict,
  -- Short code used as the prefix on every location and document number: SB-SEC,
  -- SB-VEN-0042, SB-EMP-0117.
  code              text not null check (code ~ '^[A-Z][A-Z0-9]{1,7}$'),
  name              text not null check (length(trim(name)) > 0),
  timezone          text not null default 'Asia/Kolkata',
  lifecycle_state   public.property_lifecycle not null default 'PROVISIONING',
  went_live_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint property_code_unique_per_org unique (org_id, code),
  -- Lets membership carry a composite foreign key, so a membership row can never
  -- pair an organisation with a property belonging to a different one.
  constraint property_org_id_id_unique unique (org_id, id),
  constraint property_live_has_go_live_date
    check (lifecycle_state <> 'LIVE' or went_live_at is not null)
);

comment on table public.property is
  'THE data boundary. Every domain table references property_id, and RLS is scoped to it.';

create index property_org_id_idx on public.property (org_id);

create table public.membership (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  org_id        uuid not null references public.organisation (id) on delete cascade,
  -- NULL means organisation-wide: every property in the group, including ones
  -- created later. Used for a group GM or a group auditor.
  property_id   uuid references public.property (id) on delete cascade,
  role          public.membership_role not null,
  created_at    timestamptz not null default now(),

  -- MATCH SIMPLE: skipped entirely when property_id is NULL, which is exactly the
  -- organisation-wide case. When it is set, the property must belong to org_id.
  constraint membership_property_belongs_to_org
    foreign key (org_id, property_id) references public.property (org_id, id),

  -- NULLS NOT DISTINCT so a duplicate organisation-wide grant is rejected too;
  -- the default would treat every NULL property_id as unique.
  constraint membership_unique_grant
    unique nulls not distinct (user_id, org_id, property_id, role)
);

comment on table public.membership is
  'Grants a user access. Breadth comes from more rows here, never from a wider RLS predicate.';

create index membership_user_id_idx on public.membership (user_id);
create index membership_property_id_idx on public.membership (property_id);
create index membership_org_id_idx on public.membership (org_id);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organisation_touch_updated_at
  before update on public.organisation
  for each row execute function app.touch_updated_at();

create trigger property_touch_updated_at
  before update on public.property
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER so they can read membership without tripping membership's own
-- RLS, which would recurse. STABLE so Postgres evaluates them once per statement
-- rather than once per row. `set search_path = ''` forces full qualification and
-- closes the search-path hijack that SECURITY DEFINER otherwise exposes.

create or replace function app.accessible_properties()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.property p
  join public.membership m
    on m.org_id = p.org_id
   and (m.property_id is null or m.property_id = p.id)
  where m.user_id = (select auth.uid());
$$;

comment on function app.accessible_properties() is
  'Property IDs the current user may see. The canonical RLS predicate for every domain table.';

create or replace function app.accessible_organisations()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.org_id
  from public.membership m
  where m.user_id = (select auth.uid());
$$;

revoke all on function app.accessible_properties() from public;
revoke all on function app.accessible_organisations() from public;

-- Not granted to service_role. Both helpers resolve the *current user's* access via
-- auth.uid(), which is null for service_role, so the grant would be meaningless as
-- well as contrary to CLAUDE.md rule 3.
grant execute on function app.accessible_properties() to authenticated;
grant execute on function app.accessible_organisations() to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Read policies only, on purpose. Tenancy rows are written by the provisioning
-- job, not by clients (docs/decisions/0010). With no INSERT/UPDATE/DELETE policy,
-- RLS denies all three to ordinary roles, which is the behaviour we want.

alter table public.organisation enable row level security;
alter table public.property     enable row level security;
alter table public.membership   enable row level security;

-- Belt and braces: without FORCE, a future table owner would silently bypass RLS.
alter table public.organisation force row level security;
alter table public.property     force row level security;
alter table public.membership   force row level security;

-- Table privileges are a SEPARATE layer from RLS, and they are checked FIRST.
--
-- RLS decides which rows a role may see. GRANT decides whether it may address the
-- table at all. A table with RLS and policies but no GRANT does not return an empty
-- result - it raises "permission denied for table", which is what happened the first
-- time this migration was tested. Do not rely on Supabase's default privileges to
-- supply these; grant them explicitly, because a security boundary should be legible
-- in the migration that creates it.
--
-- SELECT only. Tenancy rows are written by the provisioning job (ADR 0010), so the
-- absence of INSERT/UPDATE/DELETE here is the intended deny - and it is a real one:
-- a missing UPDATE policy alone would silently affect zero rows rather than raise,
-- whereas a missing UPDATE privilege raises. `anon` is granted nothing at all.

grant select on public.organisation to authenticated;
grant select on public.property     to authenticated;
grant select on public.membership   to authenticated;

-- service_role bypasses RLS and is what the provisioning job runs as.
grant all on public.organisation to service_role;
grant all on public.property     to service_role;
grant all on public.membership   to service_role;

create policy organisation_select_own on public.organisation
  for select to authenticated
  using (id in (select app.accessible_organisations()));

create policy property_select_accessible on public.property
  for select to authenticated
  using (id in (select app.accessible_properties()));

create policy membership_select_self on public.membership
  for select to authenticated
  using (user_id = (select auth.uid()));
