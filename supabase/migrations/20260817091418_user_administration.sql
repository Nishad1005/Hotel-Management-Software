-- There is no way to create a user, and no way to see the ones that exist.
--
-- Today the only route is the Supabase dashboard by hand, which in practice means one
-- login shared by everybody. That is not an inconvenience, it is the failure the whole
-- module is built to prevent: if Security and the storekeeper are the same account, the
-- gate entry and the GRN are written by the same person, they agree by construction,
-- and the reconciliation control (PRD section 1) stops existing while continuing to
-- look like it works.
--
-- This is the database half. The edge function that actually mints a login is the
-- other, and it calls `public.can_manage_users` below rather than deciding for itself.

-- ---------------------------------------------------------------------------
-- Seeing the team
-- ---------------------------------------------------------------------------
--
-- `membership_select_self` restricts reads to the caller's own rows, so a users screen
-- could not list anybody. Policies OR together, so the self policy stays and this adds
-- to it rather than replacing it.
--
-- `property_id is not null` is load-bearing. Without it, a property administrator would
-- see org-wide grants belonging to a group GM at a sister property — a genuine
-- cross-tenant leak dressed up as a staff list.
create policy membership_select_by_property_admin on public.membership
  for select to authenticated
  using (
    property_id is not null
    and app.has_property_role(
      property_id, array['OWNER', 'ADMIN', 'GM']::public.membership_role[]
    )
  );

-- ---------------------------------------------------------------------------
-- Who may mint a login
-- ---------------------------------------------------------------------------
--
-- Exposed so the edge function can ask rather than reimplement the rule. It holds the
-- service-role key, so it can do anything it likes — which is exactly why the authority
-- check has to be a question it asks the database on the caller's behalf, not a
-- `profiles.role` read it performs itself. golaiv1's create-user checked
-- `caller.role !== 'admin'` inline; that works until the rule changes in one place and
-- not the other.
create or replace function public.can_manage_users(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_property_role(
    p_property_id, array['OWNER', 'ADMIN']::public.membership_role[]
  );
$$;

revoke all on function public.can_manage_users(uuid) from public, anon;
grant execute on function public.can_manage_users(uuid) to authenticated;

comment on function public.can_manage_users(uuid) is
  'Whether the caller may create logins and grant roles at this property. Asked by the create-user edge function, which holds the service-role key and must not decide this for itself.';

-- ---------------------------------------------------------------------------
-- Changing somebody's role, and stopping their access
-- ---------------------------------------------------------------------------
--
-- Through functions rather than a write policy on `membership`, because a client that
-- can write the table directly can write its OWN row — and self-promotion to OWNER is
-- one UPDATE away. golaiv1 has exactly this hole: migration 0017 renamed every business
-- RPC to close it and left the profile update grant open.
--
-- So `membership` gains no INSERT or UPDATE policy at all, and never should.

create or replace function public.grant_role(
  p_property_id uuid,
  p_user_id     uuid,
  p_role        public.membership_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  if not public.can_manage_users(p_property_id) then
    raise exception 'You do not have permission to manage users at this property.'
      using errcode = '42501';
  end if;

  -- Nobody grants themselves anything. An administrator who needs a second role asks
  -- another administrator, which is the whole point of separation of duties — and the
  -- alternative is a self-service route to OWNER.
  if p_user_id = (select auth.uid()) then
    raise exception 'You cannot change your own roles. Ask another administrator.'
      using errcode = '42501';
  end if;

  select org_id into v_org_id from public.property where id = p_property_id;
  if v_org_id is null then
    raise exception 'That property does not exist.' using errcode = '42501';
  end if;

  insert into public.membership (user_id, org_id, property_id, role)
  values (p_user_id, v_org_id, p_property_id, p_role)
  on conflict do nothing;
end;
$$;

create or replace function public.revoke_role(
  p_property_id uuid,
  p_user_id     uuid,
  p_role        public.membership_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer;
begin
  if not public.can_manage_users(p_property_id) then
    raise exception 'You do not have permission to manage users at this property.'
      using errcode = '42501';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'You cannot change your own roles. Ask another administrator.'
      using errcode = '42501';
  end if;

  delete from public.membership
   where user_id = p_user_id
     and property_id = p_property_id
     and role = p_role;

  get diagnostics v_removed = row_count;

  -- Rule 4b. A revoke that quietly removed nothing would report success while leaving
  -- somebody's access exactly where it was, which on this table is the worst possible
  -- silent failure.
  if v_removed = 0 then
    raise exception 'That person does not hold that role here.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.grant_role(uuid, uuid, public.membership_role)
  from public, anon;
revoke all on function public.revoke_role(uuid, uuid, public.membership_role)
  from public, anon;
grant execute on function public.grant_role(uuid, uuid, public.membership_role) to authenticated;
grant execute on function public.revoke_role(uuid, uuid, public.membership_role) to authenticated;

comment on function public.grant_role(uuid, uuid, public.membership_role) is
  'Grants a role at a property. Refuses self-grants: membership has no write policy precisely so that self-promotion to OWNER is not one UPDATE away.';
