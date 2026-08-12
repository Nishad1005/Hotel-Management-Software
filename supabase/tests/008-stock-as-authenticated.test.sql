-- Recording stock AS A SIGNED-IN USER, not as postgres.
--
-- This file exists because of a bug the rest of the suite could not see. 007 proved
-- the ledger's logic while running as the superuser, which holds every grant. The
-- first real user to record opening stock got "permission denied": the movement was
-- allowed, but its trigger — maintaining stock_lot as SECURITY INVOKER — was not,
-- because `authenticated` has only SELECT on the projection.
--
-- The lesson generalises. A test that runs as postgres proves the logic and nothing
-- about the permissions. Anything a user is meant to do should be tested as that user.

begin;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000f201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.one@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000f202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000f203', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.one@example.test', '', now(), now());

-- The property is provisioned by an ADMIN, who is a different person from the
-- storekeeper. provision_property makes whoever it is given OWNER and ADMIN, so
-- provisioning as the storekeeper and then granting STOREKEEPER on top would produce
-- an "storekeeper" who is also an owner — and the authority tests below would pass
-- while proving nothing.
select system.provision_property('admin.one@example.test', 'Group One', 'P1', 'Property One');
select system.provision_property('outsider@example.test', 'Group Two', 'P2', 'Property Two');

-- Recording stock is the job of the person doing the work, and must not require the
-- authority to edit the master it is recorded against.
select system.grant_property_role('store.one@example.test', 'P1', 'STOREKEEPER');

create temporary table ctx as
select
  (select id from public.property where code = 'P1')                                   as prop,
  (select id from public.property where code = 'P2')                                   as other_prop,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'P1' and c.code = 'DAIRY')                                         as cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'P1' and u.code = 'L')                                             as uom,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'P1' and l.code = 'P1-CHILL')                                      as chill;

-- The fixture table is owned by postgres, and the tests below run as `authenticated`.
-- Without this the statements fail on the FIXTURE rather than on what they are meant to
-- test — and worse, the throws_ok cases still pass, because a denied read of ctx raises
-- 42501 exactly like the denial they are looking for. A test passing for the wrong
-- reason is worse than one that fails.
grant select on ctx to authenticated;

insert into public.item (id, property_id, code, name, category_id, base_uom_id,
                         is_perishable, is_batch_controlled, shelf_life_days, storage_regime)
select '00000000-0000-0000-0000-0000000a2001', prop, 'MILK-1L', 'Toned Milk 1L',
       cat, uom, true, true, 5, 'CHILLED' from ctx;

-- ---------------------------------------------------------------------------
-- As the storekeeper
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f201","role":"authenticated"}';

select lives_ok(
  $q$ insert into public.batch (id, property_id, item_id, batch_no, best_before,
                                shelf_life_total_days, source)
      select '00000000-0000-0000-0000-0000000b2001', prop, '00000000-0000-0000-0000-0000000a2001',
             'OPEN-A', current_date + 2, 5, 'OPENING_STOCK' from ctx $q$,
  'a storekeeper can create a batch'
);

-- The failing case. The insert is permitted; the trigger maintaining stock_lot is the
-- part that was refused.
select lives_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason,
         idempotency_key)
      select prop, '00000000-0000-0000-0000-0000000b2001', '00000000-0000-0000-0000-0000000a2001',
             chill, 'AVAILABLE', 40, uom, 'OPENING_STOCK', 'auth-open-1' from ctx $q$,
  'and can record opening stock, trigger included'
);

select is(
  (select qty from public.stock_lot
    where batch_id = '00000000-0000-0000-0000-0000000b2001' and state = 'AVAILABLE'),
  40::numeric(14, 4),
  'the projection was maintained on their behalf'
);

select lives_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, from_location_id, from_state, qty, uom_id, reason,
         idempotency_key)
      select prop, '00000000-0000-0000-0000-0000000b2001', '00000000-0000-0000-0000-0000000a2001',
             chill, 'AVAILABLE', 10, uom, 'WRITE_OFF_EXPIRED', 'auth-writeoff-1' from ctx $q$,
  'and can write off expired stock'
);

select is(
  (select qty from public.stock_lot
    where batch_id = '00000000-0000-0000-0000-0000000b2001' and state = 'AVAILABLE'),
  30::numeric(14, 4),
  'which reduces what is on hand'
);

-- Recording stock must not require authority over the master it is recorded against.
select throws_ok(
  $q$ insert into public.item (property_id, code, name, category_id, base_uom_id)
      select prop, 'SNEAK', 'Created by a storekeeper', cat, uom from ctx $q$,
  '42501',
  null,
  'but still cannot create an item'
);

-- ---------------------------------------------------------------------------
-- The projection is derived, never written by hand
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$ insert into public.stock_lot (property_id, batch_id, location_id, state, qty)
      select prop, '00000000-0000-0000-0000-0000000b2001', chill, 'AVAILABLE', 9999 from ctx $q$,
  '42501',
  null,
  'a user cannot write stock_lot directly, which is what keeps it a projection'
);

-- ---------------------------------------------------------------------------
-- Isolation still holds for someone at another property
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f202","role":"authenticated"}';

select is(
  (select count(*)::int from public.stock_lot),
  0,
  'someone at another property sees none of this stock'
);

select throws_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason,
         idempotency_key)
      select prop, '00000000-0000-0000-0000-0000000b2001', '00000000-0000-0000-0000-0000000a2001',
             chill, 'AVAILABLE', 1, uom, 'OPENING_STOCK', 'trespass-1' from ctx $q$,
  '42501',
  null,
  'and cannot record stock into it'
);

reset role;
select * from finish();
rollback;
