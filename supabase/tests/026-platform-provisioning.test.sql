-- Onboarding a customer, and the one place this system reads across every tenant.
--
-- `list_tenants` is SECURITY DEFINER and deliberately unbounded by property, which makes
-- it the single most dangerous function in the codebase: everything else in Golai answers
-- "which rows may this user see" and this one answers "all of them". The guard is not RLS
-- and cannot be — RLS would have to be widened to permit it, and a widened predicate is
-- how a cross-tenant leak ships (CLAUDE.md rule 2).
--
-- So the assertions that carry this file are the negative ones. A property owner is a
-- perfectly legitimate, fully authenticated user, and must get nothing at all.

begin;
select plan(20);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000fb01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vendor.pv@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000fb02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner.pv@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000fb03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.pv@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000fb04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner2.pv@example.test', '', now(), now());

-- One existing customer, so the console has something to be wrong about.
select system.provision_property('owner.pv@example.test', 'Voyage Group', 'PV1', 'Property PV1');
select system.grant_property_role('store.pv@example.test', 'PV1', 'STOREKEEPER');

-- The one statement that has to be run by hand, once, on a real deployment. Nothing seeds
-- it in the migration: an admin shipped in the migration history would be a back door in
-- every deployment including a customer's own.
insert into system.platform_admin (user_id, note)
values ('00000000-0000-0000-0000-00000000fb01', 'Founder');

create temporary table ctx as
select (select id from public.property where code = 'PV1') as prop;

grant select on ctx to authenticated;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Who is one, and who is not
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb01","role":"authenticated"}';

select is(
  (select public.am_i_platform_admin()),
  true,
  'a platform administrator is told so, which is how the console decides to exist'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb02","role":"authenticated"}';

-- A property OWNER — the most privileged customer-side role there is. If anyone was going
-- to leak through it would be them.
select is(
  (select public.am_i_platform_admin()),
  false,
  'and a property owner is told they are not — the most privileged customer role is still a customer'
);

select throws_ok(
  $q$ select * from public.list_tenants() $q$,
  '42501',
  null,
  'an owner cannot list the tenants, however legitimate their session'
);

select throws_ok(
  $q$ select * from public.provision_tenant('Someone Else', 'XX', 'Their Hotel',
        '00000000-0000-0000-0000-00000000fb02') $q$,
  '42501',
  null,
  'nor create one'
);

select throws_ok(
  $q$ select public.set_property_lifecycle((select prop from ctx), 'LIVE') $q$,
  '42501',
  null,
  'nor move their own property to LIVE, which is our judgement rather than theirs'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb03","role":"authenticated"}';

select throws_ok(
  $q$ select * from public.list_tenants() $q$,
  '42501',
  null,
  'and neither can a storekeeper'
);

-- ---------------------------------------------------------------------------
-- Onboarding one
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb01","role":"authenticated"}';

select is(
  (select t.property_code || '/' || t.was_new::text
     from public.provision_tenant('Solitaire Hotels', 'sb', 'Voyage The Solitaire Bliss',
                                  '00000000-0000-0000-0000-00000000fb04') t),
  'SB/true',
  'a platform administrator onboards a customer, and the code is upper-cased as it is stored'
);

select is(
  (select lifecycle_state::text from public.property where code = 'SB'),
  'ONBOARDING',
  'left in ONBOARDING and never LIVE — at this moment its item master is empty'
);

-- Units, categories, the location skeleton, the rules and the departments. A property
-- that cannot receive on its first morning was not onboarded, it was inserted.
select cmp_ok(
  (select count(*)::int from public.uom u join public.property p on p.id = u.property_id
    where p.code = 'SB'),
  '>=',
  10,
  'with its units seeded, so it can be received into on the first morning'
);

select is(
  (select count(*)::int from public.location l join public.property p on p.id = l.property_id
    where p.code = 'SB' and l.kind = 'DEPARTMENT'),
  8,
  'and its departments, which come from the trigger rather than from this call'
);

select is(
  (select count(*)::int from public.membership m join public.property p on p.id = m.property_id
    where p.code = 'SB' and m.user_id = '00000000-0000-0000-0000-00000000fb04'),
  2,
  'the owner holds both OWNER and ADMIN, because on day one they are the only person here'
);

-- ADR 0002: the same customer name puts a second hotel in one group, a different name
-- creates a separate customer. One argument, and it is what makes hotels-in-a-group and
-- independent-hotels the same code path.
select is(
  (select t.org_id = (select org_id from public.property where code = 'SB')
     from public.provision_tenant('Solitaire Hotels', 'SB2', 'Solitaire Tinsukia',
                                  '00000000-0000-0000-0000-00000000fb04') t),
  true,
  'a second property under the same customer name joins the same group'
);

select is(
  (select count(distinct org_id)::int from public.property where code in ('SB', 'SB2')),
  1,
  'rather than creating a second customer with the same name'
);

-- Partial failure and re-run is the normal case in provisioning, not an edge case.
select is(
  (select t.was_new from public.provision_tenant('Solitaire Hotels', 'SB',
     'Voyage The Solitaire Bliss', '00000000-0000-0000-0000-00000000fb04') t),
  false,
  're-running is safe and says the property was already there'
);

-- ---------------------------------------------------------------------------
-- The code that gets printed onto every sticker
-- ---------------------------------------------------------------------------

select throws_like(
  $q$ select * from public.provision_tenant('Bad Codes', 'A', 'One Letter',
        '00000000-0000-0000-0000-00000000fb04') $q$,
  '%two to eight letters or digits%',
  'a code too short to be distinctive is refused rather than accepted and lived with'
);

select throws_like(
  $q$ select * from public.provision_tenant('Bad Codes', 'SB-MAIN', 'Hyphenated',
        '00000000-0000-0000-0000-00000000fb04') $q$,
  '%two to eight letters or digits%',
  'and so is one with a separator in it, which would double the hyphens in every bin code'
);

-- ---------------------------------------------------------------------------
-- The console's own list
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.list_tenants()),
  3,
  'the tenant list crosses every property, which is the one place this system does'
);

select is(
  (select t.people from public.list_tenants() t where t.property_code = 'PV1'),
  2,
  'counting the people at each, so a customer nobody has logins for is visible as one'
);

-- The question behind the question. A tenant provisioned six weeks ago with no movements
-- is a stalled onboarding, and it looks identical to a healthy one on every other column.
select is(
  (select t.last_activity from public.list_tenants() t where t.property_code = 'SB'),
  null::timestamptz,
  'and when anything last happened, so a stalled onboarding does not look like a healthy one'
);

select lives_ok(
  $q$ select public.set_property_lifecycle(
        (select id from public.property where code = 'SB'), 'LIVE') $q$,
  'and a property goes LIVE when we say so, weeks after it was created'
);

reset role;
select * from finish();
rollback;
