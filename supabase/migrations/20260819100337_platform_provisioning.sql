-- Onboarding a customer, from a screen.
--
-- `system.provision_property` has existed since Phase 1 and is service-role only, which
-- means every new customer is somebody opening the Supabase SQL editor and typing a
-- statement against the production database. That is fine for tenant one and a liability
-- by tenant five: it needs the production credentials in a person's hands, it has no
-- record of who onboarded whom, and the one time it is done at seven in the evening the
-- property code will have a typo in it.
--
-- ---------------------------------------------------------------------------
-- Why this needs a new idea of "who"
-- ---------------------------------------------------------------------------
--
-- Every authority in this system so far is per-property: `membership` says what you may
-- do at a hotel. Provisioning is the one act that happens BEFORE a property exists, so
-- there is no membership to check and no property to check it against.
--
-- Hence a platform administrator — us, the vendor, not the customer. Deliberately a
-- table of named people rather than a flag on a user or a role string: the question
-- "who can create tenants" should be answerable by reading one small table, and taking
-- somebody's access away should be a DELETE rather than an edit to a row that does
-- fifteen other things.

create table system.platform_admin (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  -- Why this person has it. An access list without reasons is one nobody dares prune.
  note       text
);

comment on table system.platform_admin is
  'Vendor staff who may create tenants. Not customer-facing and not a role: provisioning happens before any property exists, so there is no membership to check.';

/**
 * Whether the caller may provision.
 *
 * SECURITY DEFINER because `system` is unreachable from a client by design — the table
 * cannot be read directly, so this is the only way to ask, and it answers only about the
 * person asking.
 */
create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from system.platform_admin where user_id = (select auth.uid())
  );
$$;

revoke all on function app.is_platform_admin() from public, anon;
grant execute on function app.is_platform_admin() to authenticated;

-- Callable from the app so the console can decide whether to exist at all. It answers
-- only about the caller, so it leaks nothing: a property administrator asking gets false.
create or replace function public.am_i_platform_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app.is_platform_admin();
$$;

revoke all on function public.am_i_platform_admin() from public, anon;
grant execute on function public.am_i_platform_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- The tenant list
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER, and the one place in this codebase that deliberately reads across
-- every property. It exists because the vendor's question — "who are our customers and
-- how far has each one got" — cannot be answered from inside a tenancy boundary, which
-- is the whole point of the boundary.
--
-- Guarded by the platform-admin check as its first act, not by RLS. RLS would answer
-- "which properties may this user see", and the correct answer for this function is "all
-- of them, or none, depending on who is asking" — which is a different question and
-- deserves a different mechanism rather than a widened predicate. CLAUDE.md rule 2.

