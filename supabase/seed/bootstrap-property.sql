-- One-time bootstrap: create an organisation, a property, your membership, and the
-- reference data a property cannot function without.
--
-- Run this ONCE in the Supabase SQL editor, after creating your user in
-- Authentication -> Users.
--
-- This exists because there is no provisioning job yet. ADR 0010 says provisioning
-- must eventually be one idempotent, versioned, tested function - `provision_property`
-- - rather than a human running SQL. This script is the honest interim: it does the
-- same work, is safe to run twice, and is the thing that function will be built from.
--
-- It is NOT a migration. Migrations describe schema; this creates tenant data, and a
-- migration cannot know which properties will exist.

-- ===========================================================================
-- EDIT THESE THREE LINES, then run the whole file.
-- ===========================================================================
\set admin_email      '''you@example.com'''
\set property_code    '''SB'''
\set property_name    '''Voyage The Solitaire Bliss'''
-- ===========================================================================

do $$
declare
  v_user_id     uuid;
  v_org_id      uuid;
  v_property_id uuid;
  v_admin_email text := :admin_email;
  v_code        text := :property_code;
  v_name        text := :property_name;
begin
  select id into v_user_id from auth.users where email = v_admin_email;
  if v_user_id is null then
    raise exception
      'No user with email %. Create one first: Authentication -> Users -> Add user, '
      'and tick "Auto Confirm User" or the login will silently fail.', v_admin_email;
  end if;

  -- Organisation. A single independent hotel is an organisation of one (ADR 0002).
  select id into v_org_id from public.organisation where name = v_name;
  if v_org_id is null then
    insert into public.organisation (name, lifecycle_state)
    values (v_name, 'ACTIVE')
    returning id into v_org_id;
  end if;

  -- Property. THE data boundary: every domain row carries its id, and RLS is scoped
  -- to it. Left in ONBOARDING deliberately - a property reaches LIVE only when the
  -- readiness checklist passes (ADR 0010), and the item master is still empty.
  select id into v_property_id
    from public.property where org_id = v_org_id and code = v_code;
  if v_property_id is null then
    insert into public.property (org_id, code, name, lifecycle_state)
    values (v_org_id, v_code, v_name, 'ONBOARDING')
    returning id into v_property_id;
  end if;

  -- Membership. Without this the login succeeds and the app shows nothing at all,
  -- because every read policy resolves through app.accessible_properties().
  insert into public.membership (user_id, org_id, property_id, role)
  values (v_user_id, v_org_id, v_property_id, 'OWNER')
  on conflict do nothing;

  insert into public.membership (user_id, org_id, property_id, role)
  values (v_user_id, v_org_id, v_property_id, 'ADMIN')
  on conflict do nothing;

  -- Units of measure. Local units are first-class here, not an afterthought: a bora
  -- is 25 or 50 kg, eggs come by the peti, oil by the 15 L tin (PRD section 10).
  insert into public.uom (property_id, code, name, kind) values
    (v_property_id, 'KG',       'Kilogram',   'WEIGHT'),
    (v_property_id, 'G',        'Gram',       'WEIGHT'),
    (v_property_id, 'L',        'Litre',      'VOLUME'),
    (v_property_id, 'ML',       'Millilitre', 'VOLUME'),
    (v_property_id, 'PC',       'Piece',      'COUNT'),
    (v_property_id, 'BORA',     'Bora (sack)','COUNT'),
    (v_property_id, 'PETI',     'Peti (crate)','COUNT'),
    (v_property_id, 'TIN',      'Tin',        'COUNT'),
    (v_property_id, 'CRATE',    'Crate',      'COUNT'),
    (v_property_id, 'CYL',      'Cylinder',   'COUNT')
  on conflict (property_id, code) do nothing;

  -- Categories, carrying the minimum shelf-life defaults from PRD section 4. Held as
  -- data because a property adjusts them; an item may override its category.
  insert into public.item_category
    (property_id, code, name, default_min_shelf_life_pct, default_storage_regime) values
    (v_property_id, 'DAIRY',     'Dairy',                60.00, 'CHILLED'),
    (v_property_id, 'BAKERY',    'Bakery',               60.00, 'AMBIENT'),
    (v_property_id, 'MEAT',      'Chilled meat and poultry', 70.00, 'CHILLED'),
    (v_property_id, 'FISH',      'Fish and seafood',     70.00, 'CHILLED'),
    (v_property_id, 'FROZEN',    'Frozen',               75.00, 'FROZEN'),
    (v_property_id, 'PACKAGED',  'Packaged and tinned',  75.00, 'AMBIENT'),
    (v_property_id, 'PROVISIONS','Dry provisions',       70.00, 'AMBIENT'),
    (v_property_id, 'PRODUCE',   'Fresh produce',        null,  'CHILLED'),
    (v_property_id, 'BEVERAGE',  'Beverages',            null,  'AMBIENT'),
    (v_property_id, 'BAR',       'Bar stock',            null,  'AMBIENT'),
    (v_property_id, 'CHEMICAL',  'Housekeeping chemicals', null,'AMBIENT'),
    (v_property_id, 'ENGSPARE',  'Engineering spares',   null,  'AMBIENT')
  on conflict (property_id, code) do nothing;

  -- The location skeleton from PRD section 3.1. SB-SEC holds nothing but every
  -- movement references it. Zones are added by the property.
  insert into public.location (property_id, code, name, kind, regime) values
    (v_property_id, v_code || '-SEC',     'Security gate',        'SECURITY',  'AMBIENT'),
    (v_property_id, v_code || '-T1-RCV',  'Terminal 1 receiving', 'RECEIVING', 'AMBIENT'),
    (v_property_id, v_code || '-T1-REJ',  'Rejected goods hold',  'REJECT',    'AMBIENT'),
    (v_property_id, v_code || '-T2-DSP',  'Terminal 2 dispatch',  'DISPATCH',  'AMBIENT'),
    (v_property_id, v_code || '-DRY',     'Dry store',            'ZONE',      'AMBIENT'),
    (v_property_id, v_code || '-CHILL',   'Cold room',            'ZONE',      'CHILLED'),
    (v_property_id, v_code || '-FREEZE',  'Freezer',              'ZONE',      'FROZEN')
  on conflict (property_id, code) do nothing;

  -- Every rule ships RECORD_ONLY with no UI to change it (PRD section 8). Ratcheting
  -- upward is a dated management decision at P2, never a deployment default.
  insert into public.rule_config (property_id, rule_key, enforcement_mode, reason) values
    (v_property_id, 'MIN_SHELF_LIFE_AT_RECEIPT', 'RECORD_ONLY', 'Ships record-only per PRD section 8'),
    (v_property_id, 'EXPIRED_STOCK_CANNOT_ISSUE', 'RECORD_ONLY', 'Ships record-only per PRD section 8')
  on conflict (property_id, rule_key, category_id) do nothing;

  raise notice 'Bootstrapped property % (%) for %', v_name, v_property_id, v_admin_email;
end $$;
