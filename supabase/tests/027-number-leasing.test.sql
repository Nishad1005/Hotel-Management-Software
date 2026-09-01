-- Number block leasing (ADR 0005).
--
-- The one property that matters here is non-overlap: two leases, or a lease racing the
-- server-side allocator, must never hand out the same number — because after this lands,
-- the sync path treats a unique violation on gate_entry_no as "my own retry" and quietly
-- succeeds. If ranges could overlap, that assumption deletes another vehicle's arrival.
--
-- Run as `authenticated` throughout, per the repo rule: this schema has already shipped
-- a trigger that passed every test as the superuser and failed for the first real user.

begin;
select plan(12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000e701', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.g@lease.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000e702', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.g@lease.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000e703', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.h@lease.test', '', now(), now());

select system.provision_property('admin.g@lease.test', 'Group G', 'LG', 'Lease Property G');
select system.provision_property('admin.h@lease.test', 'Group H', 'LH', 'Lease Property H');
select system.grant_property_role('store.g@lease.test', 'LG', 'STOREKEEPER');

create temporary table ctx as
select
  (select id from public.property where code = 'LG') as prop,
  (select id from public.property where code = 'LH') as other;

grant select on ctx to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000e701","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- Blocks are carved without overlap
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select range_start, range_end, property_code
       from public.lease_document_numbers((select prop from ctx), 'GATE_ENTRY', 'device-a', 5) $$,
  $$ values (1::bigint, 5::bigint, 'LG'::text) $$,
  'first lease starts the series at 1 and carries the property code'
);

select results_eq(
  $$ select range_start, range_end
       from public.lease_document_numbers((select prop from ctx), 'GATE_ENTRY', 'device-b', 5) $$,
  $$ values (6::bigint, 10::bigint) $$,
  'a second lease continues where the first ended — no overlap'
);

-- A different document type draws from its own series, not gate entries'.
select results_eq(
  $$ select range_start
       from public.lease_document_numbers((select prop from ctx), 'GRN', 'device-a', 3) $$,
  $$ values (1::bigint) $$,
  'each document type is its own sequence'
);

-- The other property's series is untouched by everything above.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000e703","role":"authenticated"}';
select results_eq(
  $$ select range_start
       from public.lease_document_numbers((select other from ctx), 'GATE_ENTRY', 'device-h', 5) $$,
  $$ values (1::bigint) $$,
  'sequences are per property — one tenant''s leases never advance another''s'
);

-- ---------------------------------------------------------------------------
-- Authority mirrors the documents themselves
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000e702","role":"authenticated"}';

select throws_ok(
  $$ select * from public.lease_document_numbers((select prop from ctx), 'GATE_ENTRY', 'device-s', 10) $$,
  '42501',
  'Not permitted to lease numbers for this property.',
  'a storekeeper cannot lease gate entry numbers, exactly as they cannot insert gate entries'
);

select throws_ok(
  $$ select * from public.lease_document_numbers((select other from ctx), 'GATE_ENTRY', 'device-x', 10) $$,
  '42501',
  'Not permitted to lease numbers for this property.',
  'membership in one property leases nothing at another'
);

-- ---------------------------------------------------------------------------
-- Bounds
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000e701","role":"authenticated"}';

select throws_ok(
  $$ select * from public.lease_document_numbers((select prop from ctx), 'GATE_ENTRY', 'device-a', 0) $$,
  '22003',
  'Lease size must be between 1 and 500 numbers.',
  'zero numbers is not a lease'
);

select throws_ok(
  $$ select * from public.lease_document_numbers((select prop from ctx), 'GATE_ENTRY', 'device-a', 501) $$,
  '22003',
  'Lease size must be between 1 and 500 numbers.',
  'a runaway request cannot manufacture an unexplainable gap'
);

select throws_ok(
  $$ select * from public.lease_document_numbers((select prop from ctx), 'GATE_ENTRY', '   ', 10) $$,
  '22023',
  'A lease names the device it was issued to.',
  'a lease with no device would be a gap nobody can resolve'
);

-- ---------------------------------------------------------------------------
-- The record that explains the gaps
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select device_id, range_start, range_end
       from public.number_lease
      where property_id = (select prop from ctx) and doc_type = 'GATE_ENTRY'
      order by issued_at, range_start $$,
  $$ values ('device-a'::text, 1::bigint, 5::bigint), ('device-b'::text, 6::bigint, 10::bigint) $$,
  'members can read their property''s leases, newest gap to oldest, device by device'
);

select is(
  (select count(*)::int from public.number_lease where property_id = (select other from ctx)),
  0,
  'RLS: the other property''s leases are invisible from here'
);

-- The sequence has moved past every leased range, so the server-side allocator can
-- never re-issue a leased number.
reset role;
select is(
  (select next_value from public.number_sequence
    where property_id = (select prop from ctx) and doc_type = 'GATE_ENTRY'),
  11::bigint,
  'the shared sequence sits one past the last leased number'
);

select * from finish();
rollback;
