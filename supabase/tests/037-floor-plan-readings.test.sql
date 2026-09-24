-- What the floor plan's pins say — LFP-4.
--
-- The claims worth a test are the ones the contract makes about aggregation and about
-- tenancy, because both fail quietly. A pin that reads only the zone row shows "No
-- reading yet" over a bin that was read this morning, and nothing about the plan looks
-- wrong. A SECURITY INVOKER function that forgot RLS would show property A's chiller on
-- property B's plan, and the number would look perfectly plausible. So every figure is
-- asserted from a fixture where the bin, not the zone, holds the stock and the reading,
-- and where the second property holds the same shapes with different numbers.
--
-- Reads are ungated, so the storekeeper does the reading. The FB administrator does the
-- cross-tenant attempt, with FA's id handed over through `ctx` because RLS would never
-- let them find it.

begin;
select plan(16);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000fc01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.fa@pins.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000fc02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.fa@pins.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000fc03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.fb@pins.test', '', now(), now());

select system.provision_property('admin.fa@pins.test', 'Group FA', 'FA', 'Pins A');
select system.provision_property('admin.fb@pins.test', 'Group FB', 'FB', 'Pins B');
select system.grant_property_role('store.fa@pins.test', 'FA', 'STOREKEEPER');

create temporary table ctx as
select
  (select id from public.property where code = 'FA')                                  as prop,
  (select id from public.property where code = 'FB')                                  as other,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'FA' and c.code = 'PROVISIONS')                                   as cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'FA' and u.code = 'KG')                                           as uom,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'FB' and c.code = 'PROVISIONS')                                   as other_cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'FB' and u.code = 'KG')                                           as other_uom,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'FA' and l.code = 'FA-T1-RCV')                                    as rcv,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'FA' and l.code = 'FA-T2-DSP')                                    as dsp,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'FA' and l.code = 'FA-DRY')                                       as dry,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'FA' and l.code = 'FA-CHILL')                                     as chill,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'FA' and l.code = 'FA-FREEZE')                                    as frz,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'FB' and l.code = 'FB-CHILL')                                     as other_chill,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'FB' and l.code = 'FB-DRY')                                       as other_dry;

grant select on ctx to authenticated;

-- ---------------------------------------------------------------------------
-- Fixture: the bins hold everything, the zones hold almost nothing
-- ---------------------------------------------------------------------------

-- A rack under the dry store, and a bin under the rack — three levels, so the recursion
-- has something to recurse over. A bin under the cold room, one level.
insert into public.location (id, property_id, code, name, kind, parent_id, regime)
select '00000000-0000-0000-0000-0000000fc101', prop, 'FA-DRY-R1', 'Dry rack 1', 'RACK', dry, 'AMBIENT' from ctx;
insert into public.location (id, property_id, code, name, kind, parent_id, regime)
select '00000000-0000-0000-0000-0000000fc102', prop, 'FA-DRY-R1-B1', 'Dry bin 1', 'BIN',
       '00000000-0000-0000-0000-0000000fc101', 'AMBIENT' from ctx;
insert into public.location (id, property_id, code, name, kind, parent_id, regime)
select '00000000-0000-0000-0000-0000000fc103', prop, 'FA-CHILL-B1', 'Chill bin 1', 'BIN', chill, 'CHILLED' from ctx;
-- A retired bin with a reading on it. Retired places are not units any more.
insert into public.location (id, property_id, code, name, kind, parent_id, regime, is_active)
select '00000000-0000-0000-0000-0000000fc104', prop, 'FA-CHILL-B9', 'Old chill bin', 'BIN', chill, 'CHILLED', false from ctx;

insert into public.item (id, property_id, code, name, category_id, base_uom_id)
select '00000000-0000-0000-0000-0000000fc001', prop, 'RICE', 'Basmati', cat, uom from ctx;
insert into public.item (id, property_id, code, name, category_id, base_uom_id)
select '00000000-0000-0000-0000-0000000fc002', other, 'RICE', 'Their rice', other_cat, other_uom from ctx;

