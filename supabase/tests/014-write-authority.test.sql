-- Who may write what, proved as the actual user.
--
-- The flow spine shipped with write policies that tested only
-- `property_id in (select app.accessible_properties())` — which answers "may this user
-- see this property", not "may this user do this here". Every member could therefore
-- perform every write, including AUDITOR, whose whole definition is read-only.
--
-- The most important assertion in this file is the negative one: a STOREKEEPER cannot
-- create a gate entry. If the storekeeper captures the arrival and also posts the GRN,
-- the two records agree by construction, and the reconciliation control that the entire
-- module rests on stops existing while continuing to look like it works.

begin;
select plan(15);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000e401', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.w@example.test',  '', now(), now()),
  ('00000000-0000-0000-0000-00000000e402', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.w@example.test',  '', now(), now()),
  ('00000000-0000-0000-0000-00000000e403', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit.w@example.test',  '', now(), now()),
  ('00000000-0000-0000-0000-00000000e404', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'guard.w@example.test',  '', now(), now()),
  ('00000000-0000-0000-0000-00000000e405', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.dup@example.test', '', now(), now());

-- Provisioned by an administrator who is a different person from every role under test —
-- provision_property grants OWNER and ADMIN, so provisioning as the storekeeper would
-- produce a "storekeeper" who is also an owner, and every assertion below would pass
-- while proving nothing.
select system.provision_property('admin.w@example.test', 'Group W', 'W1', 'Property W');

select system.grant_property_role('store.w@example.test', 'W1', 'STOREKEEPER');
select system.grant_property_role('audit.w@example.test', 'W1', 'AUDITOR');
select system.grant_property_role('guard.w@example.test', 'W1', 'SECURITY');

create temporary table ctx as
select
  (select id from public.property where code = 'W1')                                  as prop,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'W1' and c.code = 'DAIRY')                                        as cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'W1' and u.code = 'L')                                            as uom,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'W1' and l.code = 'W1-CHILL')                                     as chill;

grant select on ctx to authenticated;

insert into public.item (id, property_id, code, name, category_id, base_uom_id,
                         is_perishable, is_batch_controlled, shelf_life_days, storage_regime)
select '00000000-0000-0000-0000-0000000e4001', prop, 'MILK-1L', 'Toned Milk 1L',
       cat, uom, true, true, 5, 'CHILLED' from ctx;

-- ---------------------------------------------------------------------------
-- The storekeeper, whose job this is
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000e402","role":"authenticated"}';

select lives_ok(
  $q$ insert into public.batch (id, property_id, item_id, batch_no, best_before,
                                shelf_life_total_days, source)
      select '00000000-0000-0000-0000-0000000e4002', prop,
             '00000000-0000-0000-0000-0000000e4001', 'W-A', current_date + 3, 5,
             'OPENING_STOCK' from ctx $q$,
  'a storekeeper can create a batch'
);

select lives_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason,
         idempotency_key)
      select prop, '00000000-0000-0000-0000-0000000e4002',
             '00000000-0000-0000-0000-0000000e4001', chill, 'AVAILABLE', 20, uom,
             'OPENING_STOCK', 'w-open-1' from ctx $q$,
  'and record stock'
);

-- The control that keeps Security and the storekeeper separate people.
select throws_ok(
  $q$ insert into public.gate_entry
        (property_id, gate_entry_no, unregistered_vendor_name, bill, package_count)
      select prop, 'W1-GE-000900', 'Someone', 'NONE', 1 from ctx $q$,
  '42501',
  null,
  'but cannot capture at the gate — that is Security, and the separation is the control'
);

-- ---------------------------------------------------------------------------
-- The auditor, who may read everything and change nothing
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000e403","role":"authenticated"}';

select isnt_empty(
  $q$ select 1 from public.stock_lot
       where batch_id = '00000000-0000-0000-0000-0000000e4002' $q$,
  'an auditor can see the stock'
);

