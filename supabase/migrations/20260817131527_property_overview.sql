-- The state of the property, in one round trip.
--
-- The home screen computed its four figures by fetching the whole stock table — up to
-- five hundred rows with three joins each — and counting them in JavaScript. That was
-- fine when the numbers were "items" and "locations". It is not fine now: the app has
-- six flow screens and the figures somebody actually opens it for are the work queues,
-- which would have meant three more full fetches on the same screen.
--
-- Counting belongs where the rows are. This also stops the home screen and the watchlist
-- disagreeing about what "expiring" means, because both now take the same threshold from
-- the same place — `DEFAULT_EXPIRY_THRESHOLDS` in packages/domain, passed in.
--
-- SECURITY INVOKER, deliberately. Every count here is a count of rows the caller may
-- already read, and RLS is exactly the right answer to which those are. A definer
-- function would have to re-implement that decision, and re-implementing an access
-- decision is how the two versions of it drift apart.

create or replace function public.property_overview(
  p_property_id  uuid,
  -- Passed rather than assumed, so the rule lives in one place. The domain package owns
  -- what "expiring soon" means; this owns the counting.
  p_nearing_days integer default 7
)
returns table (
  items             integer,
  locations         integer,
  bins              integer,
  vendors           integer,
  vendors_on_hold   integer,

  -- Stock the property can actually use.
  stock_lines       integer,
  expired           integer,
  expiring_soon     integer,

  -- The work queues, in flow order. These are the figures somebody opening the app at
  -- seven in the morning is looking for, and none of them existed before.
  arrivals_waiting  integer,
  arrivals_overdue  integer,
  quarantine_lines  integer,
  quarantine_oldest_hours numeric,
  awaiting_gate_pass integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select count(*)::int from public.item
      where property_id = p_property_id and is_active),
    (select count(*)::int from public.location
      where property_id = p_property_id and is_active),
    (select count(*)::int from public.location
      where property_id = p_property_id and is_active and kind = 'BIN'),
    (select count(*)::int from public.party
      where property_id = p_property_id and is_active),
    (select count(*)::int from public.party
      where property_id = p_property_id and is_active and on_hold),

    (select count(*)::int from public.stock_lot
      where property_id = p_property_id and state = 'AVAILABLE' and qty > 0),
    -- Past the date and still on the books, which is money already lost rather than a
    -- warning about money at risk. Counted separately for that reason.
    (select count(*)::int from public.stock_lot sl
       join public.batch b on b.id = sl.batch_id
      where sl.property_id = p_property_id and sl.state = 'AVAILABLE' and sl.qty > 0
        and b.best_before is not null and b.best_before < current_date),
    (select count(*)::int from public.stock_lot sl
       join public.batch b on b.id = sl.batch_id
      where sl.property_id = p_property_id and sl.state = 'AVAILABLE' and sl.qty > 0
        and b.best_before is not null
        and b.best_before >= current_date
        and b.best_before <= current_date + coalesce(p_nearing_days, 7)),

    -- Arrivals with no receipt against them. PRD section 1: every gate entry resolves to
    -- a GRN or raises an alert, and this figure is that alert.
    (select count(*)::int from public.gate_entry ge
      where ge.property_id = p_property_id
        and not exists (select 1 from public.grn g
                         where g.gate_entry_id = ge.id and g.amendment_of is null)),
    (select count(*)::int from public.gate_entry ge
      where ge.property_id = p_property_id
        and ge.timestamp_in < now() - interval '4 hours'
        and not exists (select 1 from public.grn g
                         where g.gate_entry_id = ge.id and g.amendment_of is null)),

    (select count(*)::int from public.stock_lot
      where property_id = p_property_id and state = 'QUARANTINE' and qty > 0),
    -- How long the oldest thing at Terminal 1 has stood there. One number that says more
    -- than the count does: five lines put away this morning is routine, one line standing
    -- since yesterday is not.
    (select round(extract(epoch from (now() - min(m.occurred_at)))::numeric / 3600, 1)
       from public.stock_lot sl
       join public.stock_movement m
         on m.batch_id = sl.batch_id and m.to_state = 'QUARANTINE'
      where sl.property_id = p_property_id and sl.state = 'QUARANTINE' and sl.qty > 0),

    (select count(*)::int from public.dispatch_note d
      where d.property_id = p_property_id
        and not exists (select 1 from public.gate_pass g where g.dispatch_note_id = d.id));
$$;

revoke all on function public.property_overview(uuid, integer) from public, anon;
grant execute on function public.property_overview(uuid, integer) to authenticated;

comment on function public.property_overview(uuid, integer) is
  'Every figure the home screen shows, counted where the rows are. SECURITY INVOKER: each count is over rows the caller may already read, and RLS is the right answer to which those are.';

-- ---------------------------------------------------------------------------
-- Where everything is
-- ---------------------------------------------------------------------------
--
-- The most-asked question of any stock system, and until now there was no screen that
-- answered it — only the expiry watchlist, which is a different question wearing similar
-- clothes.
--
-- Every state, not just AVAILABLE. Stock in quarantine, in the reject cage, staged at
-- Terminal 2 or held by a department is still the property's stock; showing only what is
-- issuable is how a count comes out short and nobody can say where the rest went.

create or replace function public.list_stock_on_hand(
  p_property_id uuid,
  p_search      text default null
)
returns table (
  batch_id       uuid,
  batch_no       text,
  is_system_generated boolean,
  item_id        uuid,
  item_name      text,
  item_code      text,
  category_name  text,
  uom_code       text,
  location_id    uuid,
  location_code  text,
  location_name  text,
  location_kind  public.location_kind,
  state          public.stock_state,
  qty            numeric,
  best_before    date,
  days_remaining integer,
  dwell_breach   boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    b.id, b.batch_no, b.is_system_generated,
    i.id, i.name, i.code, c.name, u.code,
    l.id, l.code, l.name, l.kind,
    sl.state, sl.qty, b.best_before,
    case when b.best_before is null then null
         else (b.best_before - current_date)::int end,
    b.dwell_breach
  from public.stock_lot sl
  join public.batch         b on b.id = sl.batch_id
  join public.item          i on i.id = b.item_id
  join public.item_category c on c.id = i.category_id
  join public.uom           u on u.id = i.base_uom_id
  join public.location      l on l.id = sl.location_id
  where sl.property_id = p_property_id
    and sl.qty > 0
    and (
      p_search is null or length(trim(p_search)) = 0
      or i.name  ilike '%' || trim(p_search) || '%'
      or i.code  ilike '%' || trim(p_search) || '%'
      or b.batch_no ilike '%' || trim(p_search) || '%'
      or l.code  ilike '%' || trim(p_search) || '%'
    )
  -- Grouped by item, then oldest first inside it. Somebody looking up rice wants every
  -- place it is, together, with the batch to use next at the top.
  order by i.name, b.best_before asc nulls last, l.code;
$$;

revoke all on function public.list_stock_on_hand(uuid, text) from public, anon;
grant execute on function public.list_stock_on_hand(uuid, text) to authenticated;

comment on function public.list_stock_on_hand(uuid, text) is
  'Every lot holding stock, in every state. Quarantine, reject hold and department-held stock are included: they are still the property''s, and omitting them is how a count comes out short with nothing to explain it.';
