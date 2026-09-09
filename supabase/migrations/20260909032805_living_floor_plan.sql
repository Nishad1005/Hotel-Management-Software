-- ---------------------------------------------------------------------------
-- The Living Floor Plan — LFP-1, the data
-- ---------------------------------------------------------------------------
--
-- ADR 0017. The plan is a spatial view of `public.location`, not a second model of the
-- property. Provisioning already seeds seven locations per property and `storage_regime`
-- already tells them apart, so the drawn thing and the stored thing are one row. What is
-- genuinely missing is the level above a zone — the room that groups a chiller, a freezer
-- and a dry store — and that is the one new table here.
--
-- Everything else is four nullable columns on `location`. Nullable is load-bearing, not
-- laziness: `not null` would need a backfill on a table with rows in production, and it
-- would refuse writes from clients running older code that does not know these columns
-- exist (CLAUDE.md 20 — the server accepts payload versions N-2). Null means "derive it",
-- and every one of them has a sensible derivation.

-- ---------------------------------------------------------------------------
-- Where a pin's number comes from
-- ---------------------------------------------------------------------------
--
-- An enum, unlike `plan_visual_type` below, because each value names a source the client
-- must already know how to read. Adding one is code work regardless, so a closed set
-- costs nothing and catches a typo at the boundary instead of at render time.
--
-- Deliberately separate from the visual. A property that keeps its cheese in a chiller
-- and counts wheels rather than reading temperatures sets visual = chiller and behaviour
-- = COUNT, and gets stock lines on a chiller-shaped box with no code shipped. Tying the
-- number to the picture is what would have made every such property need us.
create type public.plan_data_behavior as enum (
  'TEMPERATURE', -- latest temperature-round reading for this location
  'COUNT',       -- stock lines held here
  'DWELL',       -- how long material has been standing here
  'RETURNABLE'   -- open returnables against this location
);

-- The footprint multiplier, as three named sizes rather than a number. A property
-- describing its cold room is choosing between "small, normal, large", not calibrating a
-- scale factor — and three values keep the auto-layout's bay arithmetic predictable.
create type public.plan_size as enum ('S', 'M', 'L');

-- ---------------------------------------------------------------------------
-- The room
-- ---------------------------------------------------------------------------
--
-- A grouping of storage locations that are in the same physical place. "Main Kitchen
-- Store" holds a walk-in chiller, a deep freeze and a dry store; the app has always had
-- the three and never had the one containing them.
--
-- It is display-only and deliberately not a `location_kind`. Every existing kind carries
-- a rule — put-away refuses a ZONE, only a leaf is a destination — and a ROOM value would
-- have been the first with none, which invites the question of whether stock can sit in
-- one. Keeping it in its own table also leaves `parent_id is null` meaning exactly what it
-- means today, so the location tree screen keeps working untouched.
create table public.facility_room (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.property (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 60),
  -- Left-to-right order of the bays. Null sorts last, then by name, so a room added
  -- without an explicit position lands at the end rather than somewhere arbitrary.
  sort_order  integer check (sort_order is null or sort_order >= 0),
  created_at  timestamptz not null default now(),

  constraint facility_room_name_unique_per_property unique (property_id, name),
  -- So `location` can reference a room with a composite tenant key (CLAUDE.md 4). Without
  -- this a zone at one property could name another property's room.
  constraint facility_room_property_id_id_unique unique (property_id, id)
);

comment on table public.facility_room is
  'A physical grouping of storage locations, for the Living Floor Plan. Display only — no rule keys on it. ADR 0017.';

create index facility_room_by_property on public.facility_room (property_id, sort_order nulls last, name);

-- ---------------------------------------------------------------------------
-- What a location looks like on the plan
-- ---------------------------------------------------------------------------

