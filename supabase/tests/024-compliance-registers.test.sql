-- The FSSAI registers, and the claim they rest on.
--
-- PRD section 7.1: the compliance module is not a checklist app beside the flow, it runs
-- on data the flow already holds. Nothing is entered twice — that is the product argument.
--
-- So this file writes NOTHING a register needs. It runs the ordinary flow — an arrival, a
-- receipt with one line accepted and one turned away, a put-away, an issue, and waste sent
-- out — and then asserts that four registers filled themselves. Any assertion below that
-- needed a setup statement of its own would be the claim failing.
--
-- As `authenticated` throughout, because a register nobody but the superuser can read is
-- not a register.

begin;
select plan(22);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000ce01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.rg@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000ce02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.rg@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000ce03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'guard.rg@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000ce04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.rh@example.test', '', now(), now());

select system.provision_property('admin.rg@example.test', 'Group RG', 'RG', 'Property RG');
select system.provision_property('admin.rh@example.test', 'Group RH', 'RH', 'Property RH');
select system.grant_property_role('store.rg@example.test', 'RG', 'STOREKEEPER');
select system.grant_property_role('guard.rg@example.test', 'RG', 'SECURITY');

create temporary table ctx as
select
  (select id from public.property where code = 'RG')                                  as prop,
  (select id from public.property where code = 'RH')                                  as other,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'RG' and c.code = 'DAIRY')                                        as cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'RG' and u.code = 'L')                                            as uom_l,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'RG' and u.code = 'KG')                                           as uom_kg,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'RG' and l.code = 'RG-T1-RCV')                                    as rcv,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'RG' and l.code = 'RG-T1-REJ')                                    as rej,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'RG' and l.code = 'RG-CHILL')                                     as chill,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'RG' and l.code = 'RG-DEPT-KIT')                                  as kitchen;

grant select on ctx to authenticated;

insert into public.location (id, property_id, code, name, kind, parent_id, regime)
select '00000000-0000-0000-0000-0000000ce101', prop, 'RG-CHILL-R1-B1', 'Cold room bin 1',
       'BIN', chill, 'CHILLED' from ctx;

insert into public.item (id, property_id, code, name, category_id, base_uom_id,
                         is_perishable, is_cold_chain, is_batch_controlled,
                         shelf_life_days, temp_min_c, temp_max_c, storage_regime)
select '00000000-0000-0000-0000-0000000ce001', prop, 'MILK-1L', 'Toned Milk 1L',
       cat, uom_l, true, true, true, 10, 0, 5, 'CHILLED' from ctx;

insert into public.item (id, property_id, code, name, category_id, base_uom_id)
select '00000000-0000-0000-0000-0000000ce002', prop, 'UCO', 'Used Cooking Oil', cat, uom_kg from ctx;

insert into public.party (id, property_id, code, name, fssai_licence)
select '00000000-0000-0000-0000-0000000ce010', prop, 'RG-VEN-000001',
       'Bhaskar Dairy', '10021064001234' from ctx;

insert into public.party (id, property_id, code, name, party_type, fssai_licence)
select '00000000-0000-0000-0000-0000000ce011', prop, 'RG-VEN-000002',
       'Assam Biodiesel', 'AGGREGATOR', '10021064009999' from ctx;

insert into public.gate_entry (id, property_id, gate_entry_no, party_id, bill, package_count)
select '00000000-0000-0000-0000-0000000ce020', prop, 'RG-GE-000001',
       '00000000-0000-0000-0000-0000000ce010', 'NONE', 6 from ctx;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ce02","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- The ordinary flow. Nothing below is done for a register.
-- ---------------------------------------------------------------------------
--
-- One line taken at 3.5 degrees, which is inside the item's range. One line turned away
-- at 11 degrees, which is not. Both are recorded because a storekeeper was standing at a
-- dock, not because anybody was thinking about an inspection.

select is(
  (select g.grn_no from public.post_grn(
     (select prop from ctx), '00000000-0000-0000-0000-0000000ce020',
     '00000000-0000-0000-0000-0000000ce010', 'rg-post-1',
     jsonb_build_array(
       jsonb_build_object(
         'item_id', '00000000-0000-0000-0000-0000000ce001',
         'uom_id', (select uom_l from ctx), 'batch_no', 'V-MILK-GOOD',
         'qty_challan', 40, 'qty_physical', 40, 'qty_accepted', 40, 'qty_rejected', 0,
         'decision', 'ACCEPT',
         'best_before', (current_date + 10)::text, 'receipt_temp_c', 3.5),
       jsonb_build_object(
         'item_id', '00000000-0000-0000-0000-0000000ce001',
         'uom_id', (select uom_l from ctx), 'batch_no', 'V-MILK-WARM',
         'qty_physical', 20, 'qty_accepted', 0, 'qty_rejected', 20,
         'decision', 'REJECT', 'reject_reason', 'NOT_COLD_ENOUGH',
         'best_before', (current_date + 9)::text, 'receipt_temp_c', 11.0)
     )) g),
  'RG-GRN-000001',
  'a delivery is received: one line taken, one turned away for being warm'
);

