-- A row must never span two properties (CLAUDE.md non-negotiable 4).
--
-- Until the composite foreign keys landed, nothing enforced this. Every table carried
-- property_id and every policy checked it, but `batch_id references batch (id)` says
-- nothing about which property the batch belongs to. A stock_movement at property A
-- naming property B's batch satisfied the insert policy — which only asks whether the
-- caller may write to A — and every constraint in the database.
--
-- The attacker here is a member of P1 only, which is the realistic case and the one
-- that matters: the insert passes RLS because property_id is P1, and the reference is
-- what has to refuse it. The ids are handed to the statement directly, because RLS
-- would normally hide them; this proves the schema refuses the reference even when the
-- id is known, rather than relying on the id being hard to discover.

begin;
select plan(11);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000d301', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.p1@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000d302', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.p2@example.test', '', now(), now());

select system.provision_property('admin.p1@example.test', 'Group One', 'X1', 'Property One');
select system.provision_property('admin.p2@example.test', 'Group Two', 'X2', 'Property Two');

create temporary table ctx as
select
  (select id from public.property where code = 'X1')                                   as p1,
  (select id from public.property where code = 'X2')                                   as p2,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'X1' and c.code = 'DAIRY')                                         as cat1,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'X2' and c.code = 'DAIRY')                                         as cat2,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'X1' and u.code = 'L')                                             as uom1,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'X2' and u.code = 'L')                                             as uom2,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'X1' and l.code = 'X1-CHILL')                                      as chill1,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'X2' and l.code = 'X2-CHILL')                                      as chill2;

-- The temp table is owned by postgres and the statements below run as authenticated.
-- Without this they would fail on the FIXTURE rather than on what they are testing,
-- and every throws_ok would still pass — a denied read of ctx raises 42501, and a
-- foreign key violation raises 23503, so at least here the codes differ. The tests
-- below assert 23503 specifically for exactly that reason.
grant select on ctx to authenticated;

-- Fixture: one item and one batch at each property, created as the superuser.
insert into public.item (id, property_id, code, name, category_id, base_uom_id,
                         is_perishable, is_batch_controlled, shelf_life_days, storage_regime)
select '00000000-0000-0000-0000-0000000d1001', p1, 'MILK-1L', 'Toned Milk 1L',
       cat1, uom1, true, true, 5, 'CHILLED' from ctx;

insert into public.item (id, property_id, code, name, category_id, base_uom_id,
                         is_perishable, is_batch_controlled, shelf_life_days, storage_regime)
select '00000000-0000-0000-0000-0000000d2001', p2, 'MILK-1L', 'Toned Milk 1L',
       cat2, uom2, true, true, 5, 'CHILLED' from ctx;

insert into public.batch (id, property_id, item_id, batch_no, best_before,
                          shelf_life_total_days, source)
select '00000000-0000-0000-0000-0000000d1002', p1, '00000000-0000-0000-0000-0000000d1001',
       'P1-A', current_date + 3, 5, 'OPENING_STOCK' from ctx;

insert into public.batch (id, property_id, item_id, batch_no, best_before,
                          shelf_life_total_days, source)
select '00000000-0000-0000-0000-0000000d2002', p2, '00000000-0000-0000-0000-0000000d2001',
       'P2-A', current_date + 3, 5, 'OPENING_STOCK' from ctx;

-- ---------------------------------------------------------------------------
-- As an administrator at P1, and only P1
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d301","role":"authenticated"}';

-- The control. If this fails, the constraints are refusing everything and the tests
-- below prove nothing.
select lives_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason,
         idempotency_key)
      select p1, '00000000-0000-0000-0000-0000000d1002', '00000000-0000-0000-0000-0000000d1001',
             chill1, 'AVAILABLE', 10, uom1, 'OPENING_STOCK', 'own-property-1' from ctx $q$,
  'a movement entirely within one property is accepted'
);

select throws_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason,
         idempotency_key)
      select p1, '00000000-0000-0000-0000-0000000d2002', '00000000-0000-0000-0000-0000000d1001',
             chill1, 'AVAILABLE', 10, uom1, 'OPENING_STOCK', 'foreign-batch' from ctx $q$,
  '23503',
  null,
  'but it cannot name another property''s batch'
);

select throws_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason,
         idempotency_key)
      select p1, '00000000-0000-0000-0000-0000000d1002', '00000000-0000-0000-0000-0000000d2001',
             chill1, 'AVAILABLE', 10, uom1, 'OPENING_STOCK', 'foreign-item' from ctx $q$,
  '23503',
  null,
  'nor another property''s item'
);

select throws_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason,
         idempotency_key)
      select p1, '00000000-0000-0000-0000-0000000d1002', '00000000-0000-0000-0000-0000000d1001',
             chill2, 'AVAILABLE', 10, uom1, 'OPENING_STOCK', 'foreign-location' from ctx $q$,
  '23503',
  null,
  'nor another property''s location'
);

-- The gap that let an item at one property take its base unit from another. `uom` was
-- the only referenced table without a (property_id, id) unique constraint.
select throws_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason,
         idempotency_key)
      select p1, '00000000-0000-0000-0000-0000000d1002', '00000000-0000-0000-0000-0000000d1001',
             chill1, 'AVAILABLE', 10, uom2, 'OPENING_STOCK', 'foreign-uom' from ctx $q$,
  '23503',
  null,
  'nor another property''s unit of measure'
);

select throws_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, from_location_id, from_state, qty, uom_id, reason,
         idempotency_key)
      select p1, '00000000-0000-0000-0000-0000000d1002', '00000000-0000-0000-0000-0000000d1001',
             chill2, 'AVAILABLE', 1, uom1, 'ISSUE', 'foreign-from-location' from ctx $q$,
  '23503',
  null,
  'and the same holds for the source location, not only the destination'
);

-- ---------------------------------------------------------------------------
-- The masters, where the bad reference would be created in the first place
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$ insert into public.item (property_id, code, name, category_id, base_uom_id)
      select p1, 'CROSS-CAT', 'Category from elsewhere', cat2, uom1 from ctx $q$,
  '23503',
  null,
  'an item cannot sit in another property''s category'
);

select throws_ok(
  $q$ insert into public.item (property_id, code, name, category_id, base_uom_id)
      select p1, 'CROSS-UOM', 'Unit from elsewhere', cat1, uom2 from ctx $q$,
  '23503',
  null,
  'nor measure itself in another property''s unit'
);

select throws_ok(
  $q$ insert into public.item (property_id, code, name, category_id, base_uom_id,
                               default_location_id)
      select p1, 'CROSS-LOC', 'Default bin elsewhere', cat1, uom1, chill2 from ctx $q$,
  '23503',
  null,
  'nor default to another property''s bin'
);

select throws_ok(
  $q$ insert into public.batch (property_id, item_id, batch_no, source)
      select p1, '00000000-0000-0000-0000-0000000d2001', 'CROSS-BATCH', 'OPENING_STOCK'
      from ctx $q$,
  '23503',
  null,
  'a batch cannot be of another property''s item'
);

select throws_ok(
  $q$ insert into public.location (property_id, code, name, kind, parent_id)
      select p1, 'CROSS-PARENT', 'Nested elsewhere', 'ZONE', chill2 from ctx $q$,
  '23503',
  null,
  'and the location tree cannot be grafted onto another property''s branch'
);

reset role;
select * from finish();
rollback;
