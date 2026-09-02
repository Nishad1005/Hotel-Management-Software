-- The returnable register, made real. PRD Gate 9/10 sidebar, acceptance criterion 15.
--
-- `returnable_item` has existed since the flow spine — RLS'd, granted, indexed — and
-- nothing ever wrote a row to it. The dispatch screen collected `is_returnable` and an
-- expected return date, stamped them on the note, and stopped there: crates and gas
-- cylinders left the property with a flag saying "this comes back" and no record that
-- could ever notice they had not. An aged outstanding register over an always-empty
-- table is a clean screen and a false comfort.
--
-- Three pieces close the loop:
--   1. `stage_for_dispatch` now creates the returnable record in the same transaction
--      as the dispatch, plus a backfill for the notes staged before this landed.
--   2. `record_return` receives a return — partially or in full, with condition.
--   3. `list_returnables` is the register: what is out, with whom, how old.
--
-- Deliberately NOT here (deferred with a named trigger, per the pilot plan): the return
-- as a stock movement back into a zone, and shortfall posted as a loss. The register's
-- outstanding column is the honest interim — it says what has not come back without
-- pretending the crates re-entered stock.

-- ---------------------------------------------------------------------------
-- 1a. Staging a returnable dispatch records the returnable
-- ---------------------------------------------------------------------------
--
-- Full replacement of stage_for_dispatch (house pattern for amending an RPC — as
-- put_away was for p_scan_method). The only changes against the previous version:
-- `v_total` accumulates line quantities, and the INSERT into returnable_item after the
-- loop. Everything else is verbatim.

