-- The evidence vault — PRD section 7.2, and the storage half of criteria 8 and 18.
--
-- Three properties carry this file, and each one is a claim the register makes to an
-- inspector rather than a convenience for the app.
--
-- Immutability first. A photograph that can be edited is not evidence, and the control is
-- two-layered on purpose: the grants withhold UPDATE and DELETE from every client, and a
-- trigger refuses them again so a future migration cannot quietly add a "just fix the
-- mime type" statement. Both layers are asserted, because testing only the grant would
-- pass on a database where the trigger had been dropped.
--
-- Then the size ceiling. PRD section 13 compresses client-side to under 400 KB; that is a
-- promise until the server also refuses, and a gate device on weak 4G is exactly where an
-- uncompressed original does its damage.
--
-- Then tenancy, which for a table of faces is the one that matters most.
--
-- Run as `authenticated` throughout, per the repo rule.

begin;
select plan(17);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000ff01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.ev@vault.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000ff02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.ev@vault.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000ff03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.ew@vault.test', '', now(), now());

select system.provision_property('admin.ev@vault.test', 'Group EV', 'EV', 'Vault A');
select system.provision_property('admin.ew@vault.test', 'Group EW', 'EW', 'Vault B');
select system.grant_property_role('store.ev@vault.test', 'EV', 'STOREKEEPER');

create temporary table ctx as
select
  (select id from public.property where code = 'EV') as prop,
  (select id from public.property where code = 'EW') as other;

grant select on ctx to authenticated;

-- An unregistered vendor rather than a party fixture: `gate_entry_has_a_vendor` requires
-- one or the other, and a name is the shorter road to an arrival worth photographing.
insert into public.gate_entry
  (id, property_id, gate_entry_no, unregistered_vendor_name, bill, package_count)
select '00000000-0000-0000-0000-0000000ff020', prop, 'EV-GE-000001',
       'Bhaskar Fish Supply', 'NONE', 4 from ctx;

-- The neighbour's arrival, which must not be attachable from here.
insert into public.gate_entry
  (id, property_id, gate_entry_no, unregistered_vendor_name, bill, package_count)
select '00000000-0000-0000-0000-0000000ff021', other, 'EW-GE-000001',
       'Someone Else''s Vendor', 'NONE', 1 from ctx;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000ff02"}', true);

-- ---------------------------------------------------------------------------
-- Attaching
-- ---------------------------------------------------------------------------

select lives_ok(
  $q$
    select public.attach_document(
      (select prop from ctx), 'GATE_ENTRY',
      '00000000-0000-0000-0000-0000000ff020', 'BILL',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'image/jpeg', 120000, null)
  $q$,
  'a storekeeper can file the challan photographed at the gate'
);

select is(
  (select storage_key from public.document where kind = 'BILL'),
  (select prop::text from ctx) || '/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'the object sits under its property, addressed by its content'
);

select is(
  (select retention_until from public.document where kind = 'BILL'),
  (current_date + interval '2 years')::date,
  'flow evidence outlives an inspection cycle by default'
);

/*
  The retry case. A gate device on a flapping connection uploads the same bytes twice;
  content addressing means that is one photograph, not two, and the second call must be a
  no-op returning the same row rather than a duplicate or an error.
*/
select lives_ok(
  $q$
    select public.attach_document(
      (select prop from ctx), 'GATE_ENTRY',
      '00000000-0000-0000-0000-0000000ff020', 'BILL',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'image/jpeg', 120000, null)
  $q$,
  'the same bytes against the same subject can be filed again'
);

select is(
  (select count(*)::integer from public.document where kind = 'BILL'),
  1,
  'and it is still one document, because the address is the content'
);

-- ---------------------------------------------------------------------------
-- The size ceiling — PRD section 13
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$
    select public.attach_document(
      (select prop from ctx), 'GATE_ENTRY',
      '00000000-0000-0000-0000-0000000ff020', 'BILL',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'image/jpeg', 409601, null)
  $q$,
  '23514',
  null,
  'a hair over 400 KB is refused, so the client rule is also a server one'
);

select throws_ok(
  $q$
    select public.attach_document(
      (select prop from ctx), 'GATE_ENTRY',
      '00000000-0000-0000-0000-0000000ff020', 'BILL',
      'not-a-sha', 'image/jpeg', 1000, null)
  $q$,
  '23514',
  null,
  'and something that is not a content address is not one'
);

select throws_ok(
  $q$
    select public.attach_document(
      (select prop from ctx), 'GATE_ENTRY',
      '00000000-0000-0000-0000-0000000ff020', 'BILL',
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'image/gif', 1000, null)
  $q$,
  '23514',
  null,
  'nor is a format the vault does not take'
);

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$
    select public.attach_document(
      (select prop from ctx), 'GATE_ENTRY',
      '00000000-0000-0000-0000-0000000ff021', 'BILL',
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      'image/jpeg', 1000, null)
  $q$,
  '42501',
  null,
  'a photograph cannot be filed against another property''s arrival'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000ff03"}', true);

select throws_ok(
  $q$
    select public.attach_document(
      (select prop from ctx), 'GATE_ENTRY',
      '00000000-0000-0000-0000-0000000ff020', 'BILL',
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'image/jpeg', 1000, null)
  $q$,
  '42501',
  null,
  'and somebody from the other property cannot file one here at all'
);

select is(
  (select count(*)::integer from public.document),
  0,
  'nor read what is filed here — a table of faces is not shared between hotels'
);

-- ---------------------------------------------------------------------------
-- Immutable, in both layers
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000ff02"}', true);

select is(
  (select count(*)::integer from public.document),
  1,
  'the storekeeper sees their own property''s evidence'
);

select throws_ok(
  $q$ update public.document set mime_type = 'image/webp' where kind = 'BILL' $q$,
  '42501',
  null,
  'no client can edit a document'
);

select throws_ok(
  $q$ delete from public.document where kind = 'BILL' $q$,
  '42501',
  null,
  'nor delete one'
);

/*
  The second layer, tested as the owner rather than through a client grant.

  Withholding UPDATE from `authenticated` is the control a client meets. The trigger is
  what a migration meets, and a test that only exercised the grant would pass just as
  happily on a database where the trigger had been dropped — so this one goes around the
  grant deliberately.
*/
reset role;
select throws_ok(
  $q$ update public.document set byte_size = 1 where kind = 'BILL' $q$,
  '42501',
  null,
  'and the trigger refuses even the table owner, so a migration cannot edit evidence either'
);

select throws_ok(
  $q$ delete from public.document where kind = 'BILL' $q$,
  '42501',
  null,
  'the same for a delete run as the owner'
);

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------

select is(
  (select public from storage.buckets where id = 'evidence'),
  false,
  'the bucket is private — a public one would publish every face by URL'
);

select * from finish();
rollback;
