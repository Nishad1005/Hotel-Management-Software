-- Gate 8 — zone to department.
--
-- Two assertions carry this file, and they pull in opposite directions on purpose.
--
-- The first is that an issue and its acknowledgement are one transaction. An issue is not
-- closed until it is acknowledged (PRD section 4 Gate 8), and an acknowledgement written
-- by a second call is one that can fail to arrive — leaving stock that has left the store
-- with nobody's name against it.
--
-- The second is that `verified_by_scan` is FALSE. Acceptance criterion 17 requires a card
-- scan and this build takes a typed name. The register must say so, and this test is what
-- stops the day somebody flips the default to true because it looks better on a demo.

begin;
select plan(19);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.is@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000fa02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.is@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000fa03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chef.is@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000fa04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.ib@example.test', '', now(), now());

select system.provision_property('admin.is@example.test', 'Group IS', 'IS', 'Property IS');
select system.provision_property('admin.ib@example.test', 'Group IB', 'IB', 'Property IB');
select system.grant_property_role('store.is@example.test', 'IS', 'STOREKEEPER');
-- A chef receives issues by presenting a card; they do not operate the app (PRD section
-- 11), and the negative below is what keeps that true.
select system.grant_property_role('chef.is@example.test', 'IS', 'CHEF');

create temporary table ctx as
select
  (select id from public.property where code = 'IS')                                  as prop,
  (select id from public.property where code = 'IB')                                  as other,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'IS' and c.code = 'PROVISIONS')                                   as cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'IS' and u.code = 'KG')                                           as uom,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'IS' and l.code = 'IS-DRY')                                       as dry,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'IS' and l.code = 'IS-DEPT-KIT')                                  as kitchen,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'IB' and l.code = 'IB-DEPT-KIT')                                  as other_kitchen;

grant select on ctx to authenticated;

-- The seed itself is an assertion: a property that cannot issue on its first morning is
-- a property the storekeeper works around.
select is(
  (select count(*)::int from public.location l join public.property p on p.id = l.property_id
    where p.code = 'IS' and l.kind = 'DEPARTMENT'),
  8,
  'a new property comes with departments, so issuing works on day one'
);

insert into public.location (id, property_id, code, name, kind, parent_id, regime)
select '00000000-0000-0000-0000-0000000fa101', prop, 'IS-DRY-R1-B1', 'Dry bin 1',
       'BIN', dry, 'AMBIENT' from ctx;

insert into public.item (id, property_id, code, name, category_id, base_uom_id,
                         is_perishable, is_batch_controlled, shelf_life_days)
select '00000000-0000-0000-0000-0000000fa001', prop, 'ATTA', 'Wheat Flour',
       cat, uom, true, true, 60 from ctx;

-- Three batches: one fresh, one closer to expiry, one already gone. FEFO has to put them
-- in that order backwards, and the expired one has to be issuable but recorded.
insert into public.batch (id, property_id, item_id, batch_no, best_before,
                          shelf_life_total_days, source, created_at)
select '00000000-0000-0000-0000-0000000fa011', prop, '00000000-0000-0000-0000-0000000fa001',
       'ATTA-FRESH', current_date + 40, 60, 'OPENING_STOCK', now() from ctx;
insert into public.batch (id, property_id, item_id, batch_no, best_before,
                          shelf_life_total_days, source, created_at)
select '00000000-0000-0000-0000-0000000fa012', prop, '00000000-0000-0000-0000-0000000fa001',
       'ATTA-SOON', current_date + 3, 60, 'OPENING_STOCK', now() from ctx;
insert into public.batch (id, property_id, item_id, batch_no, best_before,
                          shelf_life_total_days, source, created_at)
select '00000000-0000-0000-0000-0000000fa013', prop, '00000000-0000-0000-0000-0000000fa001',
       'ATTA-GONE', current_date - 2, 60, 'OPENING_STOCK', now() from ctx;

insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state,
                                   qty, uom_id, reason, idempotency_key)
select prop, '00000000-0000-0000-0000-0000000fa011', '00000000-0000-0000-0000-0000000fa001',
       '00000000-0000-0000-0000-0000000fa101', 'AVAILABLE', 100, uom, 'OPENING_STOCK', 'is-o1' from ctx;
insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state,
                                   qty, uom_id, reason, idempotency_key)
select prop, '00000000-0000-0000-0000-0000000fa012', '00000000-0000-0000-0000-0000000fa001',
       '00000000-0000-0000-0000-0000000fa101', 'AVAILABLE', 50, uom, 'OPENING_STOCK', 'is-o2' from ctx;
insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state,
                                   qty, uom_id, reason, idempotency_key)
