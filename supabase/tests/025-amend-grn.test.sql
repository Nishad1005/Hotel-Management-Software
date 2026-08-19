-- Correcting a posted receipt.
--
-- Non-negotiable 10 is "GRN immutability with an amendment trail", and only the
-- immutability half existed — which made a posted receipt not immutable but
-- uncorrectable. This file is the other half.
--
-- The assertion that carries it is the REFUSAL. Correcting the paperwork is easy;
-- correcting the stock is the real work, and once stock has been put away and issued it
-- is in bins and departments and cannot be attributed back to a line. Amending the
-- document anyway would leave a register that disagrees with the shelf, which is worse
-- than one that admits it cannot help.
--
-- The second is that the original survives and stays visible. A trail nobody can read is
-- not a trail.

begin;
select plan(22);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000da01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.am@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000da02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.am@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000da03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.an@example.test', '', now(), now());

select system.provision_property('admin.am@example.test', 'Group AM', 'AM', 'Property AM');
select system.provision_property('admin.an@example.test', 'Group AN', 'AN', 'Property AN');
select system.grant_property_role('store.am@example.test', 'AM', 'STOREKEEPER');

create temporary table ctx as
select
  (select id from public.property where code = 'AM')                                  as prop,
  (select id from public.property where code = 'AN')                                  as other,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'AM' and c.code = 'PROVISIONS')                                   as cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'AM' and u.code = 'KG')                                           as uom,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'AM' and l.code = 'AM-T1-RCV')                                    as rcv,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'AM' and l.code = 'AM-T1-REJ')                                    as rej,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'AM' and l.code = 'AM-DRY')                                       as dry;

grant select on ctx to authenticated;

insert into public.location (id, property_id, code, name, kind, parent_id, regime)
select '00000000-0000-0000-0000-0000000da101', prop, 'AM-DRY-R1-B1', 'Dry bin 1',
       'BIN', dry, 'AMBIENT' from ctx;

insert into public.item (id, property_id, code, name, category_id, base_uom_id)
select '00000000-0000-0000-0000-0000000da001', prop, 'ATTA', 'Wheat Flour', cat, uom from ctx;
insert into public.item (id, property_id, code, name, category_id, base_uom_id)
select '00000000-0000-0000-0000-0000000da002', prop, 'RICE', 'Joha Rice', cat, uom from ctx;

insert into public.party (id, property_id, code, name)
select '00000000-0000-0000-0000-0000000da010', prop, 'AM-VEN-000001', 'Bhaskar Supply' from ctx;

insert into public.gate_entry (id, property_id, gate_entry_no, party_id, bill, package_count)
select '00000000-0000-0000-0000-0000000da020', prop, 'AM-GE-000001',
       '00000000-0000-0000-0000-0000000da010', 'NONE', 8 from ctx;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000da02","role":"authenticated"}';

-- The fat-finger this whole function exists for: four hundred typed instead of forty.
select is(
  (select g.grn_no from public.post_grn(
     (select prop from ctx), '00000000-0000-0000-0000-0000000da020',
     '00000000-0000-0000-0000-0000000da010', 'am-post-1',
     jsonb_build_array(
       jsonb_build_object(
         'item_id', '00000000-0000-0000-0000-0000000da001',
         'uom_id', (select uom from ctx), 'batch_no', 'V-ATTA-1',
         'qty_challan', 40, 'qty_physical', 400, 'qty_accepted', 400, 'qty_rejected', 0,
         'decision', 'ACCEPT'),
       jsonb_build_object(
         'item_id', '00000000-0000-0000-0000-0000000da002',
         'uom_id', (select uom from ctx), 'batch_no', 'V-RICE-1',
         'qty_physical', 50, 'qty_accepted', 45, 'qty_rejected', 5,
         'decision', 'ACCEPT_PARTIAL', 'reject_reason', 'DAMAGED')
     )) g),
  'AM-GRN-000001',
  'a receipt posts with four hundred kilos typed where forty arrived'
);

-- ---------------------------------------------------------------------------
-- Who may correct it
-- ---------------------------------------------------------------------------

