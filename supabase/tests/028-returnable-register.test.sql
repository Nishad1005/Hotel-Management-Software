-- The returnable register: staged → outstanding → aged → returned.
--
-- The claim under test is continuity. A returnable dispatch creates its register row in
-- the same transaction as the note — there must be no state in which the flag exists
-- and the record does not, because that state is exactly what the app shipped with for
-- three weeks: crates leaving with `is_returnable = true` and nothing anywhere that
-- could notice they never came back.
--
-- The backfill for those three weeks runs at migration time against then-existing rows
-- and cannot be exercised from a fixture created after it; its correctness rests on the
-- migration replay itself.
--
-- Run as `authenticated` throughout, per the repo rule.

begin;
select plan(11);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000f801', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.rg@ret.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000f802', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.rg@ret.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000f803', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sec.rg@ret.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000f804', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.rh@ret.test', '', now(), now());

select system.provision_property('admin.rg@ret.test', 'Group RG', 'RG', 'Returnables G');
select system.provision_property('admin.rh@ret.test', 'Group RH', 'RH', 'Returnables H');
select system.grant_property_role('store.rg@ret.test', 'RG', 'STOREKEEPER');
select system.grant_property_role('sec.rg@ret.test', 'RG', 'SECURITY');

create temporary table ctx as
select
  (select id from public.property where code = 'RG')                                   as prop,
  (select id from public.property where code = 'RH')                                   as other,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'RG' and c.code = 'DAIRY')                                         as cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'RG' and u.code = 'KG')                                            as uom,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'RG' and l.code = 'RG-T1-REJ')                                     as rej;

grant select on ctx to authenticated;

insert into public.item (id, property_id, code, name, category_id, base_uom_id)
select '00000000-0000-0000-0000-0000000f8001', prop, 'CRATE', 'Milk Crate', cat, uom from ctx;

insert into public.party (id, property_id, code, name)
select '00000000-0000-0000-0000-0000000f8010', prop, 'RG-VEN-000001', 'Bhaskar Dairy' from ctx;

insert into public.gate_entry (id, property_id, gate_entry_no, party_id, bill, package_count)
select '00000000-0000-0000-0000-0000000f8020', prop, 'RG-GE-000001',
       '00000000-0000-0000-0000-0000000f8010', 'NONE', 2 from ctx;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f802","role":"authenticated"}';

-- A full reject is the shortest honest route to dispatchable stock (the recipe test 022
-- established): fifty units land in REJECT_HOLD in one call. The register mechanics
-- under test do not care which state the stock left from.
select is(
  (select g.grn_no from public.post_grn(
     (select prop from ctx), '00000000-0000-0000-0000-0000000f8020',
     '00000000-0000-0000-0000-0000000f8010', 'ret-post-1',
     jsonb_build_array(jsonb_build_object(
       'item_id', '00000000-0000-0000-0000-0000000f8001',
       'uom_id', (select uom from ctx), 'batch_no', 'CRATE-1',
       'qty_physical', 50, 'qty_accepted', 0, 'qty_rejected', 50,
       'decision', 'REJECT', 'reject_reason', 'DAMAGED'))) g),
  'RG-GRN-000001',
  'stock to send out, by way of a rejected consignment'
);

-- ---------------------------------------------------------------------------
-- Staging a returnable creates its register row; a plain dispatch does not
-- ---------------------------------------------------------------------------

select is(
  (select d.dispatch_no from public.stage_for_dispatch(
     (select prop from ctx), 'EMPTIES', '00000000-0000-0000-0000-0000000f8010',
     null, true, (current_date - 3),
     'ret-disp-1',
     jsonb_build_array(jsonb_build_object(
       'batch_id', (select b.id from public.batch b where b.batch_no = 'CRATE-1'),
       'from_location_id', (select rej from ctx), 'from_state', 'REJECT_HOLD', 'qty', 30))) d),
  'RG-DN-000001',
  'thirty crates leave on a promise to come back — three days ago'
);

select is(
  (select r.qty_out from public.returnable_item r
    join public.dispatch_note d on d.id = r.dispatch_note_id
   where d.dispatch_no = 'RG-DN-000001'),
  30::numeric(14, 4),
  'the register row exists in the same transaction as the note, for the full quantity'
);

select is(
  (select d.dispatch_no from public.stage_for_dispatch(
     (select prop from ctx), 'SCRAP', null,
     null, false, null,
     'ret-disp-2',
     jsonb_build_array(jsonb_build_object(
       'batch_id', (select b.id from public.batch b where b.batch_no = 'CRATE-1'),
       'from_location_id', (select rej from ctx), 'from_state', 'REJECT_HOLD', 'qty', 20))) d),
  'RG-DN-000002',
  'the remaining twenty leave for good, as scrap'
);

select is(
  (select count(*)::int from public.returnable_item where property_id = (select prop from ctx)),
  1,
  'a dispatch that promises no return puts nothing on the register'
);

-- ---------------------------------------------------------------------------
-- The register ages against the promise
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select dispatch_no, qty_out, qty_returned, outstanding, days_overdue
       from public.list_returnables((select prop from ctx)) $$,
  $$ values ('RG-DN-000001'::text, 30::numeric, 0::numeric, 30::numeric, 3) $$,
  'thirty out, nothing back, three days past the promise'
);

select results_eq(
  $$ select qty_out, qty_returned, outstanding
       from public.record_return((select prop from ctx),
         (select r.id from public.returnable_item r
           join public.dispatch_note d on d.id = r.dispatch_note_id
          where d.dispatch_no = 'RG-DN-000001'),
         10, 'two cracked') $$,
  $$ values (30::numeric, 10::numeric, 20::numeric) $$,
  'a partial return is recorded with its condition, twenty still out'
);

select throws_ok(
  $$ select * from public.record_return((select prop from ctx),
       (select r.id from public.returnable_item r
         join public.dispatch_note d on d.id = r.dispatch_note_id
        where d.dispatch_no = 'RG-DN-000001'),
       25, null) $$,
  '23514',
  'Only 20.0000 outstanding on this dispatch; 25 cannot come back.',
  'more cannot come back than remains out'
);

-- ---------------------------------------------------------------------------
-- Tenancy, and who stands at the gate
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f804","role":"authenticated"}';

select throws_ok(
  $$ select * from public.record_return((select prop from ctx),
       (select r.id from public.returnable_item r
         join public.dispatch_note d on d.id = r.dispatch_note_id
        where d.dispatch_no = 'RG-DN-000001'),
       5, null) $$,
  '42501',
  'You do not have permission to record returns at this property.',
  'the other property''s administrator records nothing here'
);

-- Returns arrive at the gate, so the officer who passed the crates out can receive
-- them back — SECURITY is in record_return's role set although not in dispatch's.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f803","role":"authenticated"}';

select results_eq(
  $$ select qty_out, qty_returned, outstanding
       from public.record_return((select prop from ctx),
         (select r.id from public.returnable_item r
           join public.dispatch_note d on d.id = r.dispatch_note_id
          where d.dispatch_no = 'RG-DN-000001'),
         20, 'all good') $$,
  $$ values (30::numeric, 30::numeric, 0::numeric) $$,
  'the security officer receives the last twenty at the gate'
);

select results_eq(
  $$ select qty_out, qty_returned, outstanding, days_overdue
       from public.list_returnables((select prop from ctx)) $$,
  $$ values (30::numeric, 30::numeric, 0::numeric, null::int) $$,
  'settled: nothing outstanding, and a settled row has no age'
);

select * from finish();
rollback;
