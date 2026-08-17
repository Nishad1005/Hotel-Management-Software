-- Gate 6 — put-away.
--
-- The assertion that has to hold above all others is that rejected stock cannot get into
-- a zone by any path. It is a hard rule with no enforcement mode and no override, and it
-- is the one people try hardest to talk their way around: the vendor is on the phone, the
-- cold room has space, and it is only a few kilos.
--
-- After that: only a bin is a destination, a chilled item cannot land in an ambient bin,
-- and every put-away records how the code was established — which is the concession this
-- MVP makes to hard rule 13, made countable rather than silent.
--
-- As `authenticated` throughout.

begin;
select plan(21);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000ea01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.pa@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000ea02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.pa@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000ea03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit.pa@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000ea04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.pb@example.test', '', now(), now());

select system.provision_property('admin.pa@example.test', 'Group PA', 'PA', 'Property PA');
select system.provision_property('admin.pb@example.test', 'Group PB', 'PB', 'Property PB');
select system.grant_property_role('store.pa@example.test', 'PA', 'STOREKEEPER');
select system.grant_property_role('audit.pa@example.test', 'PA', 'AUDITOR');

create temporary table ctx as
select
  (select id from public.property where code = 'PA')                                  as prop,
  (select id from public.property where code = 'PB')                                  as other,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'PA' and c.code = 'DAIRY')                                        as cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'PA' and u.code = 'L')                                            as uom_l,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'PA' and u.code = 'KG')                                           as uom_kg,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'PA' and l.code = 'PA-T1-RCV')                                    as rcv,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'PA' and l.code = 'PA-T1-REJ')                                    as rej,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'PA' and l.code = 'PA-CHILL')                                     as chill,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'PA' and l.code = 'PA-DRY')                                       as dry;

grant select on ctx to authenticated;

-- Two bins under two zones of different regimes, which is the whole point of the
-- regime check below.
insert into public.location (id, property_id, code, name, kind, parent_id, regime)
select '00000000-0000-0000-0000-0000000ea101', prop, 'PA-CHILL-R1-B1', 'Cold room bin 1',
       'BIN', chill, 'CHILLED' from ctx;

insert into public.location (id, property_id, code, name, kind, parent_id, regime)
select '00000000-0000-0000-0000-0000000ea102', prop, 'PA-DRY-R1-B1', 'Dry store bin 1',
       'BIN', dry, 'AMBIENT' from ctx;

insert into public.item (id, property_id, code, name, category_id, base_uom_id,
                         is_perishable, is_cold_chain, is_batch_controlled,
                         shelf_life_days, temp_min_c, temp_max_c, storage_regime)
select '00000000-0000-0000-0000-0000000ea001', prop, 'MILK-1L', 'Toned Milk 1L',
       cat, uom_l, true, true, true, 10, 0, 5, 'CHILLED' from ctx;

insert into public.item (id, property_id, code, name, category_id, base_uom_id, storage_regime)
select '00000000-0000-0000-0000-0000000ea002', prop, 'RICE-JOHA', 'Joha Rice',
       cat, uom_kg, 'AMBIENT' from ctx;

insert into public.party (id, property_id, code, name)
select '00000000-0000-0000-0000-0000000ea010', prop, 'PA-VEN-000001', 'Bhaskar Dairy' from ctx;

insert into public.gate_entry (id, property_id, gate_entry_no, party_id, bill, package_count)
select '00000000-0000-0000-0000-0000000ea020', prop, 'PA-GE-000001',
       '00000000-0000-0000-0000-0000000ea010', 'NONE', 6 from ctx;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ea02","role":"authenticated"}';

-- Received through the real gate rather than seeded by hand, so what is put away below
-- is genuinely what receiving produces — including the rejected line.
select is(
  (select g.grn_no from public.post_grn(
     (select prop from ctx),
     '00000000-0000-0000-0000-0000000ea020',
     '00000000-0000-0000-0000-0000000ea010',
     'pa-post-1',
     jsonb_build_array(
       jsonb_build_object(
         'item_id', '00000000-0000-0000-0000-0000000ea001',
         'uom_id', (select uom_l from ctx), 'batch_no', 'V-MILK-1',
         'qty_physical', 40, 'qty_accepted', 40, 'qty_rejected', 0, 'decision', 'ACCEPT',
         'best_before', (current_date + 8)::text, 'receipt_temp_c', 3.5),
       jsonb_build_object(
         'item_id', '00000000-0000-0000-0000-0000000ea002',
         'uom_id', (select uom_kg from ctx), 'batch_no', 'V-RICE-1',
         'qty_physical', 50, 'qty_accepted', 0, 'qty_rejected', 50, 'decision', 'REJECT',
         'reject_reason', 'DAMAGED')
     )) g),
  'PA-GRN-000001',
  'a receipt posts, one line accepted and one rejected outright'
);

