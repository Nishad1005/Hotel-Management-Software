-- The stock ledger, and the invariants that make it trustworthy.
--
-- The assertion that matters most is that stock_lot equals a full replay of
-- stock_movement. stock_lot is a maintained table, not a view, because the stock
-- report and the watchlist are read constantly and replaying the whole ledger each
-- time would not survive a year of movements. A maintained table can drift; this test
-- is what stops it.

begin;
select plan(14);

-- ---------------------------------------------------------------------------
-- Fixture: two properties, so isolation is exercised alongside everything else
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sk.a@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000e102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sk.b@example.test', '', now(), now());

select system.provision_property('sk.a@example.test', 'Group A', 'AA', 'Property A');
select system.provision_property('sk.b@example.test', 'Group B', 'BB', 'Property B');

create temporary table ctx as
select
  (select id from public.property where code = 'AA')                                  as prop_a,
  (select id from public.property where code = 'BB')                                  as prop_b,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'AA' and c.code = 'DAIRY')                                        as cat_a,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'AA' and u.code = 'L')                                            as uom_a,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'AA' and l.code = 'AA-CHILL')                                     as chill_a,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'AA' and l.code = 'AA-T1-REJ')                                    as rej_a,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'AA' and l.code = 'AA-DRY')                                       as dry_a;

insert into public.item (id, property_id, code, name, category_id, base_uom_id,
                         is_perishable, is_batch_controlled, shelf_life_days, storage_regime)
select '00000000-0000-0000-0000-0000000a0001', prop_a, 'MILK-1L', 'Toned Milk 1L',
       cat_a, uom_a, true, true, 5, 'CHILLED' from ctx;

insert into public.batch (id, property_id, item_id, batch_no, best_before, shelf_life_total_days, source)
select '00000000-0000-0000-0000-0000000b0001', prop_a, '00000000-0000-0000-0000-0000000a0001',
       'OPEN-1', current_date + 3, 5, 'OPENING_STOCK' from ctx;

-- ---------------------------------------------------------------------------
-- The projection follows the ledger
-- ---------------------------------------------------------------------------

insert into public.stock_movement
  (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason, idempotency_key)
select prop_a, '00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000a0001',
       chill_a, 'AVAILABLE', 100, uom_a, 'OPENING_STOCK', 'open-1' from ctx;

select is(
  (select qty from public.stock_lot where batch_id = '00000000-0000-0000-0000-0000000b0001'
     and state = 'AVAILABLE'),
  100::numeric(14, 4),
  'an inbound movement creates the lot'
);

insert into public.stock_movement
  (property_id, batch_id, item_id, from_location_id, from_state, to_location_id, to_state,
   qty, uom_id, reason, idempotency_key)
select prop_a, '00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000a0001',
       chill_a, 'AVAILABLE', chill_a, 'ISSUED', 30, uom_a, 'ISSUE', 'issue-1' from ctx;

select is(
  (select qty from public.stock_lot where batch_id = '00000000-0000-0000-0000-0000000b0001'
     and state = 'AVAILABLE'),
  70::numeric(14, 4),
  'issuing reduces what is available'
);

select is(
  (select qty from public.stock_lot where batch_id = '00000000-0000-0000-0000-0000000b0001'
     and state = 'ISSUED'),
  30::numeric(14, 4),
  'and the issued quantity is not lost, only moved'
);

-- ---------------------------------------------------------------------------
-- The projection equals a full replay. THE test.
-- ---------------------------------------------------------------------------

insert into public.stock_movement
  (property_id, batch_id, item_id, from_location_id, from_state, to_location_id, to_state,
   qty, uom_id, reason, idempotency_key)
select prop_a, '00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000a0001',
       chill_a, 'AVAILABLE', dry_a, 'AVAILABLE', 20, uom_a, 'ZONE_TRANSFER', 'move-1' from ctx;

insert into public.stock_movement
  (property_id, batch_id, item_id, from_location_id, from_state, qty, uom_id, reason, idempotency_key)
select prop_a, '00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000a0001',
       chill_a, 'AVAILABLE', 5, uom_a, 'WRITE_OFF_EXPIRED', 'writeoff-1' from ctx;

