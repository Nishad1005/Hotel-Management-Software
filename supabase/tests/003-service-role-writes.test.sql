-- service_role must retain full write access, because the provisioning job runs as
-- it (ADR 0010) and nothing else may write tenancy rows.
--
-- This file exists because of a specific uncertainty. service_role was deliberately
-- removed from the `app` schema grants: it bypasses RLS, so it has no business
-- calling helpers whose whole purpose is scoping a user to their own properties
-- (CLAUDE.md rule 3). But `updated_at` is maintained by app.touch_updated_at, and
-- whether firing a trigger requires the invoking role to hold USAGE on the
-- function's schema is not something to settle by assumption.
--
-- So it is settled here instead. If revoking that grant breaks provisioning, this
-- fails rather than the first real deployment doing so.

begin;
select plan(4);

set local role service_role;

select lives_ok(
  $q$ insert into public.organisation (id, name)
      values ('00000000-0000-0000-0000-0000000000c1', 'Provisioning Test Group') $q$,
  'service_role can create an organisation'
);

select lives_ok(
  $q$ insert into public.property (id, org_id, code, name)
      values ('00000000-0000-0000-0000-0000000000c2',
              '00000000-0000-0000-0000-0000000000c1', 'PT', 'Provisioning Test Property') $q$,
  'service_role can create a property'
);

-- The real subject of this file: the UPDATE fires app.touch_updated_at.
select lives_ok(
  $q$ update public.organisation
      set name = 'Provisioning Test Group Renamed'
      where id = '00000000-0000-0000-0000-0000000000c1' $q$,
  'service_role can update, and the updated_at trigger fires without app schema usage'
);

select isnt(
  (select updated_at from public.organisation where id = '00000000-0000-0000-0000-0000000000c1'),
  (select created_at from public.organisation where id = '00000000-0000-0000-0000-0000000000c1'),
  'the trigger actually moved updated_at rather than silently doing nothing'
);

reset role;
select * from finish();
rollback;
