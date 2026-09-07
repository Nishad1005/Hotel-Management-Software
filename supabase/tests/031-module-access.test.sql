-- Module access: the platform decides what a customer holds, the customer decides who
-- inside it may use each part.
--
-- The first assertion in this file is the one that matters most: with nothing
-- configured, everything works exactly as it did. A feature that gates every write path
-- in the product has to be provably invisible until somebody uses it, and the rest of
-- the suite is the other half of that proof — every existing flow test runs against a
-- database where these wrappers are in the path.
--
-- After that, the negative assertions carry the file. A property OWNER is the most
-- privileged customer-side role there is; when their own module is switched off, they
-- must be refused like anybody else, and refused loudly.
--
-- Run as `authenticated` throughout, per the repo rule.

begin;
select plan(27);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000fc01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vendor.md@mod.test',  '', now(), now()),
  ('00000000-0000-0000-0000-00000000fc02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner.ma@mod.test',   '', now(), now()),
  ('00000000-0000-0000-0000-00000000fc03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.ma@mod.test',   '', now(), now()),
  ('00000000-0000-0000-0000-00000000fc04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store2.ma@mod.test',  '', now(), now()),
  ('00000000-0000-0000-0000-00000000fc05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner.mb@mod.test',   '', now(), now());

select system.provision_property('owner.ma@mod.test', 'Group MA', 'MA', 'Modules A');
select system.provision_property('owner.mb@mod.test', 'Group MB', 'MB', 'Modules B');
select system.grant_property_role('store.ma@mod.test',  'MA', 'STOREKEEPER');
select system.grant_property_role('store2.ma@mod.test', 'MA', 'STOREKEEPER');

insert into system.platform_admin (user_id, note)
values ('00000000-0000-0000-0000-00000000fc01', 'Test founder');

-- An add-on, to prove the other reading of the same table. Registered here rather than
-- in the migration because it does not exist yet — this is the shape the procurement
-- module will arrive in.
insert into public.module (key, label, default_roles, requires_licence, sort)
values ('PROCUREMENT', 'Procurement',
        array['OWNER', 'ADMIN', 'PURCHASE']::public.membership_role[], true, 200);

create temporary table ctx as
select
  (select id from public.property where code = 'MA')                                  as prop,
  (select id from public.property where code = 'MB')                                  as other,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'MA' and c.code = 'DAIRY')                                        as cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'MA' and u.code = 'KG')                                           as uom,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'MA' and l.code = 'MA-T1-RCV')                                    as rcv,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'MA' and l.code = 'MA-CHILL')                                     as chill,
  '00000000-0000-0000-0000-00000000fc03'::uuid                                        as storekeeper;

grant select on ctx to authenticated;

insert into public.item (id, property_id, code, name, category_id, base_uom_id)
select '00000000-0000-0000-0000-0000000fc001', prop, 'MOD-RICE', 'Modules Rice', cat, uom from ctx;

insert into public.party (id, property_id, code, name)
select '00000000-0000-0000-0000-0000000fc010', prop, 'MA-VEN-000001', 'Modules Vendor' from ctx;

insert into public.gate_entry (id, property_id, gate_entry_no, party_id, bill, package_count)
select '00000000-0000-0000-0000-0000000fc020', prop, 'MA-GE-000001',
       '00000000-0000-0000-0000-0000000fc010', 'NONE', 1 from ctx;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Nothing configured: nothing changes
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc02","role":"authenticated"}';

select is(
  (select count(*)::int from public.my_module_access((select prop from ctx)) where allowed),
  11,
  'a fresh property holds all eleven base modules without anybody granting them'
);

select is(
  (select g.grn_no from public.post_grn(
     (select prop from ctx), '00000000-0000-0000-0000-0000000fc020',
     '00000000-0000-0000-0000-0000000fc010', 'mod-grn-1',
     jsonb_build_array(jsonb_build_object(
       'item_id', '00000000-0000-0000-0000-0000000fc001',
       'uom_id', (select uom from ctx), 'batch_no', 'MOD-1',
       'qty_physical', 10, 'qty_accepted', 10, 'qty_rejected', 0,
       'decision', 'ACCEPT'))) g),
  'MA-GRN-000001',
  'and the flow runs through the new wrapper exactly as before'
);

