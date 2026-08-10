-- Cross-tenant isolation, against the standard fixture: two organisations with two
-- properties each.
--
-- Every fixture in this repository is multi-tenant, so cross-tenant bugs surface by
-- themselves rather than having to be anticipated. Do not "simplify" this to one
-- organisation. See docs/decisions/0001-multi-tenant-from-day-one.md.
--
-- The interesting user is the third one: a group GM with an organisation-wide grant
-- (property_id IS NULL). They must see both of their group's properties and neither
-- of the other group's. That single row is where a careless RLS predicate leaks.

begin;
select plan(9);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into public.organisation (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Solitaire Hospitality Group'),
  ('00000000-0000-0000-0000-0000000000b1', 'Brahmaputra Hotels');

insert into public.property (id, org_id, code, name) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'SB',  'Voyage The Solitaire Bliss'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1', 'SD',  'Solitaire Dibrugarh'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1', 'BR',  'Brahmaputra Riverside'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b1', 'BG',  'Brahmaputra Guwahati');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'storekeeper.sb@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'storekeeper.br@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'group.gm@example.test',       '', now(), now());

insert into public.membership (user_id, org_id, property_id, role) values
  -- Storekeeper at one property only.
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'STOREKEEPER'),
  -- Storekeeper at a property in the other group.
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'STOREKEEPER'),
  -- Group GM: organisation-wide, so property_id is NULL.
  ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-0000000000a1', null, 'GM');

-- ---------------------------------------------------------------------------
-- A single-property storekeeper
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000e001","role":"authenticated"}';

select results_eq(
  'select code from public.property order by code',
  array['SB'],
  'a single-property storekeeper sees only their own property'
);

select is_empty(
  $q$ select code from public.property where org_id = '00000000-0000-0000-0000-0000000000b1' $q$,
  'a storekeeper sees nothing belonging to another organisation'
);

select results_eq(
  'select name from public.organisation order by name',
  array['Solitaire Hospitality Group'],
  'a storekeeper sees only their own organisation'
);

select is_empty(
  'select id::text from public.membership where user_id <> ''00000000-0000-0000-0000-00000000e001''',
  'a storekeeper cannot read anyone else''s membership rows'
);

-- Writes are reserved for the provisioning job; no policy grants them.
select throws_ok(
  $q$ insert into public.property (org_id, code, name)
      values ('00000000-0000-0000-0000-0000000000a1', 'XX', 'Rogue Property') $q$,
  '42501',
  null,
  'an authenticated user cannot create a property'
);

select throws_ok(
  $q$ update public.organisation set name = 'Renamed' $q$,
  '42501',
  null,
  'an authenticated user cannot rename their organisation'
);

-- ---------------------------------------------------------------------------
-- A storekeeper in the other group, to prove isolation runs both ways
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000e002","role":"authenticated"}';

select results_eq(
  'select code from public.property order by code',
  array['BR'],
  'isolation holds in both directions, not just for the first tenant'
);

-- ---------------------------------------------------------------------------
-- The group GM: organisation-wide grant
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000e003","role":"authenticated"}';

select results_eq(
  'select code from public.property order by code',
  array['SB', 'SD'],
  'an organisation-wide grant reaches every property in that group'
);

select is_empty(
  $q$ select code from public.property where org_id = '00000000-0000-0000-0000-0000000000b1' $q$,
  'an organisation-wide grant stops at the organisation boundary'
);

reset role;
select * from finish();
rollback;
