-- The home screen's figures, and the screen that answers "where is it".
--
-- Both are SECURITY INVOKER, and that is the assertion this file exists for. A count is
-- only trustworthy if it counts the same rows the caller may read — so a second property's
-- stock must be invisible in both, and it must be invisible because RLS said so rather
-- than because the function remembered to filter. The two are indistinguishable when they
-- agree and catastrophic when they do not, which is why this runs as `authenticated`
-- against a fixture with two properties holding the same item codes.
--
-- The second assertion is that the stock report shows EVERY state. Listing only what is
-- issuable would make it tidier and would be the reason a physical count comes out short
-- with nothing to explain the difference: the pallet is not missing, it is standing at the
-- receiving bay.

begin;
select plan(18);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000cd01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.ov@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000cd02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.ov@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000cd03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'guard.ov@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000cd04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.ow@example.test', '', now(), now());

select system.provision_property('admin.ov@example.test', 'Group OV', 'OV', 'Property OV');
select system.provision_property('admin.ow@example.test', 'Group OW', 'OW', 'Property OW');
select system.grant_property_role('store.ov@example.test', 'OV', 'STOREKEEPER');
select system.grant_property_role('guard.ov@example.test', 'OV', 'SECURITY');

create temporary table ctx as
select
  (select id from public.property where code = 'OV')                                  as prop,
  (select id from public.property where code = 'OW')                                  as other,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'OV' and c.code = 'PROVISIONS')                                   as cat,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'OW' and c.code = 'PROVISIONS')                                   as other_cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'OV' and u.code = 'KG')                                           as uom,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'OW' and u.code = 'KG')                                           as other_uom,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'OV' and l.code = 'OV-T1-RCV')                                    as rcv,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'OV' and l.code = 'OV-DRY')                                       as dry,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'OW' and l.code = 'OW-DRY')                                       as other_dry;

grant select on ctx to authenticated;

insert into public.location (id, property_id, code, name, kind, parent_id, regime)
select '00000000-0000-0000-0000-0000000cd101', prop, 'OV-DRY-R1-B1', 'Dry bin 1',
       'BIN', dry, 'AMBIENT' from ctx;
insert into public.location (id, property_id, code, name, kind, parent_id, regime)
select '00000000-0000-0000-0000-0000000cd102', prop, 'OV-DRY-R1-B2', 'Dry bin 2',
       'BIN', dry, 'AMBIENT' from ctx;

insert into public.item (id, property_id, code, name, category_id, base_uom_id,
                         is_perishable, is_batch_controlled, shelf_life_days)
select '00000000-0000-0000-0000-0000000cd001', prop, 'ATTA', 'Wheat Flour',
       cat, uom, true, true, 60 from ctx;

-- The same code at the other property. Anything that leaks will leak visibly.
insert into public.item (id, property_id, code, name, category_id, base_uom_id)
select '00000000-0000-0000-0000-0000000cd002', other, 'ATTA', 'Someone else''s flour',
       other_cat, other_uom from ctx;

-- One lot in each of the states that matter, so the report has something to be wrong
-- about: issuable, expiring, expired, and standing at Terminal 1.
insert into public.batch (id, property_id, item_id, batch_no, best_before,
                          shelf_life_total_days, source)
select '00000000-0000-0000-0000-0000000cd011', prop, '00000000-0000-0000-0000-0000000cd001',
       'ATTA-FRESH', current_date + 40, 60, 'OPENING_STOCK' from ctx;
insert into public.batch (id, property_id, item_id, batch_no, best_before,
                          shelf_life_total_days, source)
select '00000000-0000-0000-0000-0000000cd012', prop, '00000000-0000-0000-0000-0000000cd001',
       'ATTA-SOON', current_date + 3, 60, 'OPENING_STOCK' from ctx;
insert into public.batch (id, property_id, item_id, batch_no, best_before,
                          shelf_life_total_days, source)