select lives_ok(
  $q$ select * from public.put_away(
        (select prop from ctx), (select id from public.batch where batch_no = 'V-MILK-GOOD'),
        (select rcv from ctx), 'RG-CHILL-R1-B1', 40, 'CAMERA', 'rg-away-1') $q$,
  'and put away into the cold room'
);

select lives_ok(
  $q$ select * from public.issue_stock(
        (select prop from ctx), (select kitchen from ctx), 'Ranjit Gogoi', 'Breakfast',
        'rg-issue-1',
        jsonb_build_array(jsonb_build_object(
          'batch_id', (select id from public.batch where batch_no = 'V-MILK-GOOD'),
          'from_location_id', '00000000-0000-0000-0000-0000000ce101', 'qty', 15))) $q$,
  'then fifteen litres go to the kitchen'
);

-- Used cooking oil, which FSSAI requires a register for and which already leaves through
-- Terminal 2. Opening stock rather than a receipt, because a kitchen produces it.
insert into public.batch (id, property_id, item_id, batch_no, source)
select '00000000-0000-0000-0000-0000000ce201', prop, '00000000-0000-0000-0000-0000000ce002',
       'UCO-WEEK-33', 'OPENING_STOCK' from ctx;
insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state,
                                   qty, uom_id, reason, idempotency_key)
select prop, '00000000-0000-0000-0000-0000000ce201', '00000000-0000-0000-0000-0000000ce002',
       chill, 'AVAILABLE', 30, uom_kg, 'OPENING_STOCK', 'rg-uco-1' from ctx;

select is(
  (select d.dispatch_no from public.stage_for_dispatch(
     (select prop from ctx), 'USED_COOKING_OIL', '00000000-0000-0000-0000-0000000ce011',
     'Weekly collection', false, null, 'rg-stage-1',
     jsonb_build_array(jsonb_build_object(
       'batch_id', '00000000-0000-0000-0000-0000000ce201',
       'from_location_id', (select chill from ctx), 'from_state', 'AVAILABLE', 'qty', 30))) d),
  'RG-DN-000001',
  'and thirty kilos of used cooking oil are staged for the aggregator'
);

-- ---------------------------------------------------------------------------
-- The inward material check — filled itself
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.list_inward_register((select prop from ctx))),
  2,
  'the inward register has both lines, and nobody wrote it'
);

select is(
  (select vendor_name || '/' || vendor_fssai from public.list_inward_register((select prop from ctx))
    where batch_no = 'V-MILK-GOOD'),
  'Bhaskar Dairy/10021064001234',
  'carrying the vendor and their licence number, from the master rather than retyped'
);

select is(
  (select gate_entry_no from public.list_inward_register((select prop from ctx))
    where batch_no = 'V-MILK-GOOD'),
  'RG-GE-000001',
  'and the gate entry the consignment arrived on'
);

select is(
  (select received_by from public.list_inward_register((select prop from ctx))
    where batch_no = 'V-MILK-GOOD'),
  'store.rg@example.test',
  'and who received it, snapshotted so deleting the user cannot empty the register'
);

-- ---------------------------------------------------------------------------
-- The receipt temperature record — the same rows, a different question
-- ---------------------------------------------------------------------------

select is(
  (select temp_in_range from public.list_inward_register((select prop from ctx))
    where batch_no = 'V-MILK-GOOD'),
  true,
  'three and a half degrees is inside the item''s range, and the register says so'
);

select is(
  (select temp_in_range from public.list_inward_register((select prop from ctx))
    where batch_no = 'V-MILK-WARM'),
  false,
  'eleven is not, and it is judged against the item master rather than a typed opinion'
);

-- Compared as numbers rather than as a formatted string: numeric(5,2) renders as "11.00"
-- and a test that asserts the rendering fails the day a column's scale changes for a
-- reason that has nothing to do with what it is checking.
select ok(
  (select receipt_temp_c = 11 and temp_min_c = 0 and temp_max_c = 5
     from public.list_inward_register((select prop from ctx)) where batch_no = 'V-MILK-WARM'),
  'with the reading and the range it was judged against, so the row can be argued with'
);