insert into public.batch (id, property_id, item_id, batch_no, source)
select '00000000-0000-0000-0000-0000000fc011', prop, '00000000-0000-0000-0000-0000000fc001', 'R-1', 'OPENING_STOCK' from ctx;
insert into public.batch (id, property_id, item_id, batch_no, source)
select '00000000-0000-0000-0000-0000000fc012', prop, '00000000-0000-0000-0000-0000000fc001', 'R-2', 'OPENING_STOCK' from ctx;
insert into public.batch (id, property_id, item_id, batch_no, source)
select '00000000-0000-0000-0000-0000000fc013', prop, '00000000-0000-0000-0000-0000000fc001', 'R-3', 'OPENING_STOCK' from ctx;
insert into public.batch (id, property_id, item_id, batch_no, source)
select '00000000-0000-0000-0000-0000000fc014', prop, '00000000-0000-0000-0000-0000000fc001', 'R-AT-DOCK', 'OPENING_STOCK' from ctx;
insert into public.batch (id, property_id, item_id, batch_no, source)
select '00000000-0000-0000-0000-0000000fc021', other, '00000000-0000-0000-0000-0000000fc002', 'THEIRS', 'OPENING_STOCK' from ctx;

-- Two lots in the bin two levels down, backdated so dwell has something to measure; one
-- lot straight into the zone, as opening stock may be.
insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason, idempotency_key, occurred_at)
select prop, '00000000-0000-0000-0000-0000000fc011', '00000000-0000-0000-0000-0000000fc001',
       '00000000-0000-0000-0000-0000000fc102', 'AVAILABLE', 25, uom, 'OPENING_STOCK', 'fa-1', now() - interval '3 hours' from ctx;
insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason, idempotency_key, occurred_at)
select prop, '00000000-0000-0000-0000-0000000fc012', '00000000-0000-0000-0000-0000000fc001',
       '00000000-0000-0000-0000-0000000fc102', 'AVAILABLE', 25, uom, 'OPENING_STOCK', 'fa-2', now() - interval '30 minutes' from ctx;
insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason, idempotency_key, occurred_at)
select prop, '00000000-0000-0000-0000-0000000fc013', '00000000-0000-0000-0000-0000000fc001',
       dry, 'AVAILABLE', 5, uom, 'OPENING_STOCK', 'fa-3', now() - interval '10 minutes' from ctx;
-- Standing at Terminal 1 for nine hours.
insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason, idempotency_key, occurred_at)
select prop, '00000000-0000-0000-0000-0000000fc014', '00000000-0000-0000-0000-0000000fc001',
       rcv, 'QUARANTINE', 30, uom, 'OPENING_STOCK', 'fa-4', now() - interval '9 hours' from ctx;
-- The other property: 999 in its dry store, a full day old.
insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason, idempotency_key, occurred_at)
select other, '00000000-0000-0000-0000-0000000fc021', '00000000-0000-0000-0000-0000000fc002',
       other_dry, 'AVAILABLE', 999, other_uom, 'OPENING_STOCK', 'fb-1', now() - interval '1 day' from ctx;

-- Temperature. The cold room ZONE was read yesterday at 4.0; its BIN just now at 3.2; its
-- retired bin even more recently at 99 (a value that would be unmissable if it leaked).
-- 'Just now' rather than 'this morning' because CI can run at 00:01 IST, and a reading
-- backdated two hours would then be yesterday's.
-- The freezer was read two days ago and not since. FB's cold room was read today at -1.0.
insert into public.temperature_reading (property_id, location_id, temperature_c, idempotency_key, recorded_at)
select prop, chill, 4.0, 'fa-t1', now() - interval '1 day' from ctx;
insert into public.temperature_reading (property_id, location_id, temperature_c, idempotency_key, recorded_at)
select prop, '00000000-0000-0000-0000-0000000fc103', 3.2, 'fa-t2', now() - interval '1 second' from ctx;
insert into public.temperature_reading (property_id, location_id, temperature_c, idempotency_key, recorded_at)
select prop, '00000000-0000-0000-0000-0000000fc104', 99.0, 'fa-t3', now() from ctx;
insert into public.temperature_reading (property_id, location_id, temperature_c, idempotency_key, recorded_at)
select prop, frz, -18.0, 'fa-t4', now() - interval '2 days' from ctx;
insert into public.temperature_reading (property_id, location_id, temperature_c, idempotency_key, recorded_at)
select other, other_chill, -1.0, 'fb-t1', now() from ctx;

-- One arrival not yet received; one returnable dispatch, promised back yesterday, three
-- of five still out.
insert into public.party (id, property_id, code, name)
select '00000000-0000-0000-0000-0000000fc030', prop, 'FA-VEN-000001', 'Bhaskar Supply' from ctx;
insert into public.gate_entry (property_id, gate_entry_no, party_id, bill, package_count)
select prop, 'FA-GE-000001', '00000000-0000-0000-0000-0000000fc030', 'NONE', 4 from ctx;
insert into public.dispatch_note (id, property_id, dispatch_no, dispatch_type, origin_location_id,
                                  is_returnable, expected_return_date)