select prop, '00000000-0000-0000-0000-0000000fa013', '00000000-0000-0000-0000-0000000fa001',
       '00000000-0000-0000-0000-0000000fa101', 'AVAILABLE', 20, uom, 'OPENING_STOCK', 'is-o3' from ctx;

-- Quarantine stock, to prove it is not offered. Gate 6 exists precisely so that receiving
-- something does not make it issuable.
insert into public.batch (id, property_id, item_id, batch_no, best_before,
                          shelf_life_total_days, source)
select '00000000-0000-0000-0000-0000000fa014', prop, '00000000-0000-0000-0000-0000000fa001',
       'ATTA-JUSTIN', current_date + 55, 60, 'OPENING_STOCK' from ctx;
insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state,
                                   qty, uom_id, reason, idempotency_key)
select prop, '00000000-0000-0000-0000-0000000fa014', '00000000-0000-0000-0000-0000000fa001',
       (select l.id from public.location l join public.property p on p.id = l.property_id
         where p.code = 'IS' and l.code = 'IS-T1-RCV'),
       'QUARANTINE', 999, uom, 'OPENING_STOCK', 'is-o4' from ctx;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fa02","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- What may be issued, and in what order
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(batch_no order by ordinality)
     from public.list_issuable_stock((select prop from ctx), null) with ordinality),
  array['ATTA-GONE', 'ATTA-SOON', 'ATTA-FRESH'],
  'issuable stock comes back first-expired-first-out'
);

select is(
  (select count(*)::int from public.list_issuable_stock((select prop from ctx), null)
    where batch_no = 'ATTA-JUSTIN'),
  0,
  'and quarantined stock is not offered — put-away is what makes stock issuable'
);

-- ---------------------------------------------------------------------------
-- Issuing
-- ---------------------------------------------------------------------------

select is(
  (select r.issue_no from public.issue_stock(
     (select prop from ctx), (select kitchen from ctx),
     'Ranjit Gogoi', 'Breakfast prep', 'is-issue-1',
     jsonb_build_array(
       jsonb_build_object('batch_id', '00000000-0000-0000-0000-0000000fa012',
                          'from_location_id', '00000000-0000-0000-0000-0000000fa101', 'qty', 20),
       jsonb_build_object('batch_id', '00000000-0000-0000-0000-0000000fa011',
                          'from_location_id', '00000000-0000-0000-0000-0000000fa101', 'qty', 5)
     )) r),
  'IS-ISS-000001',
  'a storekeeper can issue to a department, under the property''s own numbering'
);

select is(
  (select qty from public.stock_lot
    where batch_id = '00000000-0000-0000-0000-0000000fa012'
      and location_id = '00000000-0000-0000-0000-0000000fa101'),
  30::numeric(14, 4),
  'the bin is drawn down'
);

-- Not a disappearance. Department-held stock stays visible and stays attributable to a
-- batch, which is what makes a recall reach the kitchen rather than stopping at the store.
select is(
  (select sum(qty)::numeric(14, 4) from public.stock_lot
    where location_id = (select kitchen from ctx) and state = 'ISSUED'),
  25::numeric(14, 4),
  'and the kitchen is holding it, still counted and still traceable'
);

-- ---------------------------------------------------------------------------
-- The acknowledgement, and what it does not claim
-- ---------------------------------------------------------------------------

select is(
  (select receiver_name from public.receipt_ack
     join public.issue_note n on n.id = receipt_ack.issue_note_id
    where n.issue_no = 'IS-ISS-000001'),
  'Ranjit Gogoi',
  'the acknowledgement is written in the same transaction as the movements'
);

-- The assertion that stops a demo-driven default change.
select is(
  (select verified_by_scan from public.receipt_ack
     join public.issue_note n on n.id = receipt_ack.issue_note_id
    where n.issue_no = 'IS-ISS-000001'),
  false,
  'and it does not claim a card was scanned, because none was — criterion 17 is not met'
);

select throws_like(
  $q$ select * from public.issue_stock(
        (select prop from ctx), (select kitchen from ctx), '   ', null, 'is-blank-1',
        jsonb_build_array(jsonb_build_object(
          'batch_id', '00000000-0000-0000-0000-0000000fa011',
          'from_location_id', '00000000-0000-0000-0000-0000000fa101', 'qty', 1))) $q$,
  '%Material does not change hands anonymously%',
  'a blank receiver is refused — a weak name beats no name, but nothing beats neither'
);

-- ---------------------------------------------------------------------------
-- Expired stock: recorded, not refused
-- ---------------------------------------------------------------------------
--
-- EXPIRED_STOCK_CANNOT_ISSUE ships RECORD_ONLY. A kitchen that cannot issue at seven in
-- the morning works around the system rather than around the expiry; what the system can
-- insist on is that the fact survives.

