-- Provisioning: bring a new property into existence, repeatably.
--
-- This is ADR 0010's `provision_property` arriving earlier than planned, because the
-- alternative - a hand-edited SQL script per hotel - does not survive the second one.
-- Properties will be added over time: more hotels, resorts, sister properties in the
-- same group. Adding one should be a single call, not an editing exercise.
--
-- Idempotent throughout. Partial failure and re-run is the normal case, not an edge
-- case, and a provisioning step that cannot be repeated safely gets run nervously.
--
-- Lives in a `system` schema: privileged operations that take their scope explicitly,
-- callable only by service_role, never exposed through PostgREST (CLAUDE.md rule 3).

create schema if not exists system;

comment on schema system is
  'Privileged operations. Never exposed through the API; service_role only.';

revoke all on schema system from public;
grant usage on schema system to service_role;

-- ---------------------------------------------------------------------------
-- provision_property
-- ---------------------------------------------------------------------------

create or replace function system.provision_property(
  p_admin_email    text,
  p_org_name       text,
  p_property_code  text,
  p_property_name  text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id     uuid;
  v_org_id      uuid;
  v_property_id uuid;
begin
  select id into v_user_id from auth.users where email = lower(trim(p_admin_email));
  if v_user_id is null then
    raise exception
      'No user with email %. Create one first under Authentication -> Users, and tick '
      '"Auto Confirm User" or sign-in will fail without explaining why.',
      p_admin_email;
  end if;

  -- Organisation is matched by name, so passing the same org name for a second
  -- property puts both in one group. A different name creates a separate customer.
  -- That single argument is what makes hotels-in-a-group and independent-hotels the
  -- same code path (ADR 0002).
  select id into v_org_id from public.organisation where name = p_org_name;
  if v_org_id is null then
    insert into public.organisation (name, lifecycle_state)
    values (p_org_name, 'ACTIVE')
    returning id into v_org_id;
  end if;

  -- Left in ONBOARDING, never LIVE. A property reaches LIVE only when the readiness
  -- checklist passes (ADR 0010), and at this point its item master is empty.
  select id into v_property_id
    from public.property
   where org_id = v_org_id and code = upper(trim(p_property_code));

  if v_property_id is null then
    insert into public.property (org_id, code, name, lifecycle_state)
    values (v_org_id, upper(trim(p_property_code)), p_property_name, 'ONBOARDING')
    returning id into v_property_id;
  end if;

  -- Without a membership row the login succeeds and the app is completely empty,
  -- because every read policy resolves through app.accessible_properties().
  insert into public.membership (user_id, org_id, property_id, role)
  values (v_user_id, v_org_id, v_property_id, 'OWNER')
  on conflict do nothing;

  insert into public.membership (user_id, org_id, property_id, role)
  values (v_user_id, v_org_id, v_property_id, 'ADMIN')
  on conflict do nothing;

  perform system.seed_property_masters(v_property_id, upper(trim(p_property_code)));

  return v_property_id;
end;
$$;

comment on function system.provision_property(text, text, text, text) is
  'Creates or updates an organisation, property, owner membership and seed masters. Idempotent. Returns the property id.';

-- ---------------------------------------------------------------------------
-- seed_property_masters
-- ---------------------------------------------------------------------------
--
-- Split out so masters can be re-seeded for an existing property without touching its
-- organisation or memberships - useful when a new default category is added later.

create or replace function system.seed_property_masters(
  p_property_id   uuid,
  p_property_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Local units are first class, not an afterthought: a bora is 25 or 50 kg, eggs come
  -- by the peti, oil by the 15 L tin (PRD section 10).
  insert into public.uom (property_id, code, name, kind) values
    (p_property_id, 'KG',    'Kilogram',      'WEIGHT'),
    (p_property_id, 'G',     'Gram',          'WEIGHT'),
    (p_property_id, 'L',     'Litre',         'VOLUME'),
    (p_property_id, 'ML',    'Millilitre',    'VOLUME'),
    (p_property_id, 'PC',    'Piece',         'COUNT'),
    (p_property_id, 'BORA',  'Bora (sack)',   'COUNT'),
    (p_property_id, 'PETI',  'Peti (crate)',  'COUNT'),
    (p_property_id, 'TIN',   'Tin',           'COUNT'),
    (p_property_id, 'CRATE', 'Crate',         'COUNT'),
    (p_property_id, 'CYL',   'Cylinder',      'COUNT')
  on conflict (property_id, code) do nothing;

  -- Minimum shelf-life defaults from PRD section 4. Held as data because a property
  -- adjusts them, and an item may override its category.
  insert into public.item_category
    (property_id, code, name, default_min_shelf_life_pct, default_storage_regime) values
    (p_property_id, 'DAIRY',      'Dairy',                    60.00, 'CHILLED'),
    (p_property_id, 'BAKERY',     'Bakery',                   60.00, 'AMBIENT'),
    (p_property_id, 'MEAT',       'Chilled meat and poultry', 70.00, 'CHILLED'),
    (p_property_id, 'FISH',       'Fish and seafood',         70.00, 'CHILLED'),
    (p_property_id, 'FROZEN',     'Frozen',                   75.00, 'FROZEN'),
    (p_property_id, 'PACKAGED',   'Packaged and tinned',      75.00, 'AMBIENT'),
    (p_property_id, 'PROVISIONS', 'Dry provisions',           70.00, 'AMBIENT'),
    (p_property_id, 'PRODUCE',    'Fresh produce',            null,  'CHILLED'),
    (p_property_id, 'BEVERAGE',   'Beverages',                null,  'AMBIENT'),
    (p_property_id, 'BAR',        'Bar stock',                null,  'AMBIENT'),
    (p_property_id, 'CHEMICAL',   'Housekeeping chemicals',   null,  'AMBIENT'),
    (p_property_id, 'LINEN',      'Linen',                    null,  'AMBIENT'),
    (p_property_id, 'ENGSPARE',   'Engineering spares',       null,  'AMBIENT')
  on conflict (property_id, code) do nothing;

  -- The location skeleton from PRD section 3.1, prefixed with the property code so
  -- two properties in one group never collide. Zones beyond these are the property's
  -- own; a resort's layout differs from a city hotel's.
  insert into public.location (property_id, code, name, kind, regime) values
    (p_property_id, p_property_code || '-SEC',    'Security gate',        'SECURITY',  'AMBIENT'),
    (p_property_id, p_property_code || '-T1-RCV', 'Terminal 1 receiving', 'RECEIVING', 'AMBIENT'),
    (p_property_id, p_property_code || '-T1-REJ', 'Rejected goods hold',  'REJECT',    'AMBIENT'),
    (p_property_id, p_property_code || '-T2-DSP', 'Terminal 2 dispatch',  'DISPATCH',  'AMBIENT'),
    (p_property_id, p_property_code || '-DRY',    'Dry store',            'ZONE',      'AMBIENT'),
    (p_property_id, p_property_code || '-CHILL',  'Cold room',            'ZONE',      'CHILLED'),
    (p_property_id, p_property_code || '-FREEZE', 'Freezer',              'ZONE',      'FROZEN')
  on conflict (property_id, code) do nothing;

  -- Every rule ships RECORD_ONLY with no UI to change it (PRD section 8). Ratcheting
  -- upward is a dated management decision at P2, never a deployment default.
  insert into public.rule_config (property_id, rule_key, enforcement_mode, reason) values
    (p_property_id, 'MIN_SHELF_LIFE_AT_RECEIPT',  'RECORD_ONLY', 'Ships record-only per PRD section 8'),
    (p_property_id, 'EXPIRED_STOCK_CANNOT_ISSUE', 'RECORD_ONLY', 'Ships record-only per PRD section 8')
  on conflict (property_id, rule_key, category_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- grant_property_role
-- ---------------------------------------------------------------------------
--
-- Needed the moment a second person joins: a storekeeper, a chef, an FSO. Separate
-- from provisioning because adding staff is routine while creating a property is not.

create or replace function system.grant_property_role(
  p_email          text,
  p_property_code  text,
  p_role           public.membership_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_prop    record;
begin
  select id into v_user_id from auth.users where email = lower(trim(p_email));
  if v_user_id is null then
    raise exception 'No user with email %. Create them under Authentication -> Users first.', p_email;
  end if;

  select id, org_id into v_prop
    from public.property where code = upper(trim(p_property_code));
  if v_prop.id is null then
    raise exception 'No property with code %.', p_property_code;
  end if;

  insert into public.membership (user_id, org_id, property_id, role)
  values (v_user_id, v_prop.org_id, v_prop.id, p_role)
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- service_role only. These functions write across the tenancy boundary by design,
-- which is precisely why no authenticated user may call them.

revoke all on function system.provision_property(text, text, text, text) from public;
revoke all on function system.seed_property_masters(uuid, text) from public;
revoke all on function system.grant_property_role(text, text, public.membership_role) from public;

grant execute on function system.provision_property(text, text, text, text) to service_role;
grant execute on function system.seed_property_masters(uuid, text) to service_role;
grant execute on function system.grant_property_role(text, text, public.membership_role) to service_role;