select '00000000-0000-0000-0000-0000000fc040', prop, 'FA-DN-000001', 'EMPTIES', dsp, true, current_date - 1 from ctx;
insert into public.returnable_item (property_id, dispatch_note_id, qty_out, qty_returned)
select prop, '00000000-0000-0000-0000-0000000fc040', 5, 2 from ctx;

-- ---------------------------------------------------------------------------
-- The storekeeper reads the plan
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc02","role":"authenticated"}';

select is(
  (select count(*)::int from public.floor_plan_readings((select prop from ctx)) where scope = 'LOCATION'),
  3,
  'one LOCATION row per active zone — the three provisioning gave the property'
);

select is(
  (select count(*)::int from public.floor_plan_readings((select prop from ctx)) where scope = 'PROPERTY'),
  1,
  'and exactly one PROPERTY row'
);

-- Stock lines: two lots in the bin two levels down plus one straight in the zone.
select is(
  (select r.stock_lines from public.floor_plan_readings((select prop from ctx)) r
    where r.location_id = (select dry from ctx)),
  3,
  'a zone counts the lots in its bins two levels down AND the lot recorded against itself'
);

select is(
  (select r.stock_lines from public.floor_plan_readings((select prop from ctx)) r
    where r.location_id = (select chill from ctx)),
  0,
  'an empty zone says 0, not null — an empty store is a true reading'
);

-- Dwell: the oldest of the three lots is the one that arrived three hours ago.
select cmp_ok(
  (select r.dwell_minutes from public.floor_plan_readings((select prop from ctx)) r
    where r.location_id = (select dry from ctx)),
  '>=', 179.9::numeric,
  'the zone''s dwell is its longest-standing lot, wherever in the subtree it stands'
);
select cmp_ok(
  (select r.dwell_minutes from public.floor_plan_readings((select prop from ctx)) r
    where r.location_id = (select dry from ctx)),
  '<=', 180.1::numeric,
  '...and no longer than that'
);

select is(
  (select r.dwell_minutes from public.floor_plan_readings((select prop from ctx)) r
    where r.location_id = (select chill from ctx)),
  null::numeric,
  'no stock, no dwell'
);

-- Temperature: the bin's reading this morning beats the zone's from yesterday, and the
-- retired bin's alarming 99, newer still, is not a unit any more.
select is(
  (select r.latest_temp_c from public.floor_plan_readings((select prop from ctx)) r
    where r.location_id = (select chill from ctx)),
  3.2::numeric,
  'the cold room reports the newest reading in its subtree — the bin''s, not its own older one'
);

select is(
  (select r.temp_read_today from public.floor_plan_readings((select prop from ctx)) r
    where r.location_id = (select chill from ctx)),
  true,
  'and that reading counts as today'
);

select is(
  (select r.latest_temp_c || '/' || r.temp_read_today::text
     from public.floor_plan_readings((select prop from ctx)) r
    where r.location_id = (select frz from ctx)),
  '-18.0/false',
  'the freezer still shows its last reading, and says it was not today — the fact the round exists to change'
);

select is(
  (select r.temp_read_today from public.floor_plan_readings((select prop from ctx)) r
    where r.location_id = (select dry from ctx)),
  null::boolean,
  'a zone never read has no recency, rather than a false'
);

-- The property row: what is at Terminal 1, and the register.
select is(
  (select r.receiving_open from public.floor_plan_readings((select prop from ctx)) r where r.scope = 'PROPERTY'),
  1,
  'one arrival waiting to be received'
);

select cmp_ok(
  (select r.quarantine_max_hours from public.floor_plan_readings((select prop from ctx)) r where r.scope = 'PROPERTY'),
  '>=', 8.9::numeric,
  'and the lot at Terminal 1 has stood there nine hours'
);

select is(
  (select r.returnables_outstanding || '/' || r.returnables_overdue
     from public.floor_plan_readings((select prop from ctx)) r where r.scope = 'PROPERTY'),
  '3/1',
  'three returnables still out, on one promise that is overdue'
);

-- ---------------------------------------------------------------------------
-- The other property's administrator
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc03","role":"authenticated"}';

select is(
  (select count(*)::int from public.floor_plan_readings((select prop from ctx))),
  0,
  'asked about a property they cannot see, FB''s administrator gets no rows — not zeros that read as quiet'
);

select is(
  (select r.latest_temp_c || '/' || r.stock_lines
     from public.floor_plan_readings((select other from ctx)) r
    where r.location_id = (select other_chill from ctx)),
  '-1.0/0',
  'and their own plan shows their own reading, with none of FA''s stock on it'
);

select * from finish();
rollback;