-- ---------------------------------------------------------------------------
-- The customer cannot sell themselves a module
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$ select public.platform_set_property_module(
        (select prop from ctx), 'PROCUREMENT', true, 'helping myself') $q$,
  '42501',
  'Only platform staff can change what a customer holds.',
  'a property owner cannot grant their own property a module'
);

select is_empty(
  $q$ select module_key from public.platform_list_property_modules((select prop from ctx)) $q$,
  'nor read the platform grid — it answers a customer with nothing at all'
);

-- ---------------------------------------------------------------------------
-- The platform switches one off
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc01","role":"authenticated"}';

select lives_ok(
  $q$ select public.platform_set_property_module(
        (select prop from ctx), 'RECEIVING', false, 'not on their plan') $q$,
  'platform staff switch Receiving off for this customer'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc02","role":"authenticated"}';

select is(
  (select allowed from public.my_module_access((select prop from ctx))
    where module_key = 'RECEIVING'),
  false,
  'the owner is told Receiving is gone, so the navigation can stop offering it'
);

select throws_ok(
  $q$ select * from public.post_grn(
        (select prop from ctx), '00000000-0000-0000-0000-0000000fc020',
        '00000000-0000-0000-0000-0000000fc010', 'mod-grn-blocked',
        jsonb_build_array(jsonb_build_object(
          'item_id', '00000000-0000-0000-0000-0000000fc001',
          'uom_id', (select uom from ctx), 'batch_no', 'MOD-X',
          'qty_physical', 1, 'qty_accepted', 1, 'qty_rejected', 0,
          'decision', 'ACCEPT'))) $q$,
  '42501',
  'Receiving is not switched on for this property. Your administrator can ask us to enable it.',
  'and the owner — the most privileged role there is — is refused, loudly'
);

-- Reads are deliberately ungated: a property that loses a module must still be able to
-- show an inspector what it did while it had one.
select is(
  (select count(*)::int from public.list_receipts((select prop from ctx), null, null)),
  1,
  'the receipt they already posted stays readable — the audit trail is not a feature flag'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc05","role":"authenticated"}';

select is(
  (select allowed from public.my_module_access((select other from ctx))
    where module_key = 'RECEIVING'),
  true,
  'the other customer never noticed'
);

-- ---------------------------------------------------------------------------
-- A direct-write path, gated by policy rather than by a wrapper
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc01","role":"authenticated"}';
select lives_ok(
  $q$ select public.platform_set_property_module(
        (select prop from ctx), 'TEMPERATURE', false, null) $q$,
  'the temperature round is switched off too'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc02","role":"authenticated"}';

select throws_ok(
  $q$ insert into public.temperature_reading
        (property_id, location_id, temperature_c, idempotency_key)
      select prop, chill, 4.0, 'mod-temp-1' from ctx $q$,
  '42501',
  null,
  'a reading is refused by the policy — the tables written without an RPC are gated too'
);

-- ---------------------------------------------------------------------------
-- And it comes back
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc01","role":"authenticated"}';

select lives_ok(
  $q$ select public.platform_reset_property_module((select prop from ctx), 'RECEIVING') $q$,
  'the explicit row is removed, returning Receiving to its default'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc02","role":"authenticated"}';

select is(
  (select g.grn_no from public.post_grn(
     (select prop from ctx), '00000000-0000-0000-0000-0000000fc020',
     '00000000-0000-0000-0000-0000000fc010', 'mod-grn-2',
     jsonb_build_array(jsonb_build_object(
       'item_id', '00000000-0000-0000-0000-0000000fc001',
       'uom_id', (select uom from ctx), 'batch_no', 'MOD-2',
       'qty_physical', 5, 'qty_accepted', 5, 'qty_rejected', 0,
       'decision', 'ACCEPT'))) g),
  'MA-GRN-000002',
  'and receiving works again — switching off is a decision, not a demolition'
);

-- ---------------------------------------------------------------------------
-- The customer narrows one of their own people
-- ---------------------------------------------------------------------------

select lives_ok(
  $q$ select public.set_member_module(
        (select prop from ctx), (select storekeeper from ctx), 'PUTAWAY', false) $q$,
  'the owner takes put-away away from one storekeeper'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc03","role":"authenticated"}';

select is(
  (select allowed from public.my_module_access((select prop from ctx))
    where module_key = 'PUTAWAY'),
  false,
  'that storekeeper loses it'
);

-- The module check is the first statement in the wrapper, so it answers before any
-- stock logic is reached — the batch id below never has to exist.
select throws_ok(
  $q$ select * from public.put_away(
        (select prop from ctx), '00000000-0000-0000-0000-0000000fc0ff',
        (select rcv from ctx), 'MA-DRY', 1, 'TYPED', 'mod-put-blocked') $q$,
  '42501',
  'You do not have access to Put away here.',
  'and is refused with the sentence that sends them to their own administrator'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc04","role":"authenticated"}';

select is(
  (select allowed from public.my_module_access((select prop from ctx))
    where module_key = 'PUTAWAY'),
  true,
  'while the storekeeper standing next to them still has it'
);

-- ---------------------------------------------------------------------------
-- Who may narrow whom
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$ select public.set_member_module(
        (select prop from ctx), (select storekeeper from ctx), 'ISSUE', false) $q$,
  '42501',
  'You do not have permission to change access at this property.',
  'a storekeeper cannot restrict anybody'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc02","role":"authenticated"}';

select throws_ok(
  $q$ select public.set_member_module(
        (select prop from ctx), '00000000-0000-0000-0000-00000000fc02', 'PUTAWAY', true) $q$,
  '42501',
  'You cannot change your own access.',
  'and an administrator cannot quietly widen their own'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc05","role":"authenticated"}';

select throws_ok(
  $q$ select public.set_member_module(
        (select prop from ctx), (select storekeeper from ctx), 'ISSUE', false) $q$,
  '42501',
  'You do not have permission to change access at this property.',
  'and the other customer''s owner reaches nobody here'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc02","role":"authenticated"}';

select lives_ok(
  $q$ select public.set_member_module(
        (select prop from ctx), (select storekeeper from ctx), 'PUTAWAY', null) $q$,
  'clearing the exception returns them to their role default'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc03","role":"authenticated"}';

select is(
  (select allowed from public.my_module_access((select prop from ctx))
    where module_key = 'PUTAWAY'),
  true,
  'and put-away is theirs again'
);

-- ---------------------------------------------------------------------------
-- The other reading of the same table: an add-on is off until it is sold
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc02","role":"authenticated"}';

select is(
  (select allowed from public.my_module_access((select prop from ctx))
    where module_key = 'PROCUREMENT'),
  false,
  'an add-on nobody has bought is off, though its owner holds every role it names'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc01","role":"authenticated"}';
select lives_ok(
  $q$ select public.platform_set_property_module(
        (select prop from ctx), 'PROCUREMENT', true, 'paid add-on') $q$,
  'platform staff sell it'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc02","role":"authenticated"}';
select is(
  (select allowed from public.my_module_access((select prop from ctx))
    where module_key = 'PROCUREMENT'),
  true,
  'and it appears — the same table, read the other way round'
);

-- ---------------------------------------------------------------------------
-- Administration is itself a module
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc01","role":"authenticated"}';
select lives_ok(
  $q$ select public.platform_set_property_module(
        (select prop from ctx), 'USERS', false, null) $q$,
  'user administration is switched off for this customer'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc02","role":"authenticated"}';

select is(
  (select public.can_manage_users((select prop from ctx))),
  false,
  'and the one function every administration path asks says no — so they all do'
);

select * from finish();
rollback;
