-- Master data: isolation, write authority, and the constraints that keep the item
-- master trustworthy.
--
-- The sweep in 001 already proves every new table has RLS and a policy. This file
-- proves the policies say what they are meant to say — which the sweep cannot know.

begin;
select plan(12);

-- ---------------------------------------------------------------------------
-- Fixture: two organisations, two properties, three users with different authority
-- ---------------------------------------------------------------------------

insert into public.organisation (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Solitaire Hospitality Group'),
  ('00000000-0000-0000-0000-0000000000b1', 'Brahmaputra Hotels');

insert into public.property (id, org_id, code, name) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'SB', 'Voyage The Solitaire Bliss'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1', 'BR', 'Brahmaputra Riverside');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.sb@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.sb@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.br@example.test', '', now(), now());

insert into public.membership (user_id, org_id, property_id, role) values
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'STOREKEEPER'),
  ('00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'ADMIN');

-- Masters for both properties, inserted as the system.
insert into public.uom (id, property_id, code, name, kind) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a2', 'KG', 'Kilogram', 'WEIGHT'),
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-0000000000b2', 'KG', 'Kilogram', 'WEIGHT');

insert into public.item_category (id, property_id, code, name, default_min_shelf_life_pct, default_storage_regime) values
  ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-0000000000a2', 'DAIRY', 'Dairy', 60.00, 'CHILLED'),
  ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-0000000000b2', 'DAIRY', 'Dairy', 60.00, 'CHILLED');

insert into public.item (id, property_id, code, name, category_id, base_uom_id,
                        is_perishable, is_batch_controlled, shelf_life_days, storage_regime)
values
  ('00000000-0000-0000-0000-00000000a301', '00000000-0000-0000-0000-0000000000a2', 'MILK-1L', 'Toned Milk 1L',
   '00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-00000000a101', true, true, 5, 'CHILLED'),
  ('00000000-0000-0000-0000-00000000b301', '00000000-0000-0000-0000-0000000000b2', 'MILK-1L', 'Toned Milk 1L',
   '00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-00000000b101', true, true, 5, 'CHILLED');

-- ---------------------------------------------------------------------------
-- Isolation, and that grants actually permit the read
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f001","role":"authenticated"}';

select results_eq(
  'select code from public.item order by code',
  array['MILK-1L'],
  'an administrator reads their own property''s items'
);

select is(
  (select count(*)::int from public.item where property_id = '00000000-0000-0000-0000-0000000000b2'),
  0,
  'and none of another organisation''s items'
);

select results_eq(
  'select code from public.item_category order by code',
  array['DAIRY'],
  'categories are scoped to the property'
);

select results_eq(
  'select code from public.uom order by code',
  array['KG'],
  'units of measure are scoped to the property'
);

-- ---------------------------------------------------------------------------
-- Write authority
-- ---------------------------------------------------------------------------

select lives_ok(
  $q$ insert into public.item (property_id, code, name, category_id, base_uom_id)
      values ('00000000-0000-0000-0000-0000000000a2', 'RICE-25', 'Rice 25kg',
              '00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-00000000a101') $q$,
  'an administrator can create an item'
);

-- A property cannot be smuggled across a boundary by writing another property's id.
select throws_ok(
  $q$ insert into public.item (property_id, code, name, category_id, base_uom_id)
      values ('00000000-0000-0000-0000-0000000000b2', 'SNEAK', 'Sneaky item',
              '00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-00000000b101') $q$,
  '42501',
  null,
  'an administrator cannot create an item at another property'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f002","role":"authenticated"}';

select results_eq(
  'select code from public.item order by code',
  array['MILK-1L', 'RICE-25'],
  'a storekeeper can read the item master'
);

-- The item master is what receiving is checked against. If anyone with a login could
-- edit it, the Gate 2 rule that an item must already exist would mean nothing.
select throws_ok(
  $q$ insert into public.item (property_id, code, name, category_id, base_uom_id)
      values ('00000000-0000-0000-0000-0000000000a2', 'DOCK-MADE', 'Created at the dock',
              '00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-00000000a101') $q$,
  '42501',
  null,
  'a storekeeper cannot create an item'
);

select throws_ok(
  $q$ update public.item set name = 'Renamed' where code = 'MILK-1L' $q$,
  '42501',
  null,
  'a storekeeper cannot edit the item master'
);

reset role;

-- ---------------------------------------------------------------------------
-- Constraints that keep perishables computable
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$ insert into public.item (property_id, code, name, category_id, base_uom_id,
                               is_perishable, is_batch_controlled)
      values ('00000000-0000-0000-0000-0000000000a2', 'BAD-1', 'Perishable with no shelf life',
              '00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-00000000a101',
              true, true) $q$,
  '23514',
  null,
  'a perishable item must carry a shelf life'
);

select throws_ok(
  $q$ insert into public.item (property_id, code, name, category_id, base_uom_id, is_cold_chain)
      values ('00000000-0000-0000-0000-0000000000a2', 'BAD-2', 'Cold chain with no range',
              '00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-00000000a101',
              true) $q$,
  '23514',
  null,
  'a cold-chain item must carry a temperature range'
);

-- Expiry has nowhere to live on an item that is not batch controlled.
select throws_ok(
  $q$ insert into public.item (property_id, code, name, category_id, base_uom_id,
                               is_perishable, is_batch_controlled, shelf_life_days)
      values ('00000000-0000-0000-0000-0000000000a2', 'BAD-3', 'Perishable, not batch controlled',
              '00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-00000000a101',
              true, false, 5) $q$,
  '23514',
  null,
  'a perishable item must be batch controlled'
);

select * from finish();
rollback;
