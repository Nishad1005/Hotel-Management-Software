-- Everything the bin tree needs that the enum alone could not carry.
--
-- Onboarding is ours to do: we build the zone and bin tree from the layout the property
-- sends, generate the labels, and hand over a PDF. So this table is tooling as much as
-- it is a domain model, and the columns below exist to make an implementer fast rather
-- than to satisfy a diagram.

-- ---------------------------------------------------------------------------
-- The property's own word for the thing
-- ---------------------------------------------------------------------------
--
-- golaiv1 shipped this as an enum and had to convert it to free text, because clients
-- call their storage whatever they use on the floor. A *ghoda* is the trestle that
-- sacks and sheet material lean on; nobody in that store calls it anything else. A
-- system that renames it to "trestle" teaches every user to translate, every day.
--
-- So the app echoes the property's word back on every screen and every printed sticker.
-- `kind` stays the enum, because the rules key on it; `fixture_type` is what people
-- read. Suggestions are offered in the UI and never imposed.
alter table public.location
  add column fixture_type text not null default 'Shelf'
    check (length(trim(fixture_type)) between 1 and 32);

comment on column public.location.fixture_type is
  'What this property calls this kind of place — Shelf, Rack, Ghoda, Peti stack, Cold room shelf. Display only; rules key on `kind`.';

-- ---------------------------------------------------------------------------
-- Coordinates, for places found by walking rather than by reading a shelf edge
-- ---------------------------------------------------------------------------
--
-- Bora stacked on the dry-store floor, the LPG cylinder bank, crate stacks: there is no
-- shelf edge to read a code off. Stored rather than parsed out of the code, so the map
-- can render an EMPTY position — a grid with holes in it is the thing an implementer
-- needs to see, and a code list cannot show it.
--
-- Aisles are deliberately not stored. golaiv1 shipped an `aisle_after` flag, replaced it
-- with blocks one migration later, and left the dead column behind. Roads are drawn
-- between blocks and reconstructed from the grouping.
--
-- IMPORTANT, and easy to get wrong when reading golaiv1: their stated reason for
-- coordinates is that "a barcode can't be stuck where it can be scanned". That
-- rationale does NOT transfer. Hard rule 13 permits no typed destination and has no
-- enforcement mode, so a coordinate is a way to FIND a position, never a way to confirm
-- one. Every position still carries a scannable label — on the pillar, upright or floor
-- marking beside the goods rather than on them.
alter table public.location
  add column grid_block integer check (grid_block is null or grid_block >= 1),
  add column grid_row integer check (grid_row is null or grid_row >= 1),
  add column grid_col integer check (grid_col is null or grid_col >= 1),
  -- Partially-specified coordinates would sort and render arbitrarily.
  add constraint location_grid_is_complete_or_absent check (
    (grid_block is null and grid_row is null and grid_col is null)
    or (grid_block is not null and grid_row is not null and grid_col is not null)
  );

create unique index location_grid_unique
  on public.location (property_id, parent_id, grid_block, grid_row, grid_col)
  where grid_block is not null;

comment on column public.location.grid_block is
  'Blocks of positions with roads between them, for stock found by coordinate. Never a substitute for scanning: see hard rule 13.';

-- ---------------------------------------------------------------------------
-- Walking order
-- ---------------------------------------------------------------------------
--
-- Codes sort lexically, so SB-DRY-S10 comes before SB-DRY-S9 — wrong on a picking walk,
-- wrong on a label sheet, and wrong in every dropdown. The generator zero-pads to three
-- digits, which fixes it up to 999 and then quietly stops fixing it.
alter table public.location
  add column sort_key integer;

create index location_walking_order
  on public.location (property_id, parent_id, sort_key nulls last, code);

comment on column public.location.sort_key is
  'Explicit walking order within a parent. Null falls back to code order, which is only correct while every sequence is the same width.';

-- ---------------------------------------------------------------------------
-- Retiring a location
-- ---------------------------------------------------------------------------
--
-- golaiv1's delete_location clears the location's stock rows so a removed place stops
-- counting toward item totals. We cannot: the equivalent is deleting from `stock_lot`,
-- a maintained projection our own pgTAP asserts equals a full ledger replay. Doing it
-- would break that test, and correctly so — stock does not stop existing because a
-- shelf was retired in an admin screen.
--
-- So this refuses while anything is there, and says what. Emptying a location is a
-- compensating movement with a reason and a named person, which is the only account of
-- where the stock went that a stock take can be reconciled against.
create or replace function public.deactivate_location(p_property_id uuid, p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_held   numeric(14, 4);
  v_code   text;
  v_active boolean;
begin
  if not app.has_property_role(
       p_property_id, array['OWNER', 'ADMIN']::public.membership_role[]
     ) then
    raise exception 'You do not have permission to change locations at this property.'
      using errcode = '42501';
  end if;

  -- Resolved against the property rather than trusted, because SECURITY DEFINER has
  -- bypassed RLS and an id from another property would otherwise be actionable here.
  select code, is_active into v_code, v_active
    from public.location
   where id = p_location_id and property_id = p_property_id;

  if v_code is null then
    raise exception 'That location does not belong to this property.' using errcode = '42501';
  end if;

  if not v_active then
    return; -- Already retired. Saying so twice helps nobody.
  end if;

  select coalesce(sum(qty), 0) into v_held
    from public.stock_lot
   where location_id = p_location_id and property_id = p_property_id;

  if v_held > 0 then
    raise exception
      'There is still stock on %. Move it somewhere else first — retiring a location does not make its stock disappear.',
      v_code
      using errcode = 'P0001';
  end if;

  update public.location
     set is_active = false
   where id = p_location_id and property_id = p_property_id;

  if not found then
    raise exception 'Could not retire %.', v_code using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.deactivate_location(uuid, uuid) from public, anon;
grant execute on function public.deactivate_location(uuid, uuid) to authenticated;

comment on function public.deactivate_location(uuid, uuid) is
  'Retires a location, refusing while it still holds stock. Emptying a location is a compensating stock movement, never a delete from the projection (ADR 0003).';
