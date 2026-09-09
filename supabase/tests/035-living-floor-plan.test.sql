-- The Living Floor Plan's data — ADR 0017.
--
-- The interesting claims here are all about what the plan is NOT allowed to be. It is a
-- view of `public.location`, so the tests that matter prove the seam holds: a room cannot
-- be borrowed across a tenant boundary, a storekeeper cannot redraw the property, the plan
-- columns are nullable so an older client can still write a location, and removing a room
-- ungroups its zones without touching a single stock record.
--
-- That last one is the reason this file exists. The first version of the migration wrote
-- `on delete set null` on the composite FK, which nulls EVERY column in the key —
-- `property_id` included — so deleting a room failed on a not-null violation against a row
-- whose tenant had just been erased. Nothing about the clause looks wrong; only running it
-- says so.

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

-- Seeded here rather than by the first assertion, so that `ctx` can carry its id. The
-- cross-tenant test below needs FA's room id while acting as FB's administrator, and FB
-- cannot SELECT it — that is the point of the policy. Reading it from a fixture table both
-- roles may read is the only way to hand FB an id it could never have found, which is
-- exactly the attack the composite FK is there to refuse.
insert into public.facility_room (property_id, name, sort_order)
select id, 'Main Kitchen Store', 0 from public.property where code = 'FA';

create temporary table ctx as
select
  (select id from public.property where code = 'FA')                                as prop,
  (select id from public.property where code = 'FB')                                as other,
  (select id from public.facility_room where name = 'Main Kitchen Store')           as fa_room,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'FA' and l.code = 'FA-CHILL')                                   as chill,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'FA' and l.code = 'FA-DRY')                                     as dry,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'FB' and l.code = 'FB-CHILL')                                   as fb_chill;

grant select on ctx to authenticated;

-- ---------------------------------------------------------------------------
-- The administrator describes the property
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb01","role":"authenticated"}';

select lives_ok(
  $q$ insert into public.facility_room (property_id, name, sort_order)
      select prop, 'Beverage Cellar', 1 from ctx $q$,
  'the administrator adds a room'
);

select lives_ok(
  $q$ update public.location
         set facility_room_id = (select fa_room from ctx),
             plan_visual_type = 'chiller',
             plan_data_behavior = 'TEMPERATURE',
             plan_size = 'M'
       where id = (select chill from ctx) $q$,
  'and puts the cold room in one, drawn as a chiller reading temperatures'
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

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb03","role":"authenticated"}';

/*
  Written from FB's side deliberately.

  The first version ran this as FA's administrator against FB's location and asserted a
  foreign-key violation. It failed, and for the reason CLAUDE.md 4b exists: FA cannot SEE
  FB's location, so the row was invisible, the UPDATE matched nothing, and the statement
  succeeded having changed nothing at all. A cross-tenant write that quietly does nothing
  is a pass, not a failure — but it proves the RLS policy and says nothing whatever about
  the constraint, which was the thing under test.

  So this is the harder case: a real administrator, over a row they genuinely own, using
  an id from another property that RLS never showed them. Policies cannot help here — both
  sides of the row are FB's. Only the composite FK refuses it.
*/
select throws_ok(
  $q$ update public.location
         set facility_room_id = (select fa_room from ctx)
       where id = (select fb_chill from ctx) $q$,
  '23503',
  null,
  'a location cannot be put in another property''s room, even by its own administrator'
);

select is(
  (select count(*)::int from public.facility_room),
  0,
  'and the other property cannot see this one''s rooms at all'
);

-- ---------------------------------------------------------------------------
-- Who may redraw the property
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb02","role":"authenticated"}';

select is(
  (select count(*)::int from public.facility_room),
  2,
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
  $q$ select public.delete_facility_room(prop, fa_room) from ctx $q$,
  '42501',
  null,
  'and the delete function refuses them out loud rather than quietly'
);

-- ---------------------------------------------------------------------------
-- Removing a room keeps its locations
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb01","role":"authenticated"}';

select lives_ok(
  $q$ select public.delete_facility_room(prop, fa_room) from ctx $q$,
  'the administrator removes the room'
);

-- The assertion this file exists for, and the one that caught the set-null bug. The row
-- must survive whole: ungrouped, still drawn as a chiller, and — the part that failed —
-- still belonging to its property.
select is(
  (select count(*)::int from public.location
    where id = (select chill from ctx)
      and facility_room_id is null
      and plan_visual_type = 'chiller'
      and property_id = (select prop from ctx)),
  1,
  'the cold room survives, ungrouped, still drawn as a chiller, still its property''s'
);

select finish();
rollback;