select '00000000-0000-0000-0000-0000000cd013', prop, '00000000-0000-0000-0000-0000000cd001',
       'ATTA-GONE', current_date - 2, 60, 'OPENING_STOCK' from ctx;
insert into public.batch (id, property_id, item_id, batch_no, best_before,
                          shelf_life_total_days, source)
select '00000000-0000-0000-0000-0000000cd014', prop, '00000000-0000-0000-0000-0000000cd001',
       'ATTA-ATDOCK', current_date + 50, 60, 'OPENING_STOCK' from ctx;

insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state,
                                   qty, uom_id, reason, idempotency_key)
select prop, '00000000-0000-0000-0000-0000000cd011', '00000000-0000-0000-0000-0000000cd001',
       '00000000-0000-0000-0000-0000000cd101', 'AVAILABLE', 100, uom, 'OPENING_STOCK', 'ov-1' from ctx;
insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state,
                                   qty, uom_id, reason, idempotency_key)
select prop, '00000000-0000-0000-0000-0000000cd012', '00000000-0000-0000-0000-0000000cd001',
       '00000000-0000-0000-0000-0000000cd102', 'AVAILABLE', 50, uom, 'OPENING_STOCK', 'ov-2' from ctx;
insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state,
                                   qty, uom_id, reason, idempotency_key)
select prop, '00000000-0000-0000-0000-0000000cd013', '00000000-0000-0000-0000-0000000cd001',
       '00000000-0000-0000-0000-0000000cd102', 'AVAILABLE', 20, uom, 'OPENING_STOCK', 'ov-3' from ctx;
-- Backdated so the dwell figure has something to measure. now() does not advance inside a
-- transaction, so waiting is not an option.
insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state,
                                   qty, uom_id, reason, idempotency_key, occurred_at)
select prop, '00000000-0000-0000-0000-0000000cd014', '00000000-0000-0000-0000-0000000cd001',
       rcv, 'QUARANTINE', 30, uom, 'OPENING_STOCK', 'ov-4', now() - interval '9 hours' from ctx;

-- The other property's stock, in the same states, so a leak shows up as a wrong number
-- rather than as nothing at all.
insert into public.batch (id, property_id, item_id, batch_no, source)
select '00000000-0000-0000-0000-0000000cd021', other, '00000000-0000-0000-0000-0000000cd002',
       'THEIRS', 'OPENING_STOCK' from ctx;
insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state,
                                   qty, uom_id, reason, idempotency_key)
select other, '00000000-0000-0000-0000-0000000cd021', '00000000-0000-0000-0000-0000000cd002',
       other_dry, 'AVAILABLE', 999, other_uom, 'OPENING_STOCK', 'ow-1' from ctx;

-- Two arrivals, one of them stale, neither received.
insert into public.party (id, property_id, code, name)
select '00000000-0000-0000-0000-0000000cd030', prop, 'OV-VEN-000001', 'Bhaskar Supply' from ctx;
insert into public.gate_entry (property_id, gate_entry_no, party_id, bill, package_count, timestamp_in)
select prop, 'OV-GE-000001', '00000000-0000-0000-0000-0000000cd030', 'NONE', 4, now() from ctx;
insert into public.gate_entry (property_id, gate_entry_no, party_id, bill, package_count, timestamp_in)
select prop, 'OV-GE-000002', '00000000-0000-0000-0000-0000000cd030', 'NONE', 2,
       now() - interval '6 hours' from ctx;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000cd02","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- The overview
-- ---------------------------------------------------------------------------

select is(
  (select o.stock_lines from public.property_overview((select prop from ctx)) o),
  3,
  'issuable lots are counted, and the one at Terminal 1 is not among them'
);

select is(
  (select o.expired from public.property_overview((select prop from ctx)) o),
  1,
  'stock past its date is counted on its own — that is money already lost, not money at risk'
);

select is(
  (select o.expiring_soon from public.property_overview((select prop from ctx)) o),
  1,
  'and stock inside the window is counted separately from it'
);

