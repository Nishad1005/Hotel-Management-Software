-- Document numbers and the party master.
--
-- The assertion that matters most is that two allocations never return the same number.
-- A gate entry number is written by hand onto a vendor's challan and is the thing every
-- downstream record hangs off; a collision is not a duplicate row, it is two different
-- consignments claiming one identity, permanently.
--
-- The second is that the three party_id columns are no longer danglers — they have been
-- bare uuids since the flow spine landed, which meant a gate entry could name any
-- property's vendor, or a vendor that did not exist at all.

begin;
select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000c801', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.p@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000c802', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.p@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000c803', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.q@example.test', '', now(), now());

select system.provision_property('admin.p@example.test', 'Group P1', 'P1', 'Property P');
select system.provision_property('admin.q@example.test', 'Group Q1', 'Q1', 'Property Q');
select system.grant_property_role('store.p@example.test', 'P1', 'STOREKEEPER');

create temporary table ctx as
select
  (select id from public.property where code = 'P1') as prop,
  (select id from public.property where code = 'Q1') as other;

grant select on ctx to authenticated;

-- ---------------------------------------------------------------------------
-- Numbering
-- ---------------------------------------------------------------------------

select is(
  (select app.next_document_number((select prop from ctx), 'GRN')),
  'P1-GRN-000001',
  'the first number of a series carries the property code and the document type'
);

select is(
  (select app.next_document_number((select prop from ctx), 'GRN')),
  'P1-GRN-000002',
  'and the next one is the next one'
);

-- Each series counts independently, so a busy GRN sequence does not push gate passes
-- into six figures on day one.
select is(
  (select app.next_document_number((select prop from ctx), 'GATE_PASS')),
  'P1-GP-000001',
  'a different document type has its own series'
);

select is(
  (select app.next_document_number((select other from ctx), 'GRN')),
  'Q1-GRN-000001',
  'and so does a different property'
);

select is(
  (select next_value from public.number_sequence
    where property_id = (select prop from ctx) and doc_type = 'GRN'),
  3::bigint,
  'the counter is where it should be after two allocations'
);

-- ---------------------------------------------------------------------------
-- The party master
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c801","role":"authenticated"}';

select lives_ok(
  $q$ insert into public.party (id, property_id, code, name, party_type, phone)
      select '00000000-0000-0000-0000-0000000c8001', prop, 'P1-VEN-000001',
             'Bhaskar Fish Supply', 'VENDOR', '+919829012345' from ctx $q$,
  'an administrator can add a vendor'
);

select lives_ok(
  $q$ insert into public.party (property_id, code, name, party_type)
      select prop, 'P1-VEN-000002', 'Tinsukia Laundry', 'LAUNDRY' from ctx $q$,
  'and a laundry, because Terminal 2 scans one exactly as Terminal 1 scans a vendor'
);

-- A hold with no reason is a hold nobody can act on or argue with.
select throws_ok(
  $q$ insert into public.party (property_id, code, name, on_hold)
      select prop, 'P1-VEN-000009', 'Someone', true from ctx $q$,
  '23514',
  null,
  'a vendor cannot be put on hold without saying why'
);

-- ---------------------------------------------------------------------------
-- The columns that were dangling
-- ---------------------------------------------------------------------------

select lives_ok(
  $q$ insert into public.gate_entry
        (property_id, gate_entry_no, party_id, bill, package_count)
      select prop, 'P1-GE-000001', '00000000-0000-0000-0000-0000000c8001', 'NONE', 4
      from ctx $q$,
  'a gate entry can now name a real vendor'
);

select throws_ok(
  $q$ insert into public.gate_entry
        (property_id, gate_entry_no, party_id, bill, package_count)
      select prop, 'P1-GE-000002', gen_random_uuid(), 'NONE', 1 from ctx $q$,
  '23503',
  null,
  'and not one that does not exist — that column was a bare uuid until now'
);

-- ---------------------------------------------------------------------------
-- Authority and isolation
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c802","role":"authenticated"}';

select isnt_empty(
  $q$ select 1 from public.party where code = 'P1-VEN-000001' $q$,
  'a storekeeper can see the vendor list — they receive from it'
);

select throws_ok(
  $q$ insert into public.party (property_id, code, name)
      select prop, 'P1-VEN-000003', 'Sneaked in' from ctx $q$,
  '42501',
  null,
  'but cannot change it — Purchase owns that relationship'
);

select is(
  (select count(*)::int from public.number_sequence
     join public.property p on p.id = number_sequence.property_id
    where p.code = 'Q1'),
  0,
  'and sees nothing of another property''s numbering'
);

reset role;
select * from finish();
rollback;