-- ---------------------------------------------------------------------------
-- The worklist
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(item_code order by item_code)
     from public.list_awaiting_putaway((select prop from ctx))),
  array['MILK-1L'],
  'only the accepted line is waiting to be put away — the rejected one was never a candidate'
);

-- ---------------------------------------------------------------------------
-- Putting it away
-- ---------------------------------------------------------------------------

select is(
  (select r.to_location_code from public.put_away(
     (select prop from ctx), (select id from public.batch where batch_no = 'V-MILK-1'),
     (select rcv from ctx), 'PA-CHILL-R1-B1', 25, 'CAMERA', 'pa-away-1') r),
  'PA-CHILL-R1-B1',
  'a scanned bin code resolves to the bin'
);

select is(
  (select qty from public.stock_lot
    where location_id = '00000000-0000-0000-0000-0000000ea101' and state = 'AVAILABLE'),
  25::numeric(14, 4),
  'and the stock is available there'
);

-- A part put-away is ordinary: a pallet goes to two bins because one bin is not big
-- enough, and the remainder has to stay countable at Terminal 1.
select is(
  (select qty from public.stock_lot
    where location_id = (select rcv from ctx) and state = 'QUARANTINE'),
  15::numeric(14, 4),
  'the rest is still in quarantine, because only part of it was moved'
);

select is(
  (select scan_method::text from public.stock_movement where idempotency_key = 'pa-away-1'),
  'CAMERA',
  'and how the bin was identified is on the movement, not inferred later'
);

-- The concession this MVP makes to hard rule 13, made countable.
select is(
  (select r.remaining from public.put_away(
     (select prop from ctx), (select id from public.batch where batch_no = 'V-MILK-1'),
     (select rcv from ctx), 'pa-chill-r1-b1', 15, 'TYPED', 'pa-away-2') r),
  0::numeric(14, 4),
  'a typed code works too, is matched case-insensitively, and reports nothing left behind'
);

select is(
  (select count(*)::int from public.stock_movement
    where reason = 'PUT_AWAY' and scan_method = 'TYPED'),
  1,
  'and the typed one is counted, which is what makes the gap honest rather than invisible'
);

-- ---------------------------------------------------------------------------
-- Rejected stock, which has no path at all
-- ---------------------------------------------------------------------------

select throws_like(
  $q$ select * from public.put_away(
        (select prop from ctx), (select id from public.batch where batch_no = 'V-RICE-1'),
        (select rej from ctx), 'PA-DRY-R1-B1', 10, 'CAMERA', 'pa-rej-1') $q$,
  '%Rejected stock can never be put into a zone%',
  'rejected stock cannot be put away, and is told so in those words'
);

-- The same refusal from the other direction: naming the reject hold as the source is the
-- obvious workaround, and naming quarantine when there is none is the other.
select throws_like(
  $q$ select * from public.put_away(
        (select prop from ctx), (select id from public.batch where batch_no = 'V-RICE-1'),
        (select rcv from ctx), 'PA-DRY-R1-B1', 10, 'CAMERA', 'pa-rej-2') $q$,
  '%Rejected stock can never be put into a zone%',
  'and not by claiming it came from the receiving bay instead'
);

select is(
  (select coalesce(sum(qty), 0)::numeric(14, 4) from public.stock_lot
    where location_id = '00000000-0000-0000-0000-0000000ea102'),
  0::numeric(14, 4),
  'so nothing rejected reached a zone'
);

-- ---------------------------------------------------------------------------
-- Only a bin, and only the right kind of bin
-- ---------------------------------------------------------------------------

select throws_like(
  $q$ select * from public.put_away(
        (select prop from ctx), (select id from public.batch where batch_no = 'V-MILK-1'),
        (select rcv from ctx), 'PA-CHILL', 1, 'CAMERA', 'pa-zone-1') $q$,
  '%is a zone, not a bin%',
  'a zone is not a destination — "somewhere in the cold room" is the practice this replaces'
);

select throws_like(
  $q$ select * from public.put_away(
        (select prop from ctx), (select id from public.batch where batch_no = 'V-MILK-1'),
        (select rcv from ctx), 'PA-NOWHERE-9', 1, 'CAMERA', 'pa-ghost-1') $q$,
  '%No location here has the code PA-NOWHERE-9%',
  'and a code that matches nothing says which code it was'
);