select is_empty(
  $q$
    with replay as (
      select batch_id, location_id, state, sum(delta) as qty from (
        select batch_id, from_location_id as location_id, from_state as state, -qty as delta
          from public.stock_movement
         where from_location_id is not null and from_state is not null
        union all
        select batch_id, to_location_id, to_state, qty
          from public.stock_movement
         where to_location_id is not null and to_state is not null
      ) parts
      group by batch_id, location_id, state
    )
    select coalesce(r.batch_id, l.batch_id)::text
      from replay r
      full outer join public.stock_lot l
        on l.batch_id = r.batch_id and l.location_id = r.location_id and l.state = r.state
     where coalesce(r.qty, 0) <> coalesce(l.qty, 0)
  $q$,
  'stock_lot equals a full replay of stock_movement'
);

-- ---------------------------------------------------------------------------
-- Append-only
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$ update public.stock_movement set qty = 999 where idempotency_key = 'open-1' $q$,
  'P0001',
  null,
  'the ledger cannot be edited'
);

select throws_ok(
  $q$ delete from public.stock_movement where idempotency_key = 'open-1' $q$,
  'P0001',
  null,
  'and it cannot be deleted'
);

-- The outbox retries; a repeated key must not become a second movement.
select throws_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason, idempotency_key)
      select prop_a, '00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000a0001',
             chill_a, 'AVAILABLE', 100, uom_a, 'OPENING_STOCK', 'open-1' from ctx $q$,
  '23505',
  null,
  'a replayed idempotency key is rejected rather than duplicated'
);

-- ---------------------------------------------------------------------------
-- Rejected stock can never reach a zone (PRD section 8, hard rule)
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, from_location_id, from_state, to_location_id, to_state,
         qty, uom_id, reason, idempotency_key)
      select prop_a, '00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000a0001',
             rej_a, 'REJECT_HOLD', chill_a, 'AVAILABLE', 1, uom_a, 'PUT_AWAY', 'illegal-1' from ctx $q$,
  '23514',
  null,
  'rejected stock cannot be put away into a zone'
);

select lives_ok(
  $q$ insert into public.stock_movement
        (property_id, batch_id, item_id, from_location_id, from_state, to_location_id, to_state,
         qty, uom_id, reason, idempotency_key)
      select prop_a, '00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000a0001',
             rej_a, 'REJECT_HOLD', rej_a, 'STAGED_OUT', 1, uom_a, 'DISPATCH_STAGING', 'legal-1' from ctx $q$,
  'but it can be staged for dispatch, which is how it leaves'
);

-- ---------------------------------------------------------------------------
-- GRN immutability (PRD section 4 Gate 5, acceptance criterion 10)
-- ---------------------------------------------------------------------------

insert into public.grn (id, property_id, grn_no)
select '00000000-0000-0000-0000-0000000c0001', prop_a, 'AA-GRN-000001' from ctx;

select throws_ok(
  $q$ update public.grn set grn_no = 'TAMPERED' where grn_no = 'AA-GRN-000001' $q$,
  'P0001',
  null,
  'a posted GRN cannot be edited'
);

select throws_ok(
  $q$ delete from public.grn where grn_no = 'AA-GRN-000001' $q$,
  'P0001',
  null,
  'nor deleted'
);

select lives_ok(
  $q$ insert into public.grn (property_id, grn_no, amendment_of, amendment_reason)
      select prop_a, 'AA-GRN-000002', '00000000-0000-0000-0000-0000000c0001',
             'Quantity miscounted at receipt' from ctx $q$,
  'it is corrected by amendment, which leaves the original standing'
);

select throws_ok(
  $q$ insert into public.grn (property_id, grn_no, amendment_of)
      select prop_a, 'AA-GRN-000003', '00000000-0000-0000-0000-0000000c0001' from ctx $q$,
  '23514',
  null,
  'and an amendment without a reason is refused'
);

-- ---------------------------------------------------------------------------
-- Returnables (PRD section 9 item 6)
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$ insert into public.dispatch_note (property_id, dispatch_no, dispatch_type, is_returnable)
      select prop_a, 'AA-DSP-000001', 'LINEN', true from ctx $q$,
  '23514',
  null,
  'a returnable dispatch must carry an expected return date'
);

select * from finish();
rollback;