-- The threshold is a parameter precisely so the domain package owns what it means. A
-- wider window has to move the figure, or passing it would be theatre.
select is(
  (select o.expiring_soon from public.property_overview((select prop from ctx), 60) o),
  2,
  'the window is the caller''s to set, so a wider one takes in more'
);

select is(
  (select o.arrivals_waiting || '/' || o.arrivals_overdue
     from public.property_overview((select prop from ctx)) o),
  '2/1',
  'both arrivals are outstanding and one has been at the gate too long'
);

select is(
  (select o.quarantine_lines from public.property_overview((select prop from ctx)) o),
  1,
  'the line standing at Terminal 1 is counted where somebody will act on it'
);

-- One number that says more than the count does: five lines put away this morning is
-- routine, one line standing since yesterday is not.
select cmp_ok(
  (select o.quarantine_oldest_hours from public.property_overview((select prop from ctx)) o),
  '>=',
  8.9::numeric,
  'with how long the oldest of them has stood there'
);

select is(
  (select o.bins || '/' || o.vendors from public.property_overview((select prop from ctx)) o),
  '2/1',
  'and the onboarding figures — bins built, vendors registered'
);

-- ---------------------------------------------------------------------------
-- Tenancy, which is the whole reason these are SECURITY INVOKER
-- ---------------------------------------------------------------------------

select is(
  (select o.items from public.property_overview((select prop from ctx)) o),
  1,
  'the other property''s identically-coded item is not counted here'
);

select is(
  (select o.stock_lines from public.property_overview((select other from ctx)) o),
  0,
  'and asking about a property this user cannot see returns zero rather than its contents'
);

-- ---------------------------------------------------------------------------
-- Where everything is
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.list_stock_on_hand((select prop from ctx))),
  4,
  'the report lists every lot holding stock, not only the issuable ones'
);

-- The assertion the screen exists for. A pallet at the receiving bay is not missing, and
-- a report that omits it is why a physical count comes out short with nothing to explain
-- the difference.
select is(
  (select array_agg(distinct state::text order by state::text)
     from public.list_stock_on_hand((select prop from ctx))),
  array['AVAILABLE', 'QUARANTINE'],
  'including the quarantined line, which is still the property''s stock'
);

select is(
  (select array_agg(batch_no order by ordinality)
     from public.list_stock_on_hand((select prop from ctx)) with ordinality),
  array['ATTA-GONE', 'ATTA-SOON', 'ATTA-FRESH', 'ATTA-ATDOCK'],
  'ordered by item then by expiry, so the batch to use next sits at the top of its group'
);

select is(
  (select days_remaining from public.list_stock_on_hand((select prop from ctx))
    where batch_no = 'ATTA-GONE'),
  -2,
  'and each lot says how far past its date it is'
);

select is(
  (select count(*)::int from public.list_stock_on_hand((select prop from ctx), 'ATTA-SOON')),
  1,
  'the search reaches a batch number, which is not on the screen to filter against'
);

select is(
  (select count(*)::int from public.list_stock_on_hand((select prop from ctx), 'OV-DRY-R1-B1')),
  1,
  'and a bin code, for when somebody is standing in front of one'
);

select is(
  (select count(*)::int from public.list_stock_on_hand((select other from ctx))),
  0,
  'another property''s stock is invisible, and invisible because RLS said so'
);

-- Security's whole definition is Gate 0 and Gate 10, and PRD section 11 deliberately
-- withholds stock.view from them: a guard has no reason to know what is in the cold room,
-- and a screen they never need is one they can get lost in at two in the morning. The
-- table policies do not encode that — this is the app's decision, so what must hold at the
-- database is only that a guard sees their OWN property and no other.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000cd03","role":"authenticated"}';

select is(
  (select count(*)::int from public.list_stock_on_hand((select other from ctx))),
  0,
  'a guard cannot read another property''s stock either'
);

reset role;
select * from finish();
rollback;