-- ---------------------------------------------------------------------------
-- Non-conforming material — a filter, not a second register
-- ---------------------------------------------------------------------------

select is(
  (select batch_no || '/' || reject_reason::text
     from public.list_inward_register((select prop from ctx)) where decision <> 'ACCEPT'),
  'V-MILK-WARM/NOT_COLD_ENOUGH',
  'the non-conforming register is the same rows filtered, with the reason given at the dock'
);

-- ---------------------------------------------------------------------------
-- Waste disposal
-- ---------------------------------------------------------------------------

select ok(
  (select dispatch_type = 'USED_COOKING_OIL' and recipient_name = 'Assam Biodiesel' and qty = 30
     from public.list_waste_register((select prop from ctx))),
  'used cooking oil appears in the waste register as a view of dispatch, not a second log'
);

-- Staged and not yet gone. The row an inspector would want, and the one a register of
-- completed departures would hide.
select is(
  (select gate_pass_no from public.list_waste_register((select prop from ctx))),
  null::text,
  'and shows as open while it is still on the property'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ce03","role":"authenticated"}';

select lives_ok(
  $q$ select * from public.issue_gate_pass(
        (select prop from ctx),
        (select id from public.dispatch_note where dispatch_no = 'RG-DN-000001'),
        'Ramen Das', 'AS-23-C-4471', 2, 'rg-pass-1') $q$,
  'Security passes the oil out'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ce02","role":"authenticated"}';

select is(
  (select gate_pass_no || '/' || carrier || '/' || vehicle_number
     from public.list_waste_register((select prop from ctx))),
  'RG-GP-000001/Ramen Das/AS-23-C-4471',
  'and the register closes itself with the pass, the carrier and the vehicle'
);

-- ---------------------------------------------------------------------------
-- Traceability — PRD section 7.5
-- ---------------------------------------------------------------------------

-- The SET of steps, not their order, and that is a limit of the test rather than of the
-- trace. `now()` is frozen for the life of a transaction, so all three movements here
-- carry the identical occurred_at and their sequence is not determinable — in production
-- receiving, put-away and issuing are three transactions minutes apart and the ordering
-- holds. Asserting a sequence that only appears to work would be worse than saying so.
select is(
  (select array_agg(distinct reason::text order by reason::text)
     from public.trace_batch(
       (select prop from ctx),
       (select id from public.batch where batch_no = 'V-MILK-GOOD'))),
  array['GRN_POSTING', 'ISSUE', 'PUT_AWAY'],
  'the forward trace holds every step the batch went through: received, put away, issued'
);

select is(
  (select to_code from public.trace_batch(
     (select prop from ctx),
     (select id from public.batch where batch_no = 'V-MILK-GOOD'))
    where reason = 'ISSUE'),
  'RG-DEPT-KIT',
  'ending at the department that took it'
);

-- Hard rule 13 wants a scanned bin and this build permits typing, so the trail has to say
-- which happened. A trace that omitted it would assert more than took place.
select is(
  (select scan_method::text from public.trace_batch(
     (select prop from ctx),
     (select id from public.batch where batch_no = 'V-MILK-GOOD'))
    where reason = 'PUT_AWAY'),
  'CAMERA',
  'and saying how the bin was established at the one step that had one'
);

select is(
  (select vendor_name || '/' || gate_entry_no || '/' || grn_no
     from public.batch_provenance(
       (select prop from ctx),
       (select id from public.batch where batch_no = 'V-MILK-GOOD'))),
  'Bhaskar Dairy/RG-GE-000001/RG-GRN-000001',
  'and the provenance answers where it came from without a second lookup'
);

-- An opening balance has no vendor because nobody delivered it. Returned with nulls rather
-- than omitted: it is still traceable forward, and saying it has no receipt is the honest
-- answer to a recall asking about it.
select is(
  (select source::text || '/' || coalesce(vendor_name, 'none')
     from public.batch_provenance((select prop from ctx),
                                  '00000000-0000-0000-0000-0000000ce201')),
  'OPENING_STOCK/none',
  'a batch counted onto the books is traceable too, and says plainly it has no vendor'
);

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.list_inward_register((select other from ctx))),
  0,
  'and none of it is visible from another property, because every register is invoker-side'
);

reset role;
select * from finish();
rollback;
