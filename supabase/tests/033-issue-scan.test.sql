-- Scan to receive — criterion 17, and criterion 19 where it actually bites.
--
-- 021 asserts that an issue with a typed name records `verified_by_scan = false`, and
-- says in its own comment that it exists to stop somebody flipping that default because
-- it looks better on a demo. This file is the other half: the flag becomes true when, and
-- only when, a card was scanned.
--
-- The assertion that carries the file is the stopped card. Criterion 19 says a revoked
-- card stops working immediately and server-side, and the only place that claim can be
-- tested is here — at the moment somebody tries to take custody with it. A test that only
-- checked `is_active = false` on the row would prove the flag was written, not that it
-- refuses anybody.
--
-- Run as `authenticated` throughout, per the repo rule.

begin;
select plan(18);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000fe01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.sc@scan.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000fe02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.sc@scan.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000fe03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.sd@scan.test', '', now(), now());

select system.provision_property('admin.sc@scan.test', 'Group SC', 'SC', 'Scan A');
select system.provision_property('admin.sd@scan.test', 'Group SD', 'SD', 'Scan B');
select system.grant_property_role('store.sc@scan.test', 'SC', 'STOREKEEPER');

create temporary table ctx as
select
  (select id from public.property where code = 'SC')                                   as prop,
  (select id from public.property where code = 'SD')                                   as other,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'SC' and c.code = 'PROVISIONS')                                    as cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'SC' and u.code = 'KG')                                            as uom,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'SC' and l.code = 'SC-DRY')                                        as dry,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'SC' and l.code = 'SC-DEPT-KIT')                                   as kitchen;

grant select on ctx to authenticated;

insert into public.location (id, property_id, code, name, kind, parent_id, regime)
select '00000000-0000-0000-0000-0000000fe101', prop, 'SC-DRY-R1-B1', 'Dry bin 1',
       'BIN', dry, 'AMBIENT' from ctx;

insert into public.item (id, property_id, code, name, category_id, base_uom_id,
                         is_perishable, is_batch_controlled, shelf_life_days)
select '00000000-0000-0000-0000-0000000fe001', prop, 'RICE', 'Joha Rice',
       cat, uom, false, true, null from ctx;

insert into public.batch (id, property_id, item_id, batch_no, source, created_at)
select '00000000-0000-0000-0000-0000000fe011', prop, '00000000-0000-0000-0000-0000000fe001',
       'RICE-1', 'OPENING_STOCK', now() from ctx;

insert into public.stock_movement (property_id, batch_id, item_id, to_location_id, to_state,
                                   qty, uom_id, reason, idempotency_key)
select prop, '00000000-0000-0000-0000-0000000fe011', '00000000-0000-0000-0000-0000000fe001',
       '00000000-0000-0000-0000-0000000fe101', 'AVAILABLE', 500, uom, 'OPENING_STOCK', 'sc-o1'
  from ctx;

-- ---------------------------------------------------------------------------
-- Two cards: one that works and one that has been stopped
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000fe01"}', true);

select lives_ok(
  $q$ select public.create_person((select prop from ctx), 'Nabin Sharma') $q$,
  'a person to hold a card'
);
select lives_ok(
  $q$ select public.create_person((select prop from ctx), 'Former Contractor') $q$,
  'and one who will not be here long'
);
select lives_ok(
  $q$
    select public.set_person_active(
      (select prop from ctx),
      (select id from public.person where full_name = 'Former Contractor'),
      false,
      'Contract ended')
  $q$,
  'whose card is stopped on the way out'
);

-- Somebody else's person, to prove a card cannot cross a property boundary.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000fe03"}', true);
select lives_ok(
  $q$ select public.create_person((select other from ctx), 'Neighbour''s Steward') $q$,
  'a person at the other property'
);

/*
  That person's id, captured out of band.

  The first version looked it up inline while acting as SC's storekeeper, and RLS on
  `person` correctly returned nothing — so a NULL was passed as the card, the call took
  the no-card path, and the issue succeeded. The test then failed twice: once because no
  exception was raised, and once because the extra unverified acknowledgement pushed the
  count in the last assertion from two to three.

  Which is worth stating plainly: a storekeeper cannot reach another property's card
  through the API at all. The check inside issue_stock is defence in depth behind that,
  and the only way to exercise it is to hand it an id RLS would never have surrendered.
*/
reset role;
create temporary table neighbour as
  select id from public.person where full_name = 'Neighbour''s Steward';
grant select on neighbour to authenticated;
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Issuing against a card
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000fe02"}', true);

select lives_ok(
  $q$
    select public.issue_stock(
      (select prop from ctx), (select kitchen from ctx),
      'typed name nobody should see', null, 'sc-issue-1',
      jsonb_build_array(jsonb_build_object(
        'batch_id', '00000000-0000-0000-0000-0000000fe011',
        'from_location_id', '00000000-0000-0000-0000-0000000fe101',
        'qty', 5)),
      (select id from public.person where full_name = 'Nabin Sharma'),
      'CAMERA'::public.scan_method,
      null)
  $q$,
  'an issue against a scanned card'
);

select is(
  (select verified_by_scan from public.receipt_ack
    where property_id = (select prop from ctx)
      and receiver_name = 'Nabin Sharma'),
  true,
  'the acknowledgement is verified by scan — criterion 17 in one column'
);