-- Food safety, not paperwork. No mode, no override.
insert into public.batch (id, property_id, item_id, batch_no, best_before,
                          shelf_life_total_days, source)
select '00000000-0000-0000-0000-0000000ea201', prop, '00000000-0000-0000-0000-0000000ea001',
       'MILK-SPARE', current_date + 6, 10, 'OPENING_STOCK' from ctx;

insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state,
                                   qty, uom_id, reason, idempotency_key)
select prop, '00000000-0000-0000-0000-0000000ea201', '00000000-0000-0000-0000-0000000ea001',
       rcv, 'QUARANTINE', 10, uom_l, 'OPENING_STOCK', 'pa-spare-1' from ctx;

select throws_like(
  $q$ select * from public.put_away(
        (select prop from ctx), '00000000-0000-0000-0000-0000000ea201',
        (select rcv from ctx), 'PA-DRY-R1-B1', 5, 'CAMERA', 'pa-regime-1') $q$,
  '%needs chilled storage and PA-DRY-R1-B1 is ambient%',
  'a chilled item cannot go into an ambient bin, and that cannot be overridden'
);

-- The asymmetry is deliberate: a cold room is wasteful for rice, not dangerous.
insert into public.batch (id, property_id, item_id, batch_no, source)
select '00000000-0000-0000-0000-0000000ea202', prop, '00000000-0000-0000-0000-0000000ea002',
       'RICE-SPARE', 'OPENING_STOCK' from ctx;

insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state,
                                   qty, uom_id, reason, idempotency_key)
select prop, '00000000-0000-0000-0000-0000000ea202', '00000000-0000-0000-0000-0000000ea002',
       rcv, 'QUARANTINE', 20, uom_kg, 'OPENING_STOCK', 'pa-spare-2' from ctx;

select lives_ok(
  $q$ select * from public.put_away(
        (select prop from ctx), '00000000-0000-0000-0000-0000000ea202',
        (select rcv from ctx), 'PA-CHILL-R1-B1', 5, 'CAMERA', 'pa-regime-2') $q$,
  'but an ambient item may go into a cold room, because that is wasteful rather than unsafe'
);

-- ---------------------------------------------------------------------------
-- Dwell
-- ---------------------------------------------------------------------------
--
-- now() does not advance inside a transaction, so a genuine breach cannot be produced by
-- waiting. The movement is backdated instead, which tests the comparison rather than the
-- clock.

insert into public.batch (id, property_id, item_id, batch_no, source)
select '00000000-0000-0000-0000-0000000ea203', prop, '00000000-0000-0000-0000-0000000ea002',
       'RICE-STALE', 'OPENING_STOCK' from ctx;

reset role;
insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state,
                                   qty, uom_id, reason, idempotency_key, occurred_at)
select prop, '00000000-0000-0000-0000-0000000ea203', '00000000-0000-0000-0000-0000000ea002',
       rcv, 'QUARANTINE', 8, uom_kg, 'OPENING_STOCK', 'pa-stale-1', now() - interval '9 hours'
from ctx;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ea02","role":"authenticated"}';

select is(
  (select dwell_breach from public.batch where batch_no = 'RICE-STALE'),
  false,
  'a batch does not start in breach'
);

select lives_ok(
  $q$ select * from public.put_away(
        (select prop from ctx), '00000000-0000-0000-0000-0000000ea203',
        (select rcv from ctx), 'PA-DRY-R1-B1', 8, 'HARDWARE', 'pa-stale-away') $q$,
  'stock that stood at Terminal 1 all morning still goes away'
);

select is(
  (select dwell_breach from public.batch where batch_no = 'RICE-STALE'),
  true,
  'and the breach is recorded permanently against it, because it is a fact about the consignment'
);

-- ---------------------------------------------------------------------------
-- Authority and property boundaries
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$ select * from public.put_away(
        (select other from ctx), '00000000-0000-0000-0000-0000000ea202',
        (select rcv from ctx), 'PA-DRY-R1-B1', 1, 'CAMERA', 'pa-cross-1') $q$,
  '42501',
  null,
  'putting away at a property this user has no role at is refused'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ea03","role":"authenticated"}';

select throws_ok(
  $q$ select * from public.put_away(
        (select prop from ctx), '00000000-0000-0000-0000-0000000ea202',
        (select rcv from ctx), 'PA-DRY-R1-B1', 1, 'CAMERA', 'pa-auditor-1') $q$,
  '42501',
  null,
  'and an auditor cannot move stock, through an RPC or otherwise'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ea02","role":"authenticated"}';

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

reset role;
select * from finish();
rollback;
