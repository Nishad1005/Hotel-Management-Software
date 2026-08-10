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

-- updated_at is seeded to a distant past value on purpose. `now()` is
-- transaction_timestamp(), which is CONSTANT for the whole transaction - and pgTAP
-- runs each file inside one. So a row inserted and updated here would carry an
-- identical created_at and updated_at no matter whether the trigger fired at all,
-- and comparing the two would prove nothing. Seeding an old value is what makes the
-- trigger observable inside a single transaction.
select lives_ok(
  $q$ insert into public.organisation (id, name, created_at, updated_at)
      values ('00000000-0000-0000-0000-0000000000c1', 'Provisioning Test Group',
              '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z') $q$,
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

select is(
  (select updated_at from public.organisation where id = '00000000-0000-0000-0000-0000000000c1'),
  now(),
  'the trigger actually moved updated_at off its seeded value rather than doing nothing'
);

reset role;
select * from finish();
rollback;
