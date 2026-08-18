-- Gates 1 to 5: posting a goods receipt.
--
-- Two assertions carry this file. The first is atomicity — a GRN is immutable once
-- posted, so a half-written one cannot be repaired by editing, only by amendment. Every
-- refusal below therefore has to leave nothing at all behind: no header, no batch, no
-- movement, and no number burned out of the sequence.
--
-- The second is that accepted stock lands in QUARANTINE and not AVAILABLE. That single
-- state is what makes put-away a real gate rather than a screen; get it wrong and stock
-- is issuable from the receiving bay, which is precisely the practice this product
-- exists to replace.
--
-- Run as `authenticated` throughout. This repo has already shipped a trigger that passed
-- every test as the superuser and then failed for the first real storekeeper.

begin;
select plan(23);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000d901', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.g@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000d902', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.g@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000d903', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit.g@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000d904', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.h@example.test', '', now(), now());

-- Provisioned by somebody who is not the storekeeper under test: provision_property
-- grants OWNER, so provisioning as them would produce a "storekeeper" who is also an
-- owner and every assertion here would pass while proving nothing.
select system.provision_property('admin.g@example.test', 'Group G', 'G1', 'Property G');
select system.provision_property('admin.h@example.test', 'Group H', 'H1', 'Property H');
select system.grant_property_role('store.g@example.test', 'G1', 'STOREKEEPER');
select system.grant_property_role('audit.g@example.test', 'G1', 'AUDITOR');

create temporary table ctx as
select
  (select id from public.property where code = 'G1')                                  as prop,
  (select id from public.property where code = 'H1')                                  as other,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'G1' and c.code = 'DAIRY')                                        as cat,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'H1' and c.code = 'DAIRY')                                        as other_cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'G1' and u.code = 'L')                                            as uom_l,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'G1' and u.code = 'KG')                                           as uom_kg,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'H1' and u.code = 'L')                                            as other_uom,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'G1' and l.code = 'G1-T1-RCV')                                    as rcv,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'G1' and l.code = 'G1-T1-REJ')                                    as rej;

grant select on ctx to authenticated;

-- Milk is the awkward case on purpose: perishable AND cold chain, so both halves of the
-- quality floor apply to the same line.
insert into public.item (id, property_id, code, name, category_id, base_uom_id,
                         is_perishable, is_cold_chain, is_batch_controlled,
                         shelf_life_days, temp_min_c, temp_max_c, storage_regime)
select '00000000-0000-0000-0000-0000000d9001', prop, 'MILK-1L', 'Toned Milk 1L',
       cat, uom_l, true, true, true, 10, 0, 5, 'CHILLED' from ctx;

insert into public.item (id, property_id, code, name, category_id, base_uom_id)
select '00000000-0000-0000-0000-0000000d9002', prop, 'RICE-JOHA', 'Joha Rice',
       cat, uom_kg from ctx;

insert into public.item (id, property_id, code, name, category_id, base_uom_id)
select '00000000-0000-0000-0000-0000000d9003', other, 'MILK-1L', 'Someone else''s milk',
       other_cat, other_uom from ctx;

insert into public.party (id, property_id, code, name, party_type)
select '00000000-0000-0000-0000-0000000d9010', prop, 'G1-VEN-000001',
       'Bhaskar Dairy', 'VENDOR' from ctx;

-- Two arrivals. Only one is received against, so the open worklist has something left
-- in it at the end — the reconciliation control is the reciprocal of this whole file.
insert into public.gate_entry (id, property_id, gate_entry_no, party_id, bill, package_count)
select '00000000-0000-0000-0000-0000000d9020', prop, 'G1-GE-000001',
       '00000000-0000-0000-0000-0000000d9010', 'NONE', 6 from ctx;

insert into public.gate_entry (id, property_id, gate_entry_no, party_id, bill, package_count)
select '00000000-0000-0000-0000-0000000d9021', prop, 'G1-GE-000002',
       '00000000-0000-0000-0000-0000000d9010', 'NONE', 2 from ctx;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d902","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- A receipt that posts
-- ---------------------------------------------------------------------------
--
-- Milk arrives whole and is taken; rice arrives with ten kilos wet, so it is part
-- accepted with a reason. Nothing here is unusual, which is the point.

select is(
  (select g.grn_no from public.post_grn(
     (select prop from ctx),
     '00000000-0000-0000-0000-0000000d9020',
     '00000000-0000-0000-0000-0000000d9010',
     'post-1',
     jsonb_build_array(
       jsonb_build_object(
         'item_id', '00000000-0000-0000-0000-0000000d9001',
         'uom_id', (select uom_l from ctx),
         'batch_no', 'V-MILK-77',
         'qty_challan', 40, 'qty_physical', 40, 'qty_accepted', 40, 'qty_rejected', 0,
         'decision', 'ACCEPT',
         'best_before', (current_date + 10)::text,
         'receipt_temp_c', 3.5
       ),
       jsonb_build_object(
         'item_id', '00000000-0000-0000-0000-0000000d9002',
         'uom_id', (select uom_kg from ctx),
         'qty_challan', 50, 'qty_physical', 50, 'qty_accepted', 40, 'qty_rejected', 10,
         'decision', 'ACCEPT_PARTIAL',
         'reject_reason', 'DAMAGED'
       )
     )
   ) g),
  'G1-GRN-000001',
  'a storekeeper can post a receipt, and it is numbered from the property''s own series'
);

