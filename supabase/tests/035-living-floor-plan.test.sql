-- The Living Floor Plan's data — ADR 0017.
--
-- The interesting claims here are all about what the plan is NOT allowed to be. It is a
-- view of `public.location`, so the tests that matter prove the seam holds: a room cannot
-- be borrowed across a tenant boundary, a storekeeper cannot redraw the property, the plan
-- columns are nullable so an older client can still write a location, and deleting a room
-- ungroups its zones without touching a single stock record.
--
-- The last one is the one worth having. `on delete set null` is easy to write and easy to
-- get backwards, and getting it backwards — `cascade` — would delete storage locations,
-- and with them a composite FK's worth of movements, because somebody renamed a room.

begin;
select plan(14);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000fb01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.fa@plan.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000fb02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.fa@plan.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000fb03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.fb@plan.test', '', now(), now());

select system.provision_property('admin.fa@plan.test', 'Group FA', 'FA', 'Floor Plan A');
select system.provision_property('admin.fb@plan.test', 'Group FB', 'FB', 'Floor Plan B');
select system.grant_property_role('store.fa@plan.test', 'FA', 'STOREKEEPER');

create temporary table ctx as
select
  (select id from public.property where code = 'FA')                                as prop,
  (select id from public.property where code = 'FB')                                as other,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'FA' and l.code = 'FA-CHILL')                                   as chill,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'FA' and l.code = 'FA-DRY')                                     as dry;

grant select on ctx to authenticated;

-- ---------------------------------------------------------------------------
-- The administrator describes the property
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb01","role":"authenticated"}';

select lives_ok(
  $q$ insert into public.facility_room (property_id, name, sort_order)
      select prop, 'Main Kitchen Store', 0 from ctx $q$,
  'the administrator adds a room'
);

select lives_ok(
  $q$ update public.location
         set facility_room_id = (select id from public.facility_room where name = 'Main Kitchen Store'),
             plan_visual_type = 'chiller',
             plan_data_behavior = 'TEMPERATURE',
             plan_size = 'M'
       where id = (select chill from ctx) $q$,
  'and puts the cold room in it, drawn as a chiller reading temperatures'
);

-- The point of the string column. A visual nobody has heard of must be storable, because
-- the registry that knows the names lives in the client and ships independently of this
-- schema — an enum here would mean a migration every time a property wants a new picture.
select lives_ok(
  $q$ update public.location
         set plan_visual_type = 'cheese_cave', plan_data_behavior = 'COUNT'
       where id = (select dry from ctx) $q$,
  'a visual this migration has never heard of is storable — the registry is not in the database'
);

-- Null is the shipping state for every one of these columns, and it has to stay writable:
-- a client running older code writes a location without mentioning them at all.
select lives_ok(
  $q$ insert into public.location (property_id, code, name, kind, regime)
      select prop, 'FA-WINE', 'Wine cellar', 'ZONE', 'CHILLED' from ctx $q$,
  'a location still inserts without any plan columns — an older client can write one'
);

select is(
  (select count(*)::int from public.location
    where code = 'FA-WINE' and plan_visual_type is null and plan_data_behavior is null and plan_size is null),
  1,
  'and lands with all three plan columns null, to be derived at render time'
);

-- ---------------------------------------------------------------------------
-- The tenant boundary
-- ---------------------------------------------------------------------------

-- CLAUDE.md 4. The composite FK is the whole defence: without it this succeeds, and one
-- property's floor plan quietly contains another's room.
select throws_ok(
  $q$ update public.location
         set facility_room_id = (select id from public.facility_room where name = 'Main Kitchen Store')
       where id = (select l.id from public.location l join public.property p on p.id = l.property_id
                    where p.code = 'FB' and l.code = 'FB-CHILL') $q$,
  '23503',
  null,
  'a location cannot be put in another property''s room'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb03","role":"authenticated"}';

select is(
  (select count(*)::int from public.facility_room),
  0,
  'the other property cannot see this one''s rooms at all'
);

-- ---------------------------------------------------------------------------
-- Who may redraw the property
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb02","role":"authenticated"}';

select is(
  (select count(*)::int from public.facility_room),
  1,
  'the storekeeper reads the rooms — the plan is their dashboard, not just an admin screen'
);

select throws_ok(
  $q$ insert into public.facility_room (property_id, name)
      select prop, 'Storekeeper''s Room' from ctx $q$,
  '42501',
  null,
  'but cannot add one'
);

-- Not "throws": RLS denies UPDATE by making rows invisible, so this succeeds having
-- changed nothing (CLAUDE.md 4b). The count is the only thing that can tell.
select lives_ok(
  $q$ update public.facility_room set name = 'Renamed by a storekeeper' $q$,
  'renaming a room does not raise for a storekeeper — RLS denies update silently'
);

select is(
  (select count(*)::int from public.facility_room where name = 'Main Kitchen Store'),
  1,
  'and the quiet denial changed nothing, which is the only way to detect it'
);

select throws_ok(
  $q$ select public.delete_facility_room(prop, (select id from public.facility_room limit 1)) from ctx $q$,
  '42501',
  null,
  'and the delete function refuses them out loud rather than quietly'
);

-- ---------------------------------------------------------------------------
-- Removing a room keeps its locations
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb01","role":"authenticated"}';

select lives_ok(
  $q$ select public.delete_facility_room(prop, (select id from public.facility_room where name = 'Main Kitchen Store'))
      from ctx $q$,
  'the administrator removes the room'
);

-- The assertion this file exists for. `on delete cascade` here would have taken the cold
-- room with it, and every stock movement that references it.
select is(
  (select count(*)::int from public.location
    where id = (select chill from ctx) and facility_room_id is null and plan_visual_type = 'chiller'),
  1,
  'the cold room survives, ungrouped, still drawn as a chiller'
);

select finish();
rollback;
