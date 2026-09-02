-- The temperature round — PRD section 7.3, proved as the people who walk it.
--
-- The table is deliberately plain: no RPC, an INSERT policy, and an idempotency key.
-- What is worth proving is the edges. The named unique constraint is scoped per
-- property, so one device's key can never collide with another tenant's. The composite
-- FK is what turns a cross-tenant location id into a refusal instead of a row. And
-- append-only here is enforced by an *absent grant*, which fails loudly — the quiet
-- zero-rows denial CLAUDE.md 4b warns about is a policy behaviour, and there is no
-- UPDATE policy because there is no UPDATE privilege for it to hide behind.

begin;
select plan(12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000f901', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.tr@temp.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000f902', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.tr@temp.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000f903', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fso.tr@temp.test',   '', now(), now()),
  ('00000000-0000-0000-0000-00000000f904', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit.tr@temp.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000f905', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.ts@temp.test', '', now(), now());

select system.provision_property('admin.tr@temp.test', 'Group TR', 'TR', 'Temperature R');
select system.provision_property('admin.ts@temp.test', 'Group TS', 'TS', 'Temperature S');
select system.grant_property_role('store.tr@temp.test', 'TR', 'STOREKEEPER');
select system.grant_property_role('fso.tr@temp.test',   'TR', 'FSO');
select system.grant_property_role('audit.tr@temp.test', 'TR', 'AUDITOR');

-- Provisioning seeds the cold room and freezer at every property, so the fixture
-- creates no locations of its own.
create temporary table ctx as
select
  (select id from public.property where code = 'TR')                                  as prop,
  (select id from public.property where code = 'TS')                                  as other,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'TR' and l.code = 'TR-CHILL')                                     as chill,
  -- Not `freeze`: FREEZE is a keyword Postgres accepts as an alias after AS but
  -- refuses as a bare column reference, and the reference lives inside a dollar-quoted
  -- string that no parse of this file ever checks. CI's EXECUTE is what finds it.
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'TR' and l.code = 'TR-FREEZE')                                    as freezer,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'TS' and l.code = 'TS-CHILL')                                     as other_chill;

grant select on ctx to authenticated;

-- ---------------------------------------------------------------------------
-- The round is walked
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f902","role":"authenticated"}';

select lives_ok(
  $q$ insert into public.temperature_reading
        (property_id, location_id, temperature_c, recorded_by, idempotency_key)
      select prop, chill, 4.0, '00000000-0000-0000-0000-00000000f902', 'tr-round-1'
      from ctx $q$,
  'the storekeeper writes the cold room down'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f903","role":"authenticated"}';

select lives_ok(
  $q$ insert into public.temperature_reading
        (property_id, location_id, temperature_c, recorded_by, idempotency_key)
      select prop, freezer, -18.5, '00000000-0000-0000-0000-00000000f903', 'tr-round-2'
      from ctx $q$,
  'and the FSO the freezer — temperature is theirs to escalate'
);

-- ---------------------------------------------------------------------------
-- The retry seam
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f902","role":"authenticated"}';

-- The outbox resending a reading the device never heard the answer to lands here, and
-- the sync engine recognises this exact constraint name as "my own retry".
select throws_ok(
  $q$ insert into public.temperature_reading
        (property_id, location_id, temperature_c, idempotency_key)
      select prop, chill, 4.0, 'tr-round-1' from ctx $q$,
  '23505',
  null,
  'the same key twice is a duplicate, never a second reading'
);

-- ---------------------------------------------------------------------------
-- Tenancy at every edge
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$ insert into public.temperature_reading
        (property_id, location_id, temperature_c, idempotency_key)
      select prop, other_chill, 3.0, 'tr-sneak-1' from ctx $q$,
  '23503',
  null,
  'another property''s cold room cannot be read against this one — the composite FK refuses'
);

select throws_ok(
  $q$ update public.temperature_reading set temperature_c = 5.0 $q$,
  '42501',
  null,
  'a reading cannot be edited — no UPDATE privilege exists, and the refusal is loud'
);

select throws_ok(
  $q$ delete from public.temperature_reading $q$,
  '42501',
  null,
  'nor deleted — a wrong reading is corrected by taking another'
);

select throws_ok(
  $q$ insert into public.temperature_reading
        (property_id, location_id, temperature_c, idempotency_key)
      select prop, chill, 300, 'tr-typo-1' from ctx $q$,
  '23514',
  null,
  'a thermometer cannot read 300 — plausibility of the instrument, not a compliance threshold'
);

select is(
  (select count(*)::int from public.temperature_reading),
  2,
  'the storekeeper sees the property''s two readings'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f904","role":"authenticated"}';

select throws_ok(
  $q$ insert into public.temperature_reading
        (property_id, location_id, temperature_c, idempotency_key)
      select prop, chill, 4.0, 'tr-audit-1' from ctx $q$,
  '42501',
  null,
  'the auditor reads the register and writes nothing into it'
);

-- ---------------------------------------------------------------------------
-- The other property
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f905","role":"authenticated"}';

-- The same key text as TR's first round, at a different property. The idempotency
-- constraint is (property_id, idempotency_key): two tenants' devices can never
-- collide, so this is a reading, not a duplicate.
select lives_ok(
  $q$ insert into public.temperature_reading
        (property_id, location_id, temperature_c, recorded_by, idempotency_key)
      select other, other_chill, 6.0, '00000000-0000-0000-0000-00000000f905', 'tr-round-1'
      from ctx $q$,
  'a key is scoped per property — another tenant''s device cannot collide'
);

select throws_ok(
  $q$ insert into public.temperature_reading
        (property_id, location_id, temperature_c, idempotency_key)
      select prop, chill, 4.0, 'ts-sneak-1' from ctx $q$,
  '42501',
  null,
  'and their administrator records nothing at a property that is not theirs'
);

select is(
  (select count(*)::int from public.temperature_reading),
  1,
  'they see exactly their own reading — the other property''s round is invisible'
);

select * from finish();
rollback;
