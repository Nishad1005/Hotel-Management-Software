-- A team list needs names, and names live somewhere the client cannot read.
--
-- `membership` stores a user_id and nothing else about the person. Names, emails and
-- phone numbers are in `auth.users`, which PostgREST does not expose — correctly, since
-- it holds every user of the project regardless of property.
--
-- So one function, which joins the two and is scoped to a single property. It reads
-- auth.users, so it is SECURITY DEFINER; that makes the authority check its first
-- statement and the property filter non-negotiable, because a bug here leaks the
-- identity of every user in the system rather than merely the wrong rows of a table.

create or replace function public.list_team(p_property_id uuid)
returns table (
  user_id    uuid,
  full_name  text,
  email      text,
  phone      text,
  roles      public.membership_role[],
  is_self    boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Anyone who works here may see who else does — that is an ordinary thing to need,
  -- and hiding it does not protect anything. Changing the list is a different question,
  -- and grant_role answers it separately.
  if not exists (
    select 1
      from public.membership m
      join public.property p on p.org_id = m.org_id
     where m.user_id = (select auth.uid())
       and p.id = p_property_id
       and (m.property_id is null or m.property_id = p.id)
  ) then
    raise exception 'You do not work at this property.' using errcode = '42501';
  end if;

  return query
  select
    u.id,
    -- Set from user_metadata at creation. Coalesced so a row without one still lists
    -- rather than vanishing — a person with no name is a data problem to see, not to
    -- hide.
    coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), 'Unnamed'),
    u.email::text,
    u.phone::text,
    array_agg(m.role order by m.role),
    u.id = (select auth.uid())
  from public.membership m
  join auth.users u on u.id = m.user_id
  where m.property_id = p_property_id
  group by u.id, u.email, u.phone, u.raw_user_meta_data
  order by 2;
end;
$$;

revoke all on function public.list_team(uuid) from public, anon;
grant execute on function public.list_team(uuid) to authenticated;

comment on function public.list_team(uuid) is
  'Who works at this property, with their roles. SECURITY DEFINER because names live in auth.users; the property filter and the membership check are what keep it from listing the whole project.';