-- The assertion this whole gate exists for.
select is(
  (select sum(qty)::numeric(14, 4) from public.stock_lot
    where location_id = (select rcv from ctx) and state = 'QUARANTINE'),
  80::numeric(14, 4),
  'accepted stock is at Terminal 1 in QUARANTINE — on the books, not yet issuable'
);

select is(
  (select sum(qty)::numeric(14, 4) from public.stock_lot
    where location_id = (select rej from ctx) and state = 'REJECT_HOLD'),
  10::numeric(14, 4),
  'and the rejected ten kilos are in the reject hold, which is supplier liability'
);

select is(
  (select count(*)::int from public.stock_lot where state = 'AVAILABLE' and qty > 0),
  0,
  'nothing is issuable straight off the dock — that is what put-away is for'
);

-- PRD section 4 Gate 3: a line with no vendor number still gets a batch, because expiry
-- and traceability have nowhere else to live.
select is(
  (select batch_no from public.batch where item_id = '00000000-0000-0000-0000-0000000d9002'),
  'SYS-G1-GRN-000001-02',
  'a line the vendor gave no batch number for gets a generated one'
);

select is(
  (select is_system_generated from public.batch where batch_no = 'V-MILK-77'),
  false,
  'and a line that came with one keeps it, marked as the vendor''s'
);

-- Frozen at receipt, never recomputed: recomputing would erase the fact that the
-- delivery was already old when it arrived.
select is(
  (select pct_at_receipt from public.batch where batch_no = 'V-MILK-77'),
  100.00::numeric(5, 2),
  'remaining shelf life is captured at the moment of receipt'
);

-- recorded_by is nulled when a user is deleted. A compliance register that forgets who
-- received a consignment is not one.
select is(
  (select count(*)::int from public.stock_movement
    where reason = 'GRN_POSTING' and recorded_by_name = 'store.g@example.test'),
  3,
  'and every movement carries the recorder''s name, not only a foreign key to them'
);

-- ---------------------------------------------------------------------------
-- The retry
-- ---------------------------------------------------------------------------
--
-- The outbox retries on a lost acknowledgement. A second GRN for one delivery is not a
-- duplicate row — it is stock counted twice, on an append-only ledger, under a number
-- somebody has already written onto a challan.

select is(
  (select g.grn_no from public.post_grn(
     (select prop from ctx),
     '00000000-0000-0000-0000-0000000d9020',
     '00000000-0000-0000-0000-0000000d9010',
     'post-1',
     jsonb_build_array(jsonb_build_object(
       'item_id', '00000000-0000-0000-0000-0000000d9001',
       'uom_id', (select uom_l from ctx),
       'qty_physical', 999, 'qty_accepted', 999, 'qty_rejected', 0,
       'decision', 'ACCEPT',
       'best_before', (current_date + 10)::text,
       'receipt_temp_c', 3.5
     )) ) g),
  'G1-GRN-000001',
  'a replayed submission returns the original number rather than posting again'
);

select is(
  (select count(*)::int from public.grn),
  1,
  'so there is still one receipt'
);

select is(
  (select sum(qty)::numeric(14, 4) from public.stock_lot
    where location_id = (select rcv from ctx) and state = 'QUARANTINE'),
  80::numeric(14, 4),
  'and the stock was not counted twice — the replay ignored a different payload entirely'
);

-- ---------------------------------------------------------------------------
-- The quality floor, which no enforcement mode can switch off
-- ---------------------------------------------------------------------------

select throws_like(
  $q$ select * from public.post_grn(
        (select prop from ctx), null, null, 'floor-1',
        jsonb_build_array(jsonb_build_object(
          'item_id', '00000000-0000-0000-0000-0000000d9001',
          'uom_id', (select uom_l from ctx),
          'qty_physical', 10, 'qty_accepted', 10, 'qty_rejected', 0,
          'decision', 'ACCEPT', 'receipt_temp_c', 3.5)) ) $q$,
  '%perishable line needs a best-before date%',
  'a perishable line without an expiry is refused'
);

select throws_like(
  $q$ select * from public.post_grn(
        (select prop from ctx), null, null, 'floor-2',
        jsonb_build_array(jsonb_build_object(
          'item_id', '00000000-0000-0000-0000-0000000d9001',
          'uom_id', (select uom_l from ctx),
          'qty_physical', 10, 'qty_accepted', 10, 'qty_rejected', 0,
          'decision', 'ACCEPT', 'best_before', (current_date + 10)::text)) ) $q$,
  '%cold-chain line needs a probe temperature%',
  'and a cold-chain line without a probe reading'
);