create or replace function public.list_tenants()
returns table (
  org_id            uuid,
  org_name          text,
  org_lifecycle     public.organisation_lifecycle,
  property_id       uuid,
  property_code     text,
  property_name     text,
  property_lifecycle public.property_lifecycle,
  created_at        timestamptz,
  people            integer,
  items             integer,
  bins              integer,
  vendors           integer,
  -- How far onboarding has actually got, which is the question behind the question.
  receipts          integer,
  last_activity     timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Only platform administrators can list tenants.' using errcode = '42501';
  end if;

  return query
    select
      o.id, o.name, o.lifecycle_state,
      p.id, p.code, p.name, p.lifecycle_state, p.created_at,
      (select count(distinct m.user_id)::int from public.membership m where m.property_id = p.id),
      (select count(*)::int from public.item i where i.property_id = p.id and i.is_active),
      (select count(*)::int from public.location l
        where l.property_id = p.id and l.is_active and l.kind = 'BIN'),
      (select count(*)::int from public.party v where v.property_id = p.id and v.is_active),
      (select count(*)::int from public.grn g where g.property_id = p.id),
      -- The most recent thing that happened. A tenant provisioned six weeks ago with no
      -- movements is a stalled onboarding, and it looks identical to a healthy one on
      -- every other column here.
      (select max(sm.occurred_at) from public.stock_movement sm where sm.property_id = p.id)
    from public.property p
    join public.organisation o on o.id = p.org_id
    order by o.name, p.code;
end;
$$;

revoke all on function public.list_tenants() from public, anon;
grant execute on function public.list_tenants() to authenticated;

comment on function public.list_tenants() is
  'Every tenant, for the vendor console. Guarded by the platform-admin check rather than by RLS: "all properties or none, depending who asks" is a different question from "which may this user see", and widening an RLS predicate to answer it is how a cross-tenant leak gets shipped.';

-- ---------------------------------------------------------------------------
-- Creating one
-- ---------------------------------------------------------------------------

create or replace function public.provision_tenant(
  p_org_name       text,
  p_property_code  text,
  p_property_name  text,
  /** Must already exist as a login. The edge function mints it first. */
  p_owner_user_id  uuid
)
returns table (property_id uuid, property_code text, org_id uuid, was_new boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid;
  v_property uuid;
  v_code     text;
  v_new      boolean := false;
begin
  if not app.is_platform_admin() then
    raise exception 'Only platform administrators can create tenants.' using errcode = '42501';
  end if;

  if p_org_name is null or length(trim(p_org_name)) = 0 then
    raise exception 'A customer needs a name.' using errcode = '23514';
  end if;

  v_code := upper(trim(coalesce(p_property_code, '')));

  -- Every location, document number and label at this property starts with it, and it is
  -- printed onto stickers that get glued to shelves. Renaming it later is a reprint and a
  -- walk round the store, so it is checked properly here rather than trimmed silently.
  -- The same expression as `property.code`'s own check constraint, deliberately. A
  -- looser one here would let a code through this friendly message and into a raw
  -- constraint violation, which is the worst of both: refused anyway, and unreadably.
  if v_code !~ '^[A-Z][A-Z0-9]{1,7}$' then
    raise exception 'A property code starts with a letter and is two to eight letters or digits — it begins every location code and every document number at this property.'
      using errcode = '23514';
  end if;

  if p_property_name is null or length(trim(p_property_name)) = 0 then
    raise exception 'A property needs a name.' using errcode = '23514';
  end if;

  perform 1 from auth.users where id = p_owner_user_id;
  if not found then
    raise exception 'That owner does not exist.' using errcode = '23503';
  end if;

  -- Matched by name, so the same customer name puts a second hotel in the same group and
  -- a different one creates a separate customer. That single argument is what makes
  -- hotels-in-a-group and independent-hotels the same code path (ADR 0002).
  select o.id into v_org from public.organisation o where o.name = trim(p_org_name);
  if v_org is null then
    insert into public.organisation (name, lifecycle_state)
    values (trim(p_org_name), 'ACTIVE')
    returning id into v_org;
  end if;

  -- Aliased throughout, because this function's OUT parameters are named `org_id`,
  -- `property_id` and `property_code` — every one of which is also a column on the tables
  -- below, and Postgres reports the collision at call time rather than at creation.
  select pr.id into v_property
    from public.property pr where pr.org_id = v_org and pr.code = v_code;

  if v_property is null then
    -- ONBOARDING, never LIVE. A property reaches LIVE when its readiness checklist passes
    -- (ADR 0010), and at this moment its item master is empty and it cannot receive
    -- anything at all.
    insert into public.property (org_id, code, name, lifecycle_state)
    values (v_org, v_code, trim(p_property_name), 'ONBOARDING')
    returning id into v_property;
    v_new := true;
  end if;

  insert into public.membership (user_id, org_id, property_id, role)
  values (p_owner_user_id, v_org, v_property, 'OWNER')
  on conflict do nothing;

  insert into public.membership (user_id, org_id, property_id, role)
  values (p_owner_user_id, v_org, v_property, 'ADMIN')
  on conflict do nothing;

  -- Units, categories, the location skeleton and the rule set. The departments and rule
  -- rows come from the AFTER INSERT trigger on property; masters are called explicitly
  -- because re-provisioning an existing property should top them up.
  perform system.seed_property_masters(v_property, v_code);

  return query select v_property, v_code, v_org, v_new;
end;
$$;

revoke all on function public.provision_tenant(text, text, text, uuid) from public, anon;
grant execute on function public.provision_tenant(text, text, text, uuid) to authenticated;

comment on function public.provision_tenant(text, text, text, uuid) is
  'Creates a customer, a property and its first owner. Idempotent: re-running tops up the seed masters rather than failing, because partial failure and re-run is the normal case in provisioning.';

/**
 * Moves a property along its lifecycle.
 *
 * Separate from provisioning because the two are different decisions weeks apart. A
 * property is ONBOARDING while its item master is being built and reaches LIVE when
 * somebody has checked it can actually receive — which is a judgement, not a side effect
 * of a row being created.
 */
create or replace function public.set_property_lifecycle(
  p_property_id uuid,
  p_state       public.property_lifecycle
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Only platform administrators can change a property''s lifecycle.'
      using errcode = '42501';
  end if;

  -- `property_live_has_go_live_date` refuses LIVE without a date, so setting the state
  -- alone raised a constraint violation naming the constraint. Coalesced rather than
  -- overwritten: a property suspended and brought back was still live the first time, and
  -- that date is the one an audit asks for.
  update public.property
     set lifecycle_state = p_state,
         went_live_at = case when p_state = 'LIVE' then coalesce(went_live_at, now())
                             else went_live_at end
   where id = p_property_id;

  -- CLAUDE.md rule 4b: an UPDATE that matches nothing succeeds having done nothing, and
  -- a console reporting success for a property id that does not exist is worse than an
  -- error.
  if not found then
    raise exception 'No such property.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.set_property_lifecycle(uuid, public.property_lifecycle)
  from public, anon;
grant execute on function public.set_property_lifecycle(uuid, public.property_lifecycle)
  to authenticated;

-- ---------------------------------------------------------------------------
-- The first platform administrator
-- ---------------------------------------------------------------------------
--
-- Chicken and egg: the console cannot grant the access that lets somebody use the
-- console. This is the one statement that has to be run by hand, once, against the
-- production database — and stating it here rather than in a README means it travels
-- with the schema that needs it.
--
--   insert into system.platform_admin (user_id, note)
--   select id, 'Founder' from auth.users where email = 'you@example.com';
--
-- Nothing is inserted here. A seeded admin would be a back door that ships in the
-- migration history of every deployment, including a customer's own if this is ever
-- deployed dedicated (CLAUDE.md rule 5).
