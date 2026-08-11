-- Provisioning: idempotence, grouping, and isolation between customers.
--
-- Idempotence is the assertion that matters. Partial failure and re-run is the normal
-- case for provisioning, and a step that cannot be repeated safely gets run nervously
-- or not at all.

begin;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rival@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store@example.test', '', now(), now());

-- ---------------------------------------------------------------------------
-- Provisioning a property
-- ---------------------------------------------------------------------------

select lives_ok(
  $q$ select system.provision_property('owner@example.test', 'Voyage Group', 'SB', 'Solitaire Bliss') $q$,
  'provisions a property'
);

select is(
  (select count(*)::int from public.uom u
     join public.property p on p.id = u.property_id where p.code = 'SB'),
  10,
  'and seeds the unit master, local units included'
);

select is(
  (select default_min_shelf_life_pct from public.item_category c
     join public.property p on p.id = c.property_id
    where p.code = 'SB' and c.code = 'DAIRY'),
  60.00,
  'and carries the PRD minimum shelf-life default for dairy'
);

select is(
  (select enforcement_mode::text from public.rule_config r
     join public.property p on p.id = r.property_id
    where p.code = 'SB' and r.rule_key = 'MIN_SHELF_LIFE_AT_RECEIPT'),
  'RECORD_ONLY',
  'and every rule ships record-only, per PRD section 8'
);

select is(
  (select lifecycle_state::text from public.property where code = 'SB'),
  'ONBOARDING',
  'and the property is not LIVE until the readiness checklist passes'
);

-- ---------------------------------------------------------------------------
-- Idempotence
-- ---------------------------------------------------------------------------

select lives_ok(
  $q$ select system.provision_property('owner@example.test', 'Voyage Group', 'SB', 'Solitaire Bliss') $q$,
  'running it a second time does not raise'
);

select is(
  (select count(*)::int from public.uom u
     join public.property p on p.id = u.property_id where p.code = 'SB'),
  10,
  'and does not duplicate the seeded masters'
);

-- ---------------------------------------------------------------------------
-- Grouping versus separation — the argument that decides it is the org name
-- ---------------------------------------------------------------------------

select system.provision_property('owner@example.test', 'Voyage Group', 'VKR', 'Voyage Kaziranga Resort');
select system.provision_property('rival@example.test', 'Brahmaputra Hotels', 'BR', 'Brahmaputra Riverside');

select is(
  (select count(distinct p.id)::int
     from public.property p
     join public.organisation o on o.id = p.org_id
    where o.name = 'Voyage Group'),
  2,
  'the same organisation name puts a second property in the same group'
);

select is(
  (select count(*)::int
     from public.property p
     join public.organisation o on o.id = p.org_id
    where o.name = 'Brahmaputra Hotels'),
  1,
  'and a different organisation name creates a separate customer'
);

select * from finish();
rollback;