select throws_like(
  $q$ select * from public.post_grn(
        (select prop from ctx), null, null, 'floor-3',
        jsonb_build_array(jsonb_build_object(
          'item_id', '00000000-0000-0000-0000-0000000d9002',
          'uom_id', (select uom_kg from ctx),
          'qty_physical', 50, 'qty_accepted', 30, 'qty_rejected', 10,
          'decision', 'ACCEPT_PARTIAL', 'reject_reason', 'DAMAGED')) ) $q$,
  '%Every unit has to be one or the other%',
  'ten kilos unaccounted for is refused — the table constraint permits it, this does not'
);

select throws_like(
  $q$ select * from public.post_grn(
        (select prop from ctx), null, null, 'floor-4',
        jsonb_build_array(jsonb_build_object(
          'item_id', '00000000-0000-0000-0000-0000000d9002',
          'uom_id', (select uom_kg from ctx),
          'qty_physical', 50, 'qty_accepted', 40, 'qty_rejected', 10,
          'decision', 'ACCEPT', 'reject_reason', 'DAMAGED')) ) $q$,
  '%marked accepted but has a rejected quantity%',
  'and a decision that disagrees with the counts, which would leave the register saying two things'
);

select throws_like(
  $q$ select * from public.post_grn(
        (select prop from ctx), null, null, 'floor-5',
        jsonb_build_array(jsonb_build_object(
          'item_id', '00000000-0000-0000-0000-0000000d9002',
          'uom_id', (select uom_kg from ctx),
          'qty_physical', 50, 'qty_accepted', 40, 'qty_rejected', 10,
          'decision', 'ACCEPT_PARTIAL')) ) $q$,
  '%say why any of it was turned away%',
  'a rejection with no reason is one nobody can put to the vendor'
);

-- ---------------------------------------------------------------------------
-- Property boundaries, which RLS does not enforce inside a definer function
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$ select * from public.post_grn(
        (select prop from ctx), null, null, 'cross-1',
        jsonb_build_array(jsonb_build_object(
          'item_id', '00000000-0000-0000-0000-0000000d9003',
          'uom_id', (select uom_kg from ctx),
          'qty_physical', 10, 'qty_accepted', 10, 'qty_rejected', 0,
          'decision', 'ACCEPT')) ) $q$,
  '42501',
  null,
  'an item belonging to another property is refused'
);

select throws_ok(
  $q$ select * from public.post_grn(
        (select other from ctx), null, null, 'cross-2',
        jsonb_build_array(jsonb_build_object(
          'item_id', '00000000-0000-0000-0000-0000000d9003',
          'uom_id', (select other_uom from ctx),
          'qty_physical', 10, 'qty_accepted', 10, 'qty_rejected', 0,
          'decision', 'ACCEPT')) ) $q$,
  '42501',
  null,
  'and so is posting at a property this user has no role at'
);

-- ---------------------------------------------------------------------------
-- Atomicity — the reason all of this is one function
-- ---------------------------------------------------------------------------
--
-- Seven refusals have run since the last successful post. If any of them left a header,
-- a batch or a movement behind, it would be unfixable: the GRN triggers forbid both
-- UPDATE and DELETE, and the ledger is append-only.

select is(
  (select count(*)::int from public.stock_movement),
  3,
  'not one refused line left a movement behind'
);

select is(
  (select (select count(*) from public.grn)::text || ' receipts, ' ||
          (select count(*) from public.batch)::text || ' batches'),
  '1 receipts, 2 batches',
  'nor a half-written receipt, which could never be corrected — only amended'
);

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
  'and stock_lot still equals a full replay of the ledger'
);

-- ---------------------------------------------------------------------------
-- Authority, and the control on the other side of it
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d903","role":"authenticated"}';

select throws_ok(
  $q$ select * from public.post_grn(
        (select prop from ctx), null, null, 'auditor-1',
        jsonb_build_array(jsonb_build_object(
          'item_id', '00000000-0000-0000-0000-0000000d9002',
          'uom_id', (select uom_kg from ctx),
          'qty_physical', 10, 'qty_accepted', 10, 'qty_rejected', 0,
          'decision', 'ACCEPT')) ) $q$,
  '42501',
  null,
  'an auditor cannot post a receipt — read-only means read-only, even through an RPC'
);

-- The reciprocal control (PRD section 1): every gate entry resolves to a GRN or raises
-- an alert. One of the two arrivals is still unaccounted for, and it has to show.
select is(
  (select array_agg(gate_entry_no order by gate_entry_no)
     from public.list_open_gate_entries((select prop from ctx))),
  array['G1-GE-000002'],
  'the received arrival has left the open worklist and the unreceived one has not'
);

reset role;
select * from finish();
rollback;
