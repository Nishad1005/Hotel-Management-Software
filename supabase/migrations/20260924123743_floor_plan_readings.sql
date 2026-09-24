-- ---------------------------------------------------------------------------
-- The Living Floor Plan — LFP-4, what the pins say
-- ---------------------------------------------------------------------------
--
-- One read per plan load, returning every figure a pin can show. The contract this
-- implements is docs/ui-redesign/living-floor-plan/LFP4_PIN_DATA_CONTRACT.md; the rules
-- that shape the SQL below are its §1, restated here where each one bites.
--
-- SECURITY INVOKER, like every other read in this schema. A figure is only trustworthy if
-- it counts the rows the caller may read, and RLS is the right answer to which those are.
-- Nothing here needs, or gets, a DEFINER path.
--
-- Two shapes of row come back, told apart by `scope`:
--
--   'LOCATION' — one per active ZONE, carrying that zone's own figures. Stock sits in
--                bins, not zones (put-away refuses anything that is not a BIN), so each
--                figure is over the zone's SUBTREE: the zone itself and every active
--                descendant. The zone itself is included because opening stock may be
--                recorded straight against a zone, and a figure that skipped it would be
--                wrong on the first day.
--   'PROPERTY' — exactly one, `location_id` null, carrying the figures that belong to the
--                property rather than to a place: what is at Terminal 1, and the
--                returnables register. The client attaches these to the scenery pins and
--                to any pin whose source is property-wide, and labels them as such.
--
-- The property figures are taken from the worklist functions the pins drill into
-- (`list_open_gate_entries`, `list_awaiting_putaway`, `list_returnables`) rather than
-- re-deriving their predicates. The pin and the screen behind it then agree by
-- construction — a second copy of "open" or "outstanding" would be a second thing to
-- keep true.
--
-- What is deliberately NOT here:
--
--   - The gate. `gate_entry.timestamp_out` is the column an on-site count needs, and
--     nothing in the product writes it yet. A count that only ever grows is not wired and
--     hidden behind a switch; it is left out, and the phase that adds the exit action adds
--     the column. The gate pin says "No reading yet", which is true.
--   - Any threshold. No figure here is compared against a limit. Whether a temperature is
--     safe, whether a dwell is too long — those are RECORD_ONLY rules with no UI to change
--     them, and a pin coloured by one would be an enforcement the property cannot turn
--     off. The one time-based fact that IS returned, `temp_read_today`, is a fact about a
--     date, not a judgement about a value.