select throws_like(
  $q$ select * from public.amend_grn(
        (select prop from ctx),
        (select id from public.grn where grn_no = 'AM-GRN-000001'),
        'Typed 400 instead of 40', 'am-amend-storekeeper',
        jsonb_build_array(jsonb_build_object(
          'grn_line_id', (select gl.id from public.grn_line gl
                            join public.grn g on g.id = gl.grn_id
                           where g.grn_no = 'AM-GRN-000001'
                             and gl.item_id = '00000000-0000-0000-0000-0000000da001'),
          'qty_physical', 40, 'qty_accepted', 40, 'qty_rejected', 0))) $q$,
  '%deliberately not the person who posted it%',
  'the storekeeper who posted it cannot quietly correct it — one person cannot be both ends of a control'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000da01","role":"authenticated"}';

select throws_like(
  $q$ select * from public.amend_grn(
        (select prop from ctx),
        (select id from public.grn where grn_no = 'AM-GRN-000001'),
        '   ', 'am-amend-noreason',
        jsonb_build_array(jsonb_build_object(
          'grn_line_id', (select gl.id from public.grn_line gl
                            join public.grn g on g.id = gl.grn_id
                           where g.grn_no = 'AM-GRN-000001'
                             and gl.item_id = '00000000-0000-0000-0000-0000000da001'),
          'qty_physical', 40, 'qty_accepted', 40, 'qty_rejected', 0))) $q$,
  '%an edit wearing a document%',
  'and an amendment with no reason is refused, whoever is making it'
);

-- ---------------------------------------------------------------------------
-- The correction
-- ---------------------------------------------------------------------------

select is(
  (select a.grn_no from public.amend_grn(
     (select prop from ctx),
     (select id from public.grn where grn_no = 'AM-GRN-000001'),
     'Typed 400 instead of 40', 'am-amend-1',
     jsonb_build_array(jsonb_build_object(
       'grn_line_id', (select gl.id from public.grn_line gl
                         join public.grn g on g.id = gl.grn_id
                        where g.grn_no = 'AM-GRN-000001'
                          and gl.item_id = '00000000-0000-0000-0000-0000000da001'),
       'qty_physical', 40, 'qty_accepted', 40, 'qty_rejected', 0))) a),
  'AM-GRN-000002',
  'an owner corrects it, and the correction is a receipt of its own with its own number'
);

-- The original is never touched. The trail IS the chain (PRD section 4 Gate 5).
select is(
  (select qty_accepted from public.grn_line gl join public.grn g on g.id = gl.grn_id
    where g.grn_no = 'AM-GRN-000001' and gl.item_id = '00000000-0000-0000-0000-0000000da001'),
  400::numeric(14, 4),
  'the original still says four hundred, because it is what was posted'
);

select is(
  (select g.amendment_of = (select id from public.grn where grn_no = 'AM-GRN-000001')
     from public.grn g where g.grn_no = 'AM-GRN-000002'),
  true,
  'and the amendment points at what it supersedes'
);

-- The half that is not paperwork.
select is(
  (select qty from public.stock_lot
    where batch_id = (select id from public.batch where batch_no = 'V-ATTA-1')
      and state = 'QUARANTINE'),
  40::numeric(14, 4),
  'three hundred and sixty kilos that were never real have left the ledger'
);

-- Asserted by quantity rather than by the movement's idempotency key. The key carries the
-- line's position in the receipt, and grn_line rows written in one transaction share a
-- created_at — so the position is not determinable here even though it is stable within
-- any single call, which is all it has to be.
select is(
  (select qty from public.stock_movement
    where batch_id = (select id from public.batch where batch_no = 'V-ATTA-1')
      and reason = 'CORRECTION'),
  360::numeric(14, 4),
  'as a compensating movement of exactly what was never real, because nothing is ever edited out of an append-only ledger'
);

select is(
  (select count(*)::int from public.stock_movement
    where batch_id = (select id from public.batch where batch_no = 'V-ATTA-1')),
  2,
  'so the batch has two movements — what was posted, and what put it right'
);

-- Lines left out of the payload keep their figures. An amendment usually corrects one
-- line of six, and restating the other five is how the other five get restated wrongly.
select is(
  (select qty_accepted from public.grn_line gl join public.grn g on g.id = gl.grn_id
    where g.grn_no = 'AM-GRN-000002' and gl.item_id = '00000000-0000-0000-0000-0000000da002'),
  45::numeric(14, 4),
  'a line the amendment did not mention is carried forward unchanged'
);

select is(
  (select qty from public.stock_lot
    where batch_id = (select id from public.batch where batch_no = 'V-RICE-1')
      and state = 'REJECT_HOLD'),
  5::numeric(14, 4),
  'and its stock is untouched'
);

-- ---------------------------------------------------------------------------
-- The trail, as read
-- ---------------------------------------------------------------------------

select is(
  (select superseded_by_grn_no from public.list_receipts((select prop from ctx))
    where grn_no = 'AM-GRN-000001'),
  'AM-GRN-000002',
  'the receipts list shows the original as superseded rather than hiding it'
);

select is(
  (select amends_grn_no || '/' || amendment_reason
     from public.list_receipts((select prop from ctx)) where grn_no = 'AM-GRN-000002'),
  'AM-GRN-000001/Typed 400 instead of 40',
  'and shows what the amendment corrected and why'
);

-- An inspector's question is not what the receipt says now, but whether it was changed.
select is(
  (select count(*)::int from public.list_inward_register((select prop from ctx))
    where superseded_by_grn_no is not null),
  2,
  'the inward register keeps the superseded lines, marked, because the trail is the point'
);

-- ---------------------------------------------------------------------------
-- The chain has one head
-- ---------------------------------------------------------------------------

select throws_like(
  $q$ select * from public.amend_grn(
        (select prop from ctx),
        (select id from public.grn where grn_no = 'AM-GRN-000001'),
        'Again', 'am-amend-fork',
        jsonb_build_array(jsonb_build_object(
          'grn_line_id', (select gl.id from public.grn_line gl
                            join public.grn g on g.id = gl.grn_id
                           where g.grn_no = 'AM-GRN-000001'
                             and gl.item_id = '00000000-0000-0000-0000-0000000da001'),
          'qty_physical', 30, 'qty_accepted', 30, 'qty_rejected', 0))) $q$,
  '%has already been amended%',
  'a superseded receipt cannot be amended again — two corrections would each look authoritative'
);

-- ---------------------------------------------------------------------------
-- The refusal this function exists to make
-- ---------------------------------------------------------------------------
--
-- Once stock is put away it is in a bin, and an amendment reducing the line cannot say
-- which bin to take it out of. The paperwork could be corrected on its own; doing so
-- would leave a register that disagrees with the shelf.

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000da02","role":"authenticated"}';

select lives_ok(
  $q$ select * from public.put_away(
        (select prop from ctx), (select id from public.batch where batch_no = 'V-ATTA-1'),
        (select rcv from ctx), 'AM-DRY-R1-B1', 35, 'CAMERA', 'am-away-1') $q$,
  'thirty-five of the corrected forty are put away'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000da01","role":"authenticated"}';

select throws_like(
  $q$ select * from public.amend_grn(
        (select prop from ctx),
        (select id from public.grn where grn_no = 'AM-GRN-000002'),
        'Actually only twenty arrived', 'am-amend-2',
        jsonb_build_array(jsonb_build_object(
          'grn_line_id', (select gl.id from public.grn_line gl
                            join public.grn g on g.id = gl.grn_id
                           where g.grn_no = 'AM-GRN-000002'
                             and gl.item_id = '00000000-0000-0000-0000-0000000da001'),
          'qty_physical', 20, 'qty_accepted', 20, 'qty_rejected', 0))) $q$,
  '%has already been put away or issued, so only 5 can still be taken back%',
  'and now the receipt cannot be reduced further, said with the number that is still reachable'
);

select is(
  (select count(*)::int from public.grn where property_id = (select prop from ctx)),
  2,
  'the refused amendment left no receipt behind'
);

-- Correcting upwards is always possible: the stock simply arrives at Terminal 1, exactly
-- as it would have at posting.
select is(
  (select a.adjusted_lines from public.amend_grn(
     (select prop from ctx),
     (select id from public.grn where grn_no = 'AM-GRN-000002'),
     'A ninth sack was found on the vehicle', 'am-amend-3',
     jsonb_build_array(jsonb_build_object(
       'grn_line_id', (select gl.id from public.grn_line gl
                         join public.grn g on g.id = gl.grn_id
                        where g.grn_no = 'AM-GRN-000002'
                          and gl.item_id = '00000000-0000-0000-0000-0000000da001'),
       'qty_physical', 65, 'qty_accepted', 65, 'qty_rejected', 0))) a),
  1,
  'correcting upwards works, and reports how many lines moved stock'
);

select is(
  (select qty from public.stock_lot
    where batch_id = (select id from public.batch where batch_no = 'V-ATTA-1')
      and location_id = (select rcv from ctx) and state = 'QUARANTINE'),
  30::numeric(14, 4),
  'the extra twenty-five arrive at Terminal 1, where they would have gone at posting'
);

-- ---------------------------------------------------------------------------
-- Property boundaries and the ledger
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$ select * from public.amend_grn(
        (select other from ctx),
        (select id from public.grn where grn_no = 'AM-GRN-000003'),
        'Not mine', 'am-cross-1',
        jsonb_build_array(jsonb_build_object('grn_line_id', gen_random_uuid()))) $q$,
  '42501',
  null,
  'and amending at a property this user has no role at is refused'
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
  'and stock_lot still equals a full replay of the ledger after every correction'
);

reset role;
select * from finish();
rollback;