create or replace function public.stage_for_dispatch(
  p_property_id        uuid,
  p_dispatch_type      public.dispatch_type,
  p_recipient_party_id uuid,
  p_reason_code        text,
  p_is_returnable      boolean,
  p_expected_return_date date,
  p_idempotency_key    text,
  p_lines              jsonb
)
returns table (dispatch_id uuid, dispatch_no text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_id uuid;
  v_existing_no text;
  v_id          uuid;
  v_no          text;
  v_t2          uuid;
  v_recorder    text;
  v_line        jsonb;
  v_index       integer := 0;
  v_batch       public.batch%rowtype;
  v_item        public.item%rowtype;
  v_from        uuid;
  v_state       public.stock_state;
  v_qty         numeric(14, 4);
  v_total       numeric(14, 4) := 0;
begin
  -- The same set the domain package grants `dispatch` to. Wider than receiving on
  -- purpose: Purchase owns supplier returns, the FSO owns condemned food and used
  -- cooking oil, and Banquet owns what goes out to an outdoor event.
  if not app.has_property_role(
       p_property_id,
       array['OWNER', 'ADMIN', 'STOREKEEPER', 'PURCHASE', 'FSO', 'BANQUET']::public.membership_role[]
     ) then
    raise exception 'You do not have permission to stage goods for dispatch at this property.'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'A dispatch needs a submission key, so a retry cannot stage it twice.'
      using errcode = '23514';
  end if;

  select d.id, d.dispatch_no into v_existing_id, v_existing_no
    from public.dispatch_note d
   where d.property_id = p_property_id and d.idempotency_key = p_idempotency_key;

  if v_existing_id is not null then
    return query select v_existing_id, v_existing_no;
    return;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A dispatch needs at least one line.' using errcode = '23514';
  end if;

  if p_recipient_party_id is not null then
    perform 1 from public.party where id = p_recipient_party_id and property_id = p_property_id;
    if not found then
      raise exception 'That recipient does not belong to this property.' using errcode = '42501';
    end if;
  end if;

  select id into v_t2 from public.location
   where property_id = p_property_id and kind = 'DISPATCH' and is_active
   order by code limit 1;

  if v_t2 is null then
    raise exception 'This property has no dispatch bay. Terminal 2 is where goods wait to leave.'
      using errcode = 'P0001';
  end if;

  select coalesce(nullif(trim(raw_user_meta_data ->> 'full_name'), ''), email)
    into v_recorder
    from auth.users where id = (select auth.uid());

  v_no := app.next_document_number(p_property_id, 'DISPATCH_NOTE');

  insert into public.dispatch_note (
    property_id, dispatch_no, dispatch_type, reason_code, origin_location_id,
    recipient_party_id, is_returnable, expected_return_date,
    authorised_by, staged_by_name, idempotency_key
  )
  values (
    p_property_id, v_no, p_dispatch_type, nullif(trim(coalesce(p_reason_code, '')), ''), v_t2,
    p_recipient_party_id, coalesce(p_is_returnable, false), p_expected_return_date,
    (select auth.uid()), v_recorder, p_idempotency_key
  )
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_index := v_index + 1;

    select * into v_batch from public.batch
     where id = (v_line ->> 'batch_id')::uuid and property_id = p_property_id;
    if not found then
      raise exception 'Line %: that batch does not belong to this property.', v_index
        using errcode = '42501';
    end if;

    select * into v_item from public.item
     where id = v_batch.item_id and property_id = p_property_id;
    if not found then
      raise exception 'Line %: that item does not belong to this property.', v_index
        using errcode = '42501';
    end if;

    v_from  := (v_line ->> 'from_location_id')::uuid;
    v_state := (v_line ->> 'from_state')::public.stock_state;
    v_qty   := (v_line ->> 'qty')::numeric;

    perform 1 from public.location where id = v_from and property_id = p_property_id;
    if not found then
      raise exception 'Line %: that location does not belong to this property.', v_index
        using errcode = '42501';
    end if;

    if v_state is null or v_state not in ('REJECT_HOLD', 'AVAILABLE', 'ISSUED') then
      raise exception 'Line % (%): only stock in a zone, with a department, or in the reject hold can be sent out.',
        v_index, v_item.name
        using errcode = '23514';
    end if;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Line % (%): say how much is leaving.', v_index, v_item.name
        using errcode = '23514';
    end if;

    v_total := v_total + v_qty;

    insert into public.dispatch_line
      (property_id, dispatch_note_id, batch_id, item_id, from_location_id, from_state, qty, uom_id)
    values
      (p_property_id, v_id, v_batch.id, v_item.id, v_from, v_state, v_qty, v_item.base_uom_id);

    -- STAGED_OUT at Terminal 2. Not gone: it is still on the property, still counted, and
    -- still the property's problem until Security passes it out. That distinction is the
    -- reason the state exists and cannot be retrofitted (PRD section 9).
    --
    -- Rejected stock moving to STAGED_OUT is the ONE transition out of REJECT_HOLD the
    -- ledger's check constraint permits, which is what makes dispatch the only exit.
    perform app.move_stock(
      p_property_id, v_batch.id, v_item.id,
      v_from, v_state, v_t2, 'STAGED_OUT',
      v_qty, v_item.base_uom_id, 'DISPATCH_STAGING',
      p_idempotency_key || ':line:' || v_index
    );
  end loop;

  -- The returnable record, in the SAME transaction as the dispatch. A crate that leaves
  -- on a returnable note is on this register from the moment it is staged — there is no
  -- window in which the flag exists and the record does not, which is exactly the state
  -- every pre-existing returnable dispatch was left in (see the backfill below).
  if coalesce(p_is_returnable, false) then
    insert into public.returnable_item (property_id, dispatch_note_id, qty_out)
    values (p_property_id, v_id, v_total);
  end if;

  return query select v_id, v_no;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1b. The notes staged before this landed
-- ---------------------------------------------------------------------------

insert into public.returnable_item (property_id, dispatch_note_id, qty_out)
select d.property_id, d.id, sum(dl.qty)
  from public.dispatch_note d
  join public.dispatch_line dl on dl.dispatch_note_id = d.id
 where d.is_returnable
   and not exists (
     select 1 from public.returnable_item r where r.dispatch_note_id = d.id
   )
 group by d.property_id, d.id
having sum(dl.qty) > 0;

-- ---------------------------------------------------------------------------
-- 2. Receiving a return
-- ---------------------------------------------------------------------------

create or replace function public.record_return(
  p_property_id   uuid,
  p_returnable_id uuid,
  p_qty           numeric,
  p_condition     text
)
returns table (qty_out numeric, qty_returned numeric, outstanding numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.returnable_item%rowtype;
  v_count integer;
begin
  -- The dispatch set plus SECURITY: returns arrive at the gate, and the officer who
  -- passes crates out (Gate 10) is the one standing there when they come back.
  if not app.has_property_role(
       p_property_id,
       array['OWNER', 'ADMIN', 'STOREKEEPER', 'PURCHASE', 'FSO', 'BANQUET', 'SECURITY']::public.membership_role[]
     ) then
    raise exception 'You do not have permission to record returns at this property.'
      using errcode = '42501';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'Say how much came back. More than nothing.' using errcode = '23514';
  end if;

  select * into v_row from public.returnable_item
   where id = p_returnable_id and property_id = p_property_id
   for update;

  if not found then
    raise exception 'That returnable does not belong to this property.' using errcode = '42501';
  end if;

  -- Friendlier than letting returnable_not_over_returned fire, and the constraint
  -- stays as the backstop for anything that reaches the table another way.
  if v_row.qty_returned + p_qty > v_row.qty_out then
    raise exception 'Only % outstanding on this dispatch; % cannot come back.',
      v_row.qty_out - v_row.qty_returned, p_qty
      using errcode = '23514';
  end if;

  update public.returnable_item
     set qty_returned        = public.returnable_item.qty_returned + p_qty,
         condition_on_return = coalesce(nullif(trim(p_condition), ''), condition_on_return),
         returned_at         = now()
   where id = p_returnable_id and property_id = p_property_id;

  -- Rule 4b: a write that affected nothing is a failure, never a shrug. Unreachable
  -- after the locked SELECT above, which is exactly why it costs nothing to keep.
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'The return updated nothing.' using errcode = 'P0001';
  end if;

  return query
    select r.qty_out, r.qty_returned, r.qty_out - r.qty_returned
      from public.returnable_item r
     where r.id = p_returnable_id;
end;
$$;

comment on function public.record_return(uuid, uuid, numeric, text) is
  'Receives a returnable back — partially or fully, with condition. The stock movement back into a zone and shortfall-as-loss are deferred; the register''s outstanding column is the honest interim.';

revoke all on function public.record_return(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.record_return(uuid, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The register
-- ---------------------------------------------------------------------------
--
-- SECURITY INVOKER like the other list functions: it reads only what the caller's RLS
-- lets them see, so it needs no role check of its own and can never widen a tenancy
-- boundary. Grants on the underlying tables exist from the flow spine.

create or replace function public.list_returnables(p_property_id uuid)
returns table (
  returnable_id   uuid,
  dispatch_id     uuid,
  dispatch_no     text,
  dispatch_type   public.dispatch_type,
  recipient_name  text,
  qty_out         numeric,
  qty_returned    numeric,
  outstanding     numeric,
  expected_return_date date,
  days_overdue    integer,
  staged_at       timestamptz,
  returned_at     timestamptz,
  condition_on_return text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.id, d.id, d.dispatch_no, d.dispatch_type,
    p.name,
    r.qty_out, r.qty_returned, r.qty_out - r.qty_returned,
    d.expected_return_date,
    -- Aged against the promise, only while something is still out. NULL means either
    -- no date was promised or nothing is outstanding — the register shows both plainly
    -- rather than inventing an age.
    case
      when r.qty_out - r.qty_returned > 0 and d.expected_return_date is not null
        then greatest(0, (current_date - d.expected_return_date))::int
    end,
    d.created_at, r.returned_at, r.condition_on_return
  from public.returnable_item r
  join public.dispatch_note d on d.id = r.dispatch_note_id
  left join public.party p on p.id = d.recipient_party_id
  where r.property_id = p_property_id
  order by
    (r.qty_out - r.qty_returned) > 0 desc,
    d.expected_return_date asc nulls last,
    d.created_at asc
$$;

comment on function public.list_returnables(uuid) is
  'The returnable register: everything that left on a promise to come back, aged against that promise. Outstanding first, most overdue at the top.';

grant execute on function public.list_returnables(uuid) to authenticated;