select is(
  (select scan_method::text from public.receipt_ack
    where receiver_name = 'Nabin Sharma'),
  'CAMERA',
  'and records how the card was read'
);

select is(
  (select p.full_name from public.receipt_ack a
     join public.person p on p.id = a.receiver_person_id
    where a.receiver_name = 'Nabin Sharma'),
  'Nabin Sharma',
  'the master supplies the name, not whatever was typed'
);

-- ---------------------------------------------------------------------------
-- The stopped card — criterion 19, at the moment it matters
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$
    select public.issue_stock(
      (select prop from ctx), (select kitchen from ctx),
      'Former Contractor', null, 'sc-issue-2',
      jsonb_build_array(jsonb_build_object(
        'batch_id', '00000000-0000-0000-0000-0000000fe011',
        'from_location_id', '00000000-0000-0000-0000-0000000fe101',
        'qty', 5)),
      (select id from public.person where full_name = 'Former Contractor'),
      'CAMERA'::public.scan_method,
      null)
  $q$,
  '42501',
  null,
  'a stopped card cannot take custody of anything'
);

select throws_ok(
  $q$
    select public.issue_stock(
      (select prop from ctx), (select kitchen from ctx),
      'Neighbour', null, 'sc-issue-3',
      jsonb_build_array(jsonb_build_object(
        'batch_id', '00000000-0000-0000-0000-0000000fe011',
        'from_location_id', '00000000-0000-0000-0000-0000000fe101',
        'qty', 5)),
      (select id from neighbour),
      'CAMERA'::public.scan_method,
      null)
  $q$,
  '42501',
  null,
  'nor a card from another property'
);

select throws_ok(
  $q$
    select public.issue_stock(
      (select prop from ctx), (select kitchen from ctx),
      'Nabin Sharma', null, 'sc-issue-4',
      jsonb_build_array(jsonb_build_object(
        'batch_id', '00000000-0000-0000-0000-0000000fe011',
        'from_location_id', '00000000-0000-0000-0000-0000000fe101',
        'qty', 5)),
      (select id from public.person where full_name = 'Nabin Sharma'),
      null,
      null)
  $q$,
  '23514',
  null,
  'a scan with no method recorded is not a scan'
);

select throws_ok(
  $q$
    select public.issue_stock(
      (select prop from ctx), (select kitchen from ctx),
      'Nabin Sharma', null, 'sc-issue-5',
      jsonb_build_array(jsonb_build_object(
        'batch_id', '00000000-0000-0000-0000-0000000fe011',
        'from_location_id', '00000000-0000-0000-0000-0000000fe101',
        'qty', 5)),
      (select id from public.person where full_name = 'Nabin Sharma'),
      'CAMERA'::public.scan_method,
      'they forgot it')
  $q$,
  '23514',
  null,
  'a card that was scanned leaves nothing to override'
);

-- ---------------------------------------------------------------------------
-- The exception path, and the honest gap
-- ---------------------------------------------------------------------------

select lives_ok(
  $q$
    select public.issue_stock(
      (select prop from ctx), (select kitchen from ctx),
      'Ramen Kalita', null, 'sc-issue-6',
      jsonb_build_array(jsonb_build_object(
        'batch_id', '00000000-0000-0000-0000-0000000fe011',
        'from_location_id', '00000000-0000-0000-0000-0000000fe101',
        'qty', 5)),
      null, null, 'Card left at home, supervisor released it')
  $q$,
  'an override releases material without a card'
);

select is(
  (select override_reason from public.receipt_ack where receiver_name = 'Ramen Kalita'),
  'Card left at home, supervisor released it',
  'and the reason is on the record'
);

select is(
  (select verified_by_scan from public.receipt_ack where receiver_name = 'Ramen Kalita'),
  false,
  'an override is not a verification, and is not recorded as one'
);

/*
  The honest gap, and the reason this build records rather than blocks.

  No cards are printed yet. PRD section 2: where the property cannot comply, the system
  must not pretend it can — an unenforceable rule produces click-through and the record
  then carries a false assertion instead of a visible hole. So the old call shape still
  works, and what it produces is a row that says plainly it was never verified.

  This is also rule 20 in practice: a device on a six-month-old build calls the six
  argument form, and it must still be able to record a shift's work.
*/
select lives_ok(
  $q$
    select public.issue_stock(
      (select prop from ctx), (select kitchen from ctx),
      'Somebody With No Card', null, 'sc-issue-7',
      jsonb_build_array(jsonb_build_object(
        'batch_id', '00000000-0000-0000-0000-0000000fe011',
        'from_location_id', '00000000-0000-0000-0000-0000000fe101',
        'qty', 5)))
  $q$,
  'the six-argument call an older device makes still records an issue'
);

select is(
  (select verified_by_scan from public.receipt_ack where receiver_name = 'Somebody With No Card'),
  false,
  'and it is marked unverified, which is what makes the gap countable'
);

select is(
  (select count(*)::integer from public.receipt_ack
    where property_id = (select prop from ctx) and not verified_by_scan),
  2,
  'the property can count how often material changed hands without a card'
);

select * from finish();
rollback;
