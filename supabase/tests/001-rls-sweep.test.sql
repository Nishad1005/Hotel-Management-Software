-- The tenant isolation sweep.
--
-- This is the most important test in the repository. It does not test a feature; it
-- tests that no future migration can quietly introduce a cross-tenant data leak.
--
-- The realistic failure is not a badly-written policy. It is a table added months
-- from now with no policy at all — which is silent, which no feature test would
-- catch, and which exposes every tenant's rows to every other tenant. This sweep
-- enumerates the catalogue instead of a hand-maintained list, so a new table is
-- covered the moment it exists.
--
-- If this fails, do not add an exemption. Add the policy.
-- See docs/decisions/0001-multi-tenant-from-day-one.md.

begin;
select plan(3);

-- ---------------------------------------------------------------------------
select is_empty(
  $q$
    select n.nspname || '.' || c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
    order by 1
  $q$,
  'every table in public has row level security enabled'
);

-- ---------------------------------------------------------------------------
-- RLS with no policy denies everything, so it is safe rather than leaky - but it
-- is almost always a mistake, and a silent one: the table simply appears empty.
select is_empty(
  $q$
    select n.nspname || '.' || c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
    order by 1
  $q$,
  'every table in public with RLS enabled has at least one policy'
);

-- ---------------------------------------------------------------------------
-- A SECURITY DEFINER function runs with its owner's privileges, so an attacker who
-- can influence search_path can make it resolve to their own objects. Pinning
-- search_path closes that. CLAUDE.md rule 3 depends on these functions being the
-- only sanctioned way to cross a tenant boundary, so they must be airtight.
select is_empty(
  $q$
    select n.nspname || '.' || p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app', 'system')
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
        where cfg like 'search\_path=%'
      )
    order by 1
  $q$,
  'every SECURITY DEFINER function pins its search_path'
);

select * from finish();
rollback;