alter table public.location
  add column facility_room_id uuid,

  /**
   * How to draw this location.
   *
   * Text and NOT an enum, on purpose and permanently. The set of visuals is a registry in
   * TypeScript, and adding one must never be a migration — a property asking for a
   * different-looking store on Tuesday should not wait for a deploy window. An unknown
   * value falls back to the generic `store` renderer with the location's own name, so a
   * row written by a newer client can never fail to render on an older one.
   *
   * PRESENTATION ONLY. Nothing may read this to decide whether stock may be put here,
   * whether a cold chain applies, or what a temperature threshold is. Those are
   * `regime`, `item.is_cold_chain` and `rule_config`, exactly as they were before this
   * migration. A chiller icon on an AMBIENT location is a data-entry mistake for the
   * setup screen to surface, never a cold chain to enforce.
   */
  add column plan_visual_type text
    check (plan_visual_type is null or length(trim(plan_visual_type)) between 1 and 40),

  -- Null means derive from the visual at render time, using the same registry that
  -- supplies the default. Deliberately not defaulted in SQL: the default depends on
  -- `plan_visual_type`, whose meaning lives in that registry, and a SQL default would be
  -- a second copy of it in the database for the two to disagree about.
  add column plan_data_behavior public.plan_data_behavior,

  -- Null means M.
  add column plan_size public.plan_size,

  add constraint location_facility_room_same_property
    foreign key (property_id, facility_room_id)
    references public.facility_room (property_id, id) on delete set null;

comment on column public.location.plan_visual_type is
  'How this location is drawn on the floor plan. Presentation only — never a storage rule. Null derives from kind and regime. ADR 0017.';
comment on column public.location.plan_data_behavior is
  'Which real source fills this location''s pin. Null derives from the visual. Never invented telemetry — an empty source renders "No reading yet".';
comment on column public.location.facility_room_id is
  'The room this location sits in on the plan. Null is drawn too, gathered into one implicit room — a plan does not require setup to have been done.';

-- Only the drawn kinds are worth an index here, and only while active: the plan reads
-- zones, and a property has a handful of those beside a couple of hundred bins.
create index location_on_floor_plan
  on public.location (property_id, facility_room_id, sort_key nulls last, code)
  where is_active and kind = 'ZONE';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.facility_room enable row level security;
alter table public.facility_room force row level security;

-- Everyone at the property reads it. The plan is the dashboard, and a storekeeper who
-- could not see the room names would get a map of unlabelled boxes.
create policy facility_room_select on public.facility_room
  for select to authenticated
  using (property_id in (select app.accessible_properties()));

-- Writing is OWNER/ADMIN, the same bar as changing the location tree, because it is the
-- same act: describing where the property keeps things.
create policy facility_room_write on public.facility_room
  for all to authenticated
  using (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[]))
  with check (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[]));

revoke all on public.facility_room from public, anon, authenticated;
grant select, insert, update, delete on public.facility_room to authenticated;

-- ---------------------------------------------------------------------------
-- Retiring a room
-- ---------------------------------------------------------------------------
--
-- A plain DELETE is permitted and safe here in a way it never is for a location: a room
-- holds no stock and nothing references it but the `facility_room_id` above, which is
-- `on delete set null` — so deleting a room ungroups its zones and loses nothing. The
-- zones themselves are untouched and keep every movement ever recorded against them.
--
-- This is the one place in the schema where delete is the right verb, and it is worth
-- saying why out loud: everything else here describes something that happened, and you
-- cannot un-happen it. A room is a statement about the present layout.
--
-- The function exists anyway, rather than leaving clients to DELETE directly, because
-- RLS denies DELETE silently (CLAUDE.md 4b) — a storekeeper's attempt would report
-- success having removed nothing.
create or replace function public.delete_facility_room(
  p_property_id uuid,
  p_room_id     uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if not app.has_property_role(
       p_property_id, array['OWNER', 'ADMIN']::public.membership_role[]
     ) then
    raise exception 'Changing the floor plan needs an Administrator.'
      using errcode = '42501';
  end if;

  -- Resolved against the property rather than trusted: SECURITY DEFINER has bypassed
  -- RLS, so an id from another property would otherwise be actionable here.
  select name into v_name
    from public.facility_room
   where id = p_room_id and property_id = p_property_id;

  if v_name is null then
    raise exception 'That room does not belong to this property.' using errcode = '42501';
  end if;

  delete from public.facility_room
   where id = p_room_id and property_id = p_property_id;

  if not found then
    raise exception 'Could not remove %.', v_name using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.delete_facility_room(uuid, uuid) from public, anon;
grant execute on function public.delete_facility_room(uuid, uuid) to authenticated;

comment on function public.delete_facility_room(uuid, uuid) is
  'Removes a room. Its locations survive and become ungrouped — a room is a statement about the layout, not a record of anything.';