select throws_ok(
  $q$ insert into public.batch (property_id, item_id, batch_no, source)
      select prop, '00000000-0000-0000-0000-0000000e4001', 'AUDIT-SNEAK', 'OPENING_STOCK'
      from ctx $q$,
  '42501',
  null,
  'and cannot create a batch'
);

select throws_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason,
         idempotency_key)
      select prop, '00000000-0000-0000-0000-0000000e4002',
             '00000000-0000-0000-0000-0000000e4001', chill, 'AVAILABLE', 1, uom,
             'OPENING_STOCK', 'audit-sneak' from ctx $q$,
  '42501',
  null,
  'nor move stock — read-only means read-only'
);

-- ---------------------------------------------------------------------------
-- Security, limited to the gate
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000e404","role":"authenticated"}';

select throws_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason,
         idempotency_key)
      select prop, '00000000-0000-0000-0000-0000000e4002',
             '00000000-0000-0000-0000-0000000e4001', chill, 'AVAILABLE', 1, uom,
             'OPENING_STOCK', 'guard-sneak' from ctx $q$,
  '42501',
  null,
  'a guard cannot record stock'
);

select lives_ok(
  $q$ insert into public.gate_entry
        (id, property_id, gate_entry_no, unregistered_vendor_name, bill, package_count)
      select '00000000-0000-0000-0000-0000000e4003', prop, 'W1-GE-000001',
             'Bhaskar Fish Supply', 'NONE', 12 from ctx $q$,
  'but can capture an arrival'
);

-- timestamp_out had no UPDATE policy at all, so a [P1] field could never be written.
select lives_ok(
  $q$ update public.gate_entry set timestamp_out = now()
       where id = '00000000-0000-0000-0000-0000000e4003' $q$,
  'and record the vehicle leaving'
);

select throws_ok(
  $q$ update public.gate_entry set timestamp_out = now()
       where id = '00000000-0000-0000-0000-0000000e4003' $q$,
  'P0001',
  null,
  'though only once — a departure is a fact, not a field'
);

-- As `authenticated` this is refused by the column grant (42501) before the trigger is
-- reached. The trigger is what survives somebody later widening that grant, so it is
-- tested on its own terms below.
select throws_ok(
  $q$ update public.gate_entry set package_count = 99
       where id = '00000000-0000-0000-0000-0000000e4003' $q$,
  '42501',
  null,
  'and cannot alter what was captured'
);

-- ---------------------------------------------------------------------------
-- Stock cannot go negative
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000e402","role":"authenticated"}';

select throws_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, from_location_id, from_state, qty, uom_id,
         reason, idempotency_key)
      select prop, '00000000-0000-0000-0000-0000000e4002',
             '00000000-0000-0000-0000-0000000e4001', chill, 'AVAILABLE', 50, uom,
             'ISSUE', 'w-overissue' from ctx $q$,
  '23514',
  null,
  'issuing more than exists is refused rather than leaving a negative lot'
);

select is(
  (select qty from public.stock_lot
    where batch_id = '00000000-0000-0000-0000-0000000e4002' and state = 'AVAILABLE'),
  20::numeric(14, 4),
  'and the projection is untouched by the attempt'
);

reset role;

-- ---------------------------------------------------------------------------
-- The trigger itself, and an ambiguous property code
-- ---------------------------------------------------------------------------

-- Run as the superuser, which bypasses the column grant, so this reaches the trigger.
select throws_ok(
  $q$ update public.gate_entry set package_count = 99
       where id = '00000000-0000-0000-0000-0000000e4003' $q$,
  'P0001',
  null,
  'the append-only rule holds even where the column grant does not reach'
);

-- Two customers, both using 'W1'. Property codes are unique per organisation, not
-- globally, and the old SELECT INTO took whichever row came first — silently granting
-- a user membership at the wrong customer's property.
select system.provision_property('admin.dup@example.test', 'Group Duplicate', 'W1', 'Also W1');

select throws_ok(
  $$ select system.grant_property_role('store.w@example.test', 'W1', 'STOREKEEPER') $$,
  'P0001',
  null,
  'an ambiguous property code is refused rather than resolved by guesswork'
);

select * from finish();
rollback;
