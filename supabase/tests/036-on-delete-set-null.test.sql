-- No foreign key may null a column that cannot be null.
--
-- `on delete set null` nulls **every column in the key** unless it names a column list,
-- and CLAUDE.md 4 makes nearly every foreign key here composite — `(property_id, x_id)`.
-- Every domain table's `property_id` is `not null`. So the default form of a clause that
-- reads entirely reasonably is, on this schema, an instruction to erase the tenant of a
-- row and then fail on the constraint that forbids it.
--
-- It has happened twice. `20260909032805` shipped it and CI caught it the same day;
-- `20260812102424` shipped it a month earlier on `item.default_location_id` and nothing
-- caught it at all, because nothing in this app ever deletes a `location`.
--
-- That second one is the reason this file leads with a sweep rather than a case. A test
-- that deletes a location proves today's constraint; a question asked of `pg_constraint`
-- proves the rule, and is the only version that can fail for a foreign key nobody has
-- written yet. CLAUDE.md: test the mechanism, not its current effect.

begin;
select plan(7);

-- ---------------------------------------------------------------------------
-- The sweep — the assertion that survives the next migration
-- ---------------------------------------------------------------------------

/*
  `confdelsetcols` holds the columns a SET NULL action actually nulls. It is empty when
  the clause named none, which means "all of them" — so an empty list on a multi-column
  key is exactly the defect, and `unnest(conkey)` is then the right column set to check.

  Asking "are all the nulled columns nullable" rather than "is this composite" catches
  the single-column case too: a `not null` column with `on delete set null` is the same
  bug wearing different clothes, and would be just as invisible until something deleted
  the parent row.
*/
create temporary view offending_fks as
select
  c.conname::text            as constraint_name,
  t.relname::text            as on_table,
  a.attname::text            as would_null
from pg_constraint c
join pg_class t      on t.oid = c.conrelid
join pg_namespace n  on n.oid = t.relnamespace
cross join lateral unnest(
  case
    when c.confdelsetcols is null or cardinality(c.confdelsetcols) = 0 then c.conkey
    else c.confdelsetcols
  end
) as k(attnum)
join pg_attribute a  on a.attrelid = c.conrelid and a.attnum = k.attnum
where c.contype = 'f'
  and c.confdeltype = 'n'        -- ON DELETE SET NULL
  and n.nspname = 'public'
  and a.attnotnull;              -- ...onto a column that refuses null

select is(
  (select count(*)::int from offending_fks),
  0,
  'no foreign key would null a not-null column when its parent row is deleted'
);

-- Named separately so a failure says WHICH key, not just that there is one. A count of
-- 1 sends the next reader to `pg_constraint` to find out what broke; a list does not.
select is(
  (select coalesce(string_agg(constraint_name || '.' || would_null, ', ' order by constraint_name), '(none)')
     from offending_fks),
  '(none)',
  'and none is named here, which is what a failure above would list'
);

-- The rule is only worth anything if the view can actually see a violation. Without
-- this, a typo in the predicate gives a permanently green test that asks nothing —
-- exactly the shape of the `anon` default-privileges bug (CLAUDE.md).
create table public.zz_fk_canary_parent (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null
);
create unique index zz_canary_parent_key on public.zz_fk_canary_parent (property_id, id);
create table public.zz_fk_canary_child (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  parent_id uuid,
  constraint zz_canary_fk foreign key (property_id, parent_id)
    references public.zz_fk_canary_parent (property_id, id) on delete set null
);

select is(
  (select count(*)::int from offending_fks where constraint_name = 'zz_canary_fk'),
  1,
  'the sweep detects a deliberately broken key — it is asking a real question'
);

select is(
  (select would_null from offending_fks where constraint_name = 'zz_canary_fk'),
  'property_id',
  'and names the tenant column as the one that would be erased'
);

drop table public.zz_fk_canary_child;
drop table public.zz_fk_canary_parent;

-- ---------------------------------------------------------------------------
-- And the case that prompted it, behaviourally
-- ---------------------------------------------------------------------------
--
-- Run as the owner rather than `authenticated`, and deliberately so. Every other test in
-- this suite writes as a real user because a real user is meant to do the thing; nobody
-- is meant to delete a location, and the app has no path that does. What is under test is
-- what the *schema* does when a location row goes — which is reachable through a property
-- cascade, and would be reachable through any future maintenance that deletes one.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000fc01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.dl@fk.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000fc02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.dm@fk.test', '', now(), now());

-- Two organisations, two properties. No test here runs in a single-tenant world, so the
-- cross-tenant assertion at the end has a real other property to point at rather than a
-- contrived subquery that passes when it finds nothing.
select system.provision_property('admin.dl@fk.test', 'Group DL', 'DL', 'Delete Location');
select system.provision_property('admin.dm@fk.test', 'Group DM', 'DM', 'Other Property');

create temporary table ctx as
select
  (select id from public.property where code = 'DL')                                as prop,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'DL' and l.code = 'DL-DRY')                                     as dry,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'DM' and l.code = 'DM-DRY')                                     as other_dry,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'DL' limit 1)                                                   as cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'DL' limit 1)                                                   as uom;

insert into public.item (property_id, code, name, category_id, base_uom_id, default_location_id)
select prop, 'DL-RICE', 'Rice', cat, uom, dry from ctx;

select lives_ok(
  $q$ delete from public.location where id = (select dry from ctx) $q$,
  'a location that an item defaults to can be deleted at all'
);

select is(
  (select count(*)::int from public.item
    where code = 'DL-RICE'
      and default_location_id is null
      and property_id = (select prop from ctx)),
  1,
  'the item loses its default location and keeps its property — the whole point'
);

-- The cross-tenant guarantee the composite key exists for is unchanged by naming a
-- column list. Worth one assertion, because "fix the delete action" is exactly the kind
-- of edit that quietly relaxes the thing the constraint was added for.
select throws_ok(
  $q$ update public.item
         set default_location_id = (select other_dry from ctx)
       where code = 'DL-RICE' $q$,
  '23503',
  null,
  'and an item still cannot default to another property''s location'
);

select finish();
rollback;