select is(
  (select r.expired_lines from public.issue_stock(
     (select prop from ctx), (select kitchen from ctx),
     'Ranjit Gogoi', null, 'is-issue-2',
     jsonb_build_array(jsonb_build_object(
       'batch_id', '00000000-0000-0000-0000-0000000fa013',
       'from_location_id', '00000000-0000-0000-0000-0000000fa101', 'qty', 2))) r),
  1,
  'expired stock can be issued, and the issue says how many lines were expired'
);

select is(
  (select days_remaining_at_issue from public.issue_line
     join public.issue_note n on n.id = issue_line.issue_note_id
    where n.issue_no = 'IS-ISS-000002'),
  -2,
  'and the line records how far gone it was, which is the register the rule exists to produce'
);

-- ---------------------------------------------------------------------------
-- The retry
-- ---------------------------------------------------------------------------

select is(
  (select r.issue_no from public.issue_stock(
     (select prop from ctx), (select kitchen from ctx),
     'Somebody Else', null, 'is-issue-1',
     jsonb_build_array(jsonb_build_object(
       'batch_id', '00000000-0000-0000-0000-0000000fa011',
       'from_location_id', '00000000-0000-0000-0000-0000000fa101', 'qty', 99))) r),
  'IS-ISS-000001',
  'a replayed submission returns the original issue rather than sending the stock twice'
);

select is(
  (select sum(qty)::numeric(14, 4) from public.stock_lot
    where location_id = (select kitchen from ctx) and state = 'ISSUED'),
  27::numeric(14, 4),
  'so the kitchen holds what it was actually given'
);

-- ---------------------------------------------------------------------------
-- What cannot be issued
-- ---------------------------------------------------------------------------

select throws_like(
  $q$ select * from public.issue_stock(
        (select prop from ctx), (select dry from ctx), 'Ranjit Gogoi', null, 'is-zone-1',
        jsonb_build_array(jsonb_build_object(
          'batch_id', '00000000-0000-0000-0000-0000000fa011',
          'from_location_id', '00000000-0000-0000-0000-0000000fa101', 'qty', 1))) $q$,
  '%is a zone, not a department%',
  'stock cannot be issued to a zone — it goes to whoever consumes it'
);

select throws_ok(
  $q$ select * from public.issue_stock(
        (select prop from ctx), (select other_kitchen from ctx), 'Ranjit Gogoi', null, 'is-cross-1',
        jsonb_build_array(jsonb_build_object(
          'batch_id', '00000000-0000-0000-0000-0000000fa011',
          'from_location_id', '00000000-0000-0000-0000-0000000fa101', 'qty', 1))) $q$,
  '42501',
  null,
  'nor to another property''s kitchen'
);

select throws_like(
  $q$ select * from public.issue_stock(
        (select prop from ctx), (select kitchen from ctx), 'Ranjit Gogoi', null, 'is-over-1',
        jsonb_build_array(jsonb_build_object(
          'batch_id', '00000000-0000-0000-0000-0000000fa011',
          'from_location_id', '00000000-0000-0000-0000-0000000fa101', 'qty', 9999))) $q$,
  '%Only 95 available on IS-DRY-R1-B1%',
  'and not more than the bin holds, said with the number and the place'
);

-- Quarantined stock has no AVAILABLE lot to draw from, so the refusal comes from the
-- ledger rather than from a rule anybody could relax.
select throws_like(
  $q$ select * from public.issue_stock(
        (select prop from ctx), (select kitchen from ctx), 'Ranjit Gogoi', null, 'is-quar-1',
        jsonb_build_array(jsonb_build_object(
          'batch_id', '00000000-0000-0000-0000-0000000fa014',
          'from_location_id', '00000000-0000-0000-0000-0000000fa101', 'qty', 1))) $q$,
  '%none of that batch here to move%',
  'stock that was never put away cannot be issued at all'
);

-- ---------------------------------------------------------------------------
-- Authority
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fa03","role":"authenticated"}';

select throws_ok(
  $q$ select * from public.issue_stock(
        (select prop from ctx), (select kitchen from ctx), 'Ranjit Gogoi', null, 'is-chef-1',
        jsonb_build_array(jsonb_build_object(
          'batch_id', '00000000-0000-0000-0000-0000000fa011',
          'from_location_id', '00000000-0000-0000-0000-0000000fa101', 'qty', 1))) $q$,
  '42501',
  null,
  'a chef receives issues by presenting a card, and does not operate the app'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fa02","role":"authenticated"}';

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
