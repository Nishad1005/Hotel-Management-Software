-- Creating and removing access, proved as the actual user.
--
-- The assertion that matters most is that nobody can change their own roles. `membership`
-- deliberately has no INSERT or UPDATE policy, because a client that can write the table
-- can write its own row, and self-promotion to OWNER is then one statement away. golaiv1
-- left exactly that hole open.
--
-- The second is that a property administrator sees their own team and not a sister
-- property's — the new select policy widens visibility, and widening visibility on the
-- membership table is precisely where a cross-tenant leak would come from.

begin;
select plan(12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000a601', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.u@example.test',  '', now(), now()),
  ('00000000-0000-0000-0000-00000000a602', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.u@example.test',  '', now(), now()),
  ('00000000-0000-0000-0000-00000000a603', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'guard.u@example.test',  '', now(), now()),
  ('00000000-0000-0000-0000-00000000a604', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.v@example.test',  '', now(), now());

select system.provision_property('admin.u@example.test', 'Group U', 'U1', 'Property U');
select system.provision_property('admin.v@example.test', 'Group V', 'V1', 'Property V');
select system.grant_property_role('store.u@example.test', 'U1', 'STOREKEEPER');

create temporary table ctx as
select
  (select id from public.property where code = 'U1') as prop,
  (select id from public.property where code = 'V1') as other;

grant select on ctx to authenticated;

-- ---------------------------------------------------------------------------
-- The administrator
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a601","role":"authenticated"}';

select is(
  (select public.can_manage_users((select prop from ctx))),
  true,
  'an administrator may manage users at their own property'
);

select is(
  (select public.can_manage_users((select other from ctx))),
  false,
  'and not at somebody else''s'
);

select lives_ok(
  $$ select public.grant_role(
       (select prop from ctx), '00000000-0000-0000-0000-00000000a603', 'SECURITY') $$,
  'and can make somebody a guard'
);

select isnt_empty(
  $q$ select 1 from public.membership
       where user_id = '00000000-0000-0000-0000-00000000a603' and role = 'SECURITY' $q$,
  'which shows up as a membership'
);

-- The whole reason membership has no write policy.
select throws_ok(
  $$ select public.grant_role(
       (select prop from ctx), '00000000-0000-0000-0000-00000000a601', 'OWNER') $$,
  '42501',
  null,
  'but cannot grant a role to themselves — self-promotion is not a self-service route'
);

select throws_ok(
  $q$ insert into public.membership (user_id, org_id, property_id, role)
      select '00000000-0000-0000-0000-00000000a601', p.org_id, p.id, 'OWNER'
        from public.property p where p.id = (select prop from ctx) $q$,
  '42501',
  null,
  'and cannot write the membership table directly either'
);

select lives_ok(
  $$ select public.revoke_role(
       (select prop from ctx), '00000000-0000-0000-0000-00000000a603', 'SECURITY') $$,
  'a role can be taken away'
);

select throws_ok(
  $$ select public.revoke_role(
       (select prop from ctx), '00000000-0000-0000-0000-00000000a603', 'SECURITY') $$,
  'P0001',
  null,
  'and revoking one they do not hold says so rather than silently doing nothing'
);

-- ---------------------------------------------------------------------------
-- Seeing the team, and only the team
-- ---------------------------------------------------------------------------

select isnt_empty(
  $q$ select 1 from public.membership m
       where m.user_id = '00000000-0000-0000-0000-00000000a602' $q$,
  'an administrator can see their storekeeper'
);

select is(
  (select count(*)::int from public.membership m
     join public.property p on p.id = m.property_id
    where p.code = 'V1'),
  0,
  'and none of another property''s people'
);

-- ---------------------------------------------------------------------------
-- Everybody else
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a602","role":"authenticated"}';

select is(
  (select public.can_manage_users((select prop from ctx))),
  false,
  'a storekeeper may not manage users'
);

select throws_ok(
  $$ select public.grant_role(
       (select prop from ctx), '00000000-0000-0000-0000-00000000a603', 'STOREKEEPER') $$,
  '42501',
  null,
  'and is refused if they try'
);

reset role;
select * from finish();
rollback;
