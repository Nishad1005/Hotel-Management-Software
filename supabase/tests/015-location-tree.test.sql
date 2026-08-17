-- The location tree, down to the bin that carries the label.
--
-- Onboarding is vendor-led: we build this tree from the layout the property sends,
-- generate the labels and hand over a PDF. So most of what is asserted here is about an
-- implementer not being able to make a mess that somebody else has to clean up.
--
-- The assertion that matters most is that retiring a location refuses while stock is on
-- it. golaiv1's equivalent deletes the location's stock rows; ours cannot, because the
-- equivalent is deleting from `stock_lot` — a maintained projection that 007 asserts
-- equals a full ledger replay. Stock does not stop existing because a shelf was retired
-- in an admin screen.

begin;
select plan(14);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.loc@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000f502', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.loc@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000f503', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.other@example.test', '', now(), now());

select system.provision_property('admin.loc@example.test', 'Group L', 'L1', 'Property L');
select system.provision_property('admin.other@example.test', 'Group M', 'M1', 'Property M');
select system.grant_property_role('store.loc@example.test', 'L1', 'STOREKEEPER');

create temporary table ctx as
select
  (select id from public.property where code = 'L1')                                  as prop,
  (select id from public.property where code = 'M1')                                  as other,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'L1' and l.code = 'L1-DRY')                                       as dry,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'M1' and l.code = 'M1-DRY')                                       as other_dry,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'L1' and c.code = 'PROVISIONS')                                   as cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'L1' and u.code = 'KG')                                           as uom;

grant select on ctx to authenticated;

-- ---------------------------------------------------------------------------
-- Four levels, which is what the PRD's code format implies
-- ---------------------------------------------------------------------------

select lives_ok(
  $q$ insert into public.location (id, property_id, code, name, kind, parent_id, fixture_type)
      select '00000000-0000-0000-0000-0000000f5001', prop, 'L1-DRY-R01', 'Rack 1',
             'RACK', dry, 'Rack' from ctx $q$,
  'a rack hangs under a zone'
);

select lives_ok(
  $q$ insert into public.location (id, property_id, code, name, kind, parent_id, fixture_type)
      select '00000000-0000-0000-0000-0000000f5002', prop, 'L1-DRY-R01-S001', 'Shelf 1',
             'BIN', '00000000-0000-0000-0000-0000000f5001', 'Shelf' from ctx $q$,
  'and a bin under the rack — the leaf that carries the label'
);

-- The property's own vocabulary, not ours.
select lives_ok(
  $q$ insert into public.location (id, property_id, code, name, kind, parent_id, fixture_type)
      select '00000000-0000-0000-0000-0000000f5003', prop, 'L1-DRY-G001', 'Ghoda 1',
             'BIN', dry, 'Ghoda' from ctx $q$,
  'a ghoda is a bin called what the store calls it'
);

select is(
  (select fixture_type from public.location where code = 'L1-SEC'),
  'Shelf',
  'existing locations take the default rather than a null nobody handles'
);

-- ---------------------------------------------------------------------------
-- Coordinates for places with no shelf edge to read
-- ---------------------------------------------------------------------------

select lives_ok(
  $q$ insert into public.location (property_id, code, name, kind, parent_id, fixture_type,
                                   grid_block, grid_row, grid_col)
      select prop, 'L1-DRY-A-R01-C01', 'Block A · Row 1 · Col 1', 'BIN', dry,
             'Floor position', 1, 1, 1 from ctx $q$,
  'a floor position is addressed by coordinate'
);

select throws_ok(
  $q$ insert into public.location (property_id, code, name, kind, parent_id, grid_block, grid_row)
      select prop, 'L1-DRY-HALF', 'Half a coordinate', 'BIN', dry, 1, 2 from ctx $q$,
  '23514',
  null,
  'but half a coordinate is refused — it would sort and render arbitrarily'
);

select throws_ok(
  $q$ insert into public.location (property_id, code, name, kind, parent_id, fixture_type,
                                   grid_block, grid_row, grid_col)
      select prop, 'L1-DRY-DUPE', 'Same square', 'BIN', dry, 'Floor position', 1, 1, 1
      from ctx $q$,
  '23505',
  null,
  'and two positions cannot claim the same square'
);

-- ---------------------------------------------------------------------------
-- Retiring a location
-- ---------------------------------------------------------------------------

insert into public.item (id, property_id, code, name, category_id, base_uom_id)
select '00000000-0000-0000-0000-0000000f5010', prop, 'RICE', 'Basmati rice', cat, uom from ctx;

insert into public.batch (id, property_id, item_id, batch_no, source)
select '00000000-0000-0000-0000-0000000f5011', prop, '00000000-0000-0000-0000-0000000f5010',
       'OPEN-L1', 'OPENING_STOCK' from ctx;

insert into public.stock_movement
  (property_id, batch_id, item_id, to_location_id, to_state, qty, uom_id, reason, idempotency_key)
select prop, '00000000-0000-0000-0000-0000000f5011', '00000000-0000-0000-0000-0000000f5010',
       '00000000-0000-0000-0000-0000000f5002', 'AVAILABLE', 8, uom, 'OPENING_STOCK', 'loc-open-1'
from ctx;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f501","role":"authenticated"}';

select throws_ok(
  $$ select public.deactivate_location(
       (select prop from ctx), '00000000-0000-0000-0000-0000000f5002') $$,
  'P0001',
  null,
  'a location holding stock cannot be retired — the stock does not go anywhere'
);

select is(
  (select qty from public.stock_lot
    where location_id = '00000000-0000-0000-0000-0000000f5002' and state = 'AVAILABLE'),
  8::numeric(14, 4),
  'and the attempt leaves the stock exactly where it was'
);

select lives_ok(
  $$ select public.deactivate_location(
       (select prop from ctx), '00000000-0000-0000-0000-0000000f5003') $$,
  'an empty location retires cleanly'
);

select lives_ok(
  $$ select public.deactivate_location(
       (select prop from ctx), '00000000-0000-0000-0000-0000000f5003') $$,
  'and retiring it again is a no-op rather than an error'
);

-- The trap that made golaiv1 add addOrReviveShelves: a retired code still occupies the
-- unique constraint, so recreating it must reactivate rather than silently insert
-- nothing. Asserted here so the importer has something to rely on.
select throws_ok(
  $q$ insert into public.location (property_id, code, name, kind, parent_id)
      select prop, 'L1-DRY-G001', 'Ghoda 1 again', 'BIN', dry from ctx $q$,
  '23505',
  null,
  'a retired code is still taken, so recreating one has to reactivate rather than insert'
);

-- ---------------------------------------------------------------------------
-- Authority
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f502","role":"authenticated"}';

select throws_ok(
  $$ select public.deactivate_location(
       (select prop from ctx), '00000000-0000-0000-0000-0000000f5001') $$,
  '42501',
  null,
  'a storekeeper cannot retire a location'
);

-- SECURITY DEFINER has already bypassed RLS by the time the body runs, so the function
-- has to re-resolve every id it is handed against the property it was given. Passing
-- your own property with somebody else's location is the shape of that attack, and it
-- is the exact hole golaiv1 left open in three of its RPCs.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f501","role":"authenticated"}';

select throws_ok(
  $$ select public.deactivate_location(
       (select prop from ctx), (select other_dry from ctx)) $$,
  '42501',
  null,
  'and an administrator cannot retire a location belonging to another property'
);

reset role;
select * from finish();
rollback;