create or replace function public.floor_plan_readings(p_property_id uuid)
returns table (
  scope                   text,
  location_id             uuid,
  -- LOCATION rows
  stock_lines             integer,
  latest_temp_c           numeric,
  latest_temp_at          timestamptz,
  temp_read_today         boolean,
  dwell_minutes           numeric,
  -- the PROPERTY row
  receiving_open          integer,
  quarantine_max_hours    numeric,
  returnables_outstanding numeric,
  returnables_overdue     integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive
  -- The zones on the plan. Scenery (gate, dock) and everything below a zone are not
  -- rows of their own; they are either the PROPERTY row or part of a zone's subtree.
  zone as (
    select l.id
      from public.location l
     where l.property_id = p_property_id
       and l.kind = 'ZONE'
       and l.is_active
  ),
  -- Every active location under each zone, the zone itself at depth 0. The tree is at
  -- most three deep (zone, rack, bin) but the recursion does not need to know that.
  tree as (
    select z.id as root_id, z.id as node_id, 0 as depth
      from zone z
    union all
    select t.root_id, c.id, t.depth + 1
      from tree t
      join public.location c
        on c.parent_id = t.node_id
       and c.property_id = p_property_id
       and c.is_active
  ),
  -- How many lots stand anywhere in the subtree. Every state, as the stock screen
  -- counts: BLOCKED and ISSUED stock is still the property's stock, and a count that hid
  -- it is how a physical count comes out short with nothing to explain the difference.
  lines as (
    select t.root_id, count(*)::int as n
      from public.stock_lot sl
      join tree t on t.node_id = sl.location_id
     where sl.property_id = p_property_id
       and sl.qty > 0
     group by t.root_id
  ),
  -- The newest temperature reading anywhere in the subtree. Needed, not decoration: a bin
  -- copies its parent's regime, so the round lists each bin under a cold room as a unit
  -- of its own, and a pin that read only the zone would say "No reading yet" over a bin
  -- read this morning. Ties to the second go to the shallower location.
  temp as (
    select distinct on (t.root_id)
           t.root_id, r.temperature_c, r.recorded_at
      from public.temperature_reading r
      join tree t on t.node_id = r.location_id
     where r.property_id = p_property_id
     order by t.root_id, r.recorded_at desc, t.depth asc
  ),
  -- The longest-standing lot in the subtree. A lot's arrival is the latest movement that
  -- put THIS batch into THIS place in THIS state — the same construction the put-away
  -- worklist uses for Terminal 1, applied to any location. A lot moved bin to bin inside
  -- the zone therefore restarts its own clock; "since it entered the zone" would need to
  -- walk the chain and is not this phase's figure.
  dwell as (
    select t.root_id,
           max(extract(epoch from (now() - a.arrived)) / 60)::numeric as minutes
      from public.stock_lot sl
      join tree t on t.node_id = sl.location_id
      join lateral (
        select max(m.occurred_at) as arrived
          from public.stock_movement m
         where m.property_id = p_property_id
           and m.batch_id = sl.batch_id
           and m.to_location_id = sl.location_id
           and m.to_state = sl.state
      ) a on a.arrived is not null
     where sl.property_id = p_property_id
       and sl.qty > 0
     group by t.root_id
  ),
  -- "Today" is the property's day, not the server's. A reading at 23:30 IST is today's
  -- reading, and UTC would file it under yesterday for the next five and a half hours.
  tz as (
    select p.timezone from public.property p where p.id = p_property_id
  ),
  returnables as (
    select coalesce(sum(r.outstanding), 0)::numeric              as outstanding,
           count(*) filter (where r.days_overdue > 0)::int          as overdue
      from public.list_returnables(p_property_id) r
     where r.outstanding > 0
  )
  select
    'LOCATION'::text,
    z.id,
    coalesce(ln.n, 0),
    tp.temperature_c,
    tp.recorded_at,
    case when tp.recorded_at is null then null
         else (tp.recorded_at at time zone (select timezone from tz))::date
            = (now()          at time zone (select timezone from tz))::date
    end,
    round(dw.minutes, 1),
    null::int, null::numeric, null::numeric, null::int
  from zone z
  left join lines ln on ln.root_id = z.id
  left join temp  tp on tp.root_id = z.id
  left join dwell dw on dw.root_id = z.id

  union all

  select
    'PROPERTY'::text,
    null::uuid,
    null::int, null::numeric, null::timestamptz, null::boolean, null::numeric,
    (select count(*)::int          from public.list_open_gate_entries(p_property_id)),
    (select max(a.hours_waiting)   from public.list_awaiting_putaway(p_property_id) a),
    (select r.outstanding from returnables r),
    (select r.overdue     from returnables r)
  -- Only for a property the caller can see. A caller RLS keeps out gets no rows at all,
  -- not a PROPERTY row of zeros that reads as "quiet".
  where exists (select 1 from public.property p where p.id = p_property_id);
$$;

revoke all on function public.floor_plan_readings(uuid) from public, anon;
grant execute on function public.floor_plan_readings(uuid) to authenticated;

comment on function public.floor_plan_readings(uuid) is
  'LFP-4. Every figure the floor plan''s pins show, in one read: per-zone stock lines, latest temperature and longest dwell over the zone''s subtree, plus one PROPERTY row for Terminal 1 and the returnables register. SECURITY INVOKER; no thresholds; the gate is deliberately absent until something writes gate_entry.timestamp_out.';
