-- Gates 1 to 5, in one transaction.
--
-- Arrival, quantity, quality, decision and GRN posting are one act as far as the
-- database is concerned. They cannot be five statements from a client, for a reason
-- that is specific rather than stylistic: a posted GRN is immutable by trigger, so a
-- half-written one cannot be repaired by editing — only by amendment, which is a
-- document with a reason and an authority. Partial failure stops being untidy and
-- becomes unrecoverable.
--
-- The skeleton is GOLAI's verify_grn: a jsonb lines loop, per-line validation raising a
-- specific message, and a forced reason on anything that does not reconcile. What is
-- replaced is the stock handling — theirs calls a primitive that mutates a balance row,
-- ours calls app.move_stock, which appends to the ledger and holds the lock.

-- ---------------------------------------------------------------------------
-- Who recorded it, captured where every caller passes through
-- ---------------------------------------------------------------------------
--
-- The previous migration added stock_movement.recorded_by_name and nothing filled it,
-- which is worse than not having the column: a null there reads as "the user was
-- deleted" rather than "we never wrote it".
--
-- Filled here rather than in each RPC, for the same reason move_stock exists at all.
-- Four call sites setting it independently is four chances for one of them to forget,
-- and the failure is silent until an audit three years later asks who received a
-- consignment. One lookup on an indexed primary key per movement is not a cost worth
-- optimising against that.
create or replace function app.move_stock(
  p_property_id      uuid,
  p_batch_id         uuid,
  p_item_id          uuid,
  p_from_location_id uuid,
  p_from_state       public.stock_state,
  p_to_location_id   uuid,
  p_to_state         public.stock_state,
  p_qty              numeric,
  p_uom_id           uuid,
  p_reason           public.movement_reason,
  p_idempotency_key  text,
  p_note             text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_available numeric(14, 4);
  v_code      text;
  v_name      text;
  v_id        uuid;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'A movement needs a quantity greater than zero.' using errcode = '23514';
  end if;

  -- Every id is re-resolved against the property it was handed. SECURITY DEFINER has
  -- already bypassed RLS by this point, so nothing below can be assumed to belong here
  -- — and this is precisely the check golaiv1's RPCs omit, passing a client-supplied
  -- shelf_id straight through to the stock primitive.
  perform 1 from public.batch
   where id = p_batch_id and property_id = p_property_id;
  if not found then
    raise exception 'That batch does not belong to this property.' using errcode = '42501';
  end if;

  perform 1 from public.item
   where id = p_item_id and property_id = p_property_id;
  if not found then
    raise exception 'That item does not belong to this property.' using errcode = '42501';
  end if;

  if p_from_location_id is not null then
    perform 1 from public.location
     where id = p_from_location_id and property_id = p_property_id;
    if not found then
      raise exception 'The source location does not belong to this property.'
        using errcode = '42501';
    end if;
  end if;

  if p_to_location_id is not null then
    perform 1 from public.location
     where id = p_to_location_id and property_id = p_property_id;
    if not found then
      raise exception 'The destination does not belong to this property.'
        using errcode = '42501';
    end if;
  end if;

  -- Sufficiency, under a lock.
  --
  -- This is the reason the flow needs a function at all rather than a policy: RLS
  -- decides which rows you may see, and "is there enough" is an aggregate over rows
  -- already written. Only a lock makes the read and the write atomic, so two issues of
  -- the same lot cannot both pass the check and then both succeed.
  --
  -- The check constraint on stock_lot is a backstop for the same condition, but it
  -- fires as a constraint violation naming a constraint. This raises with the quantity
  -- and the place, which is what a storekeeper can act on.
  if p_from_location_id is not null and p_from_state is not null then
    select qty into v_available
      from public.stock_lot
     where batch_id = p_batch_id
       and location_id = p_from_location_id
       and state = p_from_state
     for update;

    if v_available is null then
      raise exception 'There is none of that batch here to move.' using errcode = '23514';
    end if;

    if v_available < p_qty then
      select code into v_code from public.location where id = p_from_location_id;
      raise exception 'Only % available on %.', trim(to_char(v_available, 'FM999999990.####')), v_code
        using errcode = '23514';
    end if;
  end if;

  -- Snapshotted, never a join. recorded_by is nulled when a user is deleted; this
  -- records who the person was at the moment they acted, which is the question an audit
  -- actually asks.
  select coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), u.email)
    into v_name
    from auth.users u
   where u.id = (select auth.uid());

  insert into public.stock_movement (
    property_id, batch_id, item_id,
    from_location_id, from_state, to_location_id, to_state,
    qty, uom_id, reason, recorded_by, recorded_by_name, idempotency_key, note
  )
  values (
    p_property_id, p_batch_id, p_item_id,
    p_from_location_id, p_from_state, p_to_location_id, p_to_state,
    p_qty, p_uom_id, p_reason, (select auth.uid()), v_name, p_idempotency_key, p_note
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Idempotency, on the document rather than beside it
-- ---------------------------------------------------------------------------
--
-- A GRN post writes a header, N lines, N batches and N movements. stock_movement's own
-- idempotency key covers one row, so a retry after a lost acknowledgement needs
-- something at the document level.
--
-- On the GRN itself rather than a generic request table: the natural question is "has
-- this GRN already been posted", and answering it from the GRN is one index rather than
-- a second table that has to be kept in step with it.
alter table public.grn
  add column idempotency_key text;

create unique index grn_idempotency_unique
  on public.grn (property_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.grn.idempotency_key is
  'Identifies the submission, so a retry returns the original GRN rather than posting a second one. The ledger is append-only and the GRN immutable, so a duplicate is not something anybody can tidy up.';

-- ---------------------------------------------------------------------------
-- Posting
-- ---------------------------------------------------------------------------

create or replace function public.post_grn(
  p_property_id     uuid,
  p_gate_entry_id   uuid,
  p_party_id        uuid,
  p_idempotency_key text,
  p_lines           jsonb
)
returns table (grn_id uuid, grn_no text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_id   uuid;
  v_existing_no   text;
  v_grn_id        uuid;
  v_grn_no        text;
  v_receiving     uuid;
  v_reject        uuid;
  v_line          jsonb;
  v_index         integer := 0;
  v_item          public.item%rowtype;
  v_batch_id      uuid;
  v_batch_no      text;
  v_generated     boolean;
  v_uom_id        uuid;
  v_qty_physical  numeric(14, 4);
  v_qty_accepted  numeric(14, 4);
  v_qty_rejected  numeric(14, 4);
  v_decision      public.grn_line_decision;
  v_reject_reason public.reject_reason;
  v_best_before   date;
  v_temp          numeric(5, 2);
  v_pct           numeric(5, 2);
begin
  -- The same list the domain package grants `receiving` to, and it has to stay the same
  -- list: where the capability table and a policy disagree the policy wins and the app
  -- has a bug, so the disagreement should not exist.
  --
  -- STOREKEEPER because receiving is their work; OWNER and ADMIN because a small
  -- property is one person holding every role. PURCHASE is absent — they approve
  -- variance against the order, they do not stand at the dock. SECURITY is absent for a
  -- stronger reason: they raise the gate entry, and if the same person raised the GRN
  -- too then the two records agree by construction and the reconciliation control this
  -- whole module rests on stops existing while continuing to look like it works.
  if not app.has_property_role(
       p_property_id,
       array['OWNER', 'ADMIN', 'STOREKEEPER']::public.membership_role[]
     ) then
    raise exception 'You do not have permission to receive goods at this property.'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'A goods receipt needs a submission key, so a retry cannot post it twice.'
      using errcode = '23514';
  end if;

  -- A replay returns what the first attempt produced. The outbox retries, and a second
  -- GRN for one delivery is not a duplicate row — it is stock counted twice, on an
  -- append-only ledger, under a number somebody has written on a challan.
  select g.id, g.grn_no into v_existing_id, v_existing_no
    from public.grn g
   where g.property_id = p_property_id and g.idempotency_key = p_idempotency_key;

  if v_existing_id is not null then
    return query select v_existing_id, v_existing_no;
    return;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A goods receipt needs at least one line.' using errcode = '23514';
  end if;

  -- Every reference re-resolved against the property. SECURITY DEFINER has bypassed RLS
  -- by now, so nothing handed in can be assumed to belong here.
  if p_gate_entry_id is not null then
    perform 1 from public.gate_entry
     where id = p_gate_entry_id and property_id = p_property_id;
    if not found then
      raise exception 'That gate entry does not belong to this property.' using errcode = '42501';
    end if;
  end if;

  if p_party_id is not null then
    perform 1 from public.party where id = p_party_id and property_id = p_property_id;
    if not found then
      raise exception 'That vendor does not belong to this property.' using errcode = '42501';
    end if;
  end if;

  -- Terminal 1 and the reject cage, found by kind rather than by code, so a property
  -- that renames them keeps working. Ordered, because a property that has somehow ended
  -- up with two receiving bays should at least get the same one every time.
  select id into v_receiving from public.location
   where property_id = p_property_id and kind = 'RECEIVING' and is_active
   order by code limit 1;

  select id into v_reject from public.location
   where property_id = p_property_id and kind = 'REJECT' and is_active
   order by code limit 1;

  if v_receiving is null or v_reject is null then
    raise exception 'This property has no receiving bay or no reject hold. Both are needed before goods can be received.'
      using errcode = 'P0001';
  end if;

  v_grn_no := app.next_document_number(p_property_id, 'GRN');

  insert into public.grn (property_id, grn_no, gate_entry_id, party_id, posted_by, idempotency_key)
  values (p_property_id, v_grn_no, p_gate_entry_id, p_party_id, (select auth.uid()), p_idempotency_key)
  returning id into v_grn_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_index := v_index + 1;

    select * into v_item from public.item
     where id = (v_line ->> 'item_id')::uuid and property_id = p_property_id;

    if not found then
      raise exception 'Line %: that item is not in this property''s item master. Nothing can be created at the dock.', v_index
        using errcode = '42501';
    end if;

    -- Falls back to the item's base unit, so a caller that has nothing to convert does
    -- not have to look one up.
    v_uom_id := coalesce((v_line ->> 'uom_id')::uuid, v_item.base_uom_id);

    perform 1 from public.uom where id = v_uom_id and property_id = p_property_id;
    if not found then
      raise exception 'Line % (%): that unit does not belong to this property.', v_index, v_item.name
        using errcode = '42501';
    end if;

    v_qty_physical  := (v_line ->> 'qty_physical')::numeric;
    v_qty_accepted  := coalesce((v_line ->> 'qty_accepted')::numeric, 0);
    v_qty_rejected  := coalesce((v_line ->> 'qty_rejected')::numeric, 0);
    v_decision      := (v_line ->> 'decision')::public.grn_line_decision;
    v_reject_reason := (v_line ->> 'reject_reason')::public.reject_reason;
    v_best_before   := (v_line ->> 'best_before')::date;
    v_temp          := (v_line ->> 'receipt_temp_c')::numeric;

    if v_qty_physical is null or v_qty_physical <= 0 then
      raise exception 'Line % (%): count what actually arrived.', v_index, v_item.name
        using errcode = '23514';
    end if;

    if v_qty_accepted < 0 or v_qty_rejected < 0 then
      raise exception 'Line % (%): a quantity cannot be negative.', v_index, v_item.name
        using errcode = '23514';
    end if;

    -- Stricter than the table's own constraint, which permits the two to sum to less
    -- than what arrived. Every unit that came through the gate is either taken on or
    -- handed back; a remainder is stock the property has admitted to holding and then
    -- lost track of on the same form.
    if v_qty_accepted + v_qty_rejected <> v_qty_physical then
      raise exception 'Line % (%): accepted plus rejected is %, but % arrived. Every unit has to be one or the other.',
        v_index, v_item.name,
        trim(to_char(v_qty_accepted + v_qty_rejected, 'FM999999990.####')),
        trim(to_char(v_qty_physical, 'FM999999990.####'))
        using errcode = '23514';
    end if;

    -- The decision is a fourth non-negotiable field, and it must agree with the counts
    -- rather than sit beside them. A line marked ACCEPT with a rejected quantity is the
    -- register saying two different things about the same consignment.
    if v_decision is null then
      raise exception 'Line % (%): accept, part-accept or reject — the line needs a decision.', v_index, v_item.name
        using errcode = '23514';
    end if;

    if v_decision = 'ACCEPT' and v_qty_rejected > 0 then
      raise exception 'Line % (%): the line is marked accepted but has a rejected quantity.', v_index, v_item.name
        using errcode = '23514';
    end if;

    if v_decision = 'REJECT' and v_qty_accepted > 0 then
      raise exception 'Line % (%): the line is marked rejected but has an accepted quantity.', v_index, v_item.name
        using errcode = '23514';
    end if;

    if v_decision = 'ACCEPT_PARTIAL' and (v_qty_accepted = 0 or v_qty_rejected = 0) then
      raise exception 'Line % (%): a part-acceptance needs both an accepted and a rejected quantity.', v_index, v_item.name
        using errcode = '23514';
    end if;

    -- Six reasons, and one of them is OTHER, so this asks for a keystroke rather than a
    -- justification. What it stops is a rejection nobody can put to the vendor.
    if v_decision <> 'ACCEPT' and v_reject_reason is null then
      raise exception 'Line % (%): say why any of it was turned away.', v_index, v_item.name
        using errcode = '23514';
    end if;

    -- The non-negotiable quality floor (PRD section 4 Gate 3a). Four fields survive
    -- whatever management switches off; the quantity and the decision are above, and
    -- these are the other two. No enforcement mode, because a mode is what a property
    -- turns down.
    if v_item.is_perishable and v_best_before is null then
      raise exception 'Line % (%): a perishable line needs a best-before date.', v_index, v_item.name
        using errcode = '23514';
    end if;

    if v_item.is_cold_chain and v_temp is null then
      raise exception 'Line % (%): a cold-chain line needs a probe temperature.', v_index, v_item.name
        using errcode = '23514';
    end if;

    -- Batch numbers: the vendor's where there is one, generated where there is not, and
    -- flagged either way so a trace can tell them apart (PRD section 4 Gate 3).
    v_batch_no  := nullif(trim(coalesce(v_line ->> 'batch_no', '')), '');
    v_generated := v_batch_no is null;
    if v_generated then
      v_batch_no := 'SYS-' || v_grn_no || '-' || lpad(v_index::text, 2, '0');
    end if;

    -- Remaining shelf life frozen at receipt, never recomputed. Recomputing would erase
    -- the fact that the delivery was already old when it arrived, which is the one thing
    -- this number exists to record.
    v_pct := case
      when v_best_before is not null and v_item.shelf_life_days is not null
        then least(100, greatest(0,
          round(((v_best_before - current_date)::numeric / v_item.shelf_life_days) * 100, 2)))
      else null
    end;

    -- The same physical lot can arrive twice — a second drop of one vendor batch later
    -- the same week. That is one batch with two receipts, not two batches, and treating
    -- it as two would split the trace exactly where a recall needs it whole.
    select id into v_batch_id from public.batch
     where property_id = p_property_id and item_id = v_item.id and batch_no = v_batch_no;

    if v_batch_id is null then
      insert into public.batch (
        property_id, item_id, batch_no, is_system_generated,
        mfg_date, best_before, shelf_life_total_days, pct_at_receipt, receipt_temp_c, source
      )
      values (
        p_property_id, v_item.id, v_batch_no, v_generated,
        (v_line ->> 'mfg_date')::date, v_best_before, v_item.shelf_life_days,
        v_pct, v_temp, 'GRN'
      )
      returning id into v_batch_id;
    end if;

    insert into public.grn_line (
      property_id, grn_id, item_id, batch_id,
      qty_challan, qty_physical, qty_accepted, qty_rejected,
      uom_id, decision, reject_reason
    )
    values (
      p_property_id, v_grn_id, v_item.id, v_batch_id,
      (v_line ->> 'qty_challan')::numeric, v_qty_physical, v_qty_accepted, v_qty_rejected,
      v_uom_id, v_decision, v_reject_reason
    );

    -- Accepted stock lands in QUARANTINE at Terminal 1, not AVAILABLE. It becomes
    -- issuable only after put-away, which is the whole point of Gate 6.
    if v_qty_accepted > 0 then
      perform app.move_stock(
        p_property_id, v_batch_id, v_item.id,
        null, null, v_receiving, 'QUARANTINE',
        v_qty_accepted, v_uom_id, 'GRN_POSTING',
        p_idempotency_key || ':acc:' || v_index
      );
    end if;

    -- Rejected stock goes to the reject hold and can never reach a zone. That is a hard
    -- rule with no enforcement mode, and stock_movement carries a check constraint
    -- saying the same thing, because an offline client cannot be trusted to.
    if v_qty_rejected > 0 then
      perform app.move_stock(
        p_property_id, v_batch_id, v_item.id,
        null, null, v_reject, 'REJECT_HOLD',
        v_qty_rejected, v_uom_id, 'GRN_POSTING',
        p_idempotency_key || ':rej:' || v_index
      );
    end if;
  end loop;

  return query select v_grn_id, v_grn_no;
end;
$$;

revoke all on function public.post_grn(uuid, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.post_grn(uuid, uuid, uuid, text, jsonb) to authenticated;

comment on function public.post_grn(uuid, uuid, uuid, text, jsonb) is
  'Gates 1-5 in one transaction: header, lines, batches and movements into QUARANTINE and REJECT_HOLD. Atomic because a posted GRN is immutable, so a half-written one can only be corrected by amendment.';

-- ---------------------------------------------------------------------------
-- Reading a receipt back
-- ---------------------------------------------------------------------------
--
-- grn and grn_line have select policies but no INSERT grant to authenticated, which is
-- deliberate: post_grn is the only way in. Reading is ordinary, so it stays as policy.
--
-- What was missing is the reciprocal of the reconciliation control — the open gate
-- entries. PRD section 1 makes "every gate entry resolves to a GRN or raises an alert"
-- the reason this module exists, and the receiving screen needs the list to work from.
create or replace function public.list_open_gate_entries(p_property_id uuid)
returns table (
  id             uuid,
  gate_entry_no  text,
  timestamp_in   timestamptz,
  party_id       uuid,
  party_name     text,
  arrival_type   public.arrival_type,
  package_count  integer,
  vehicle_number text,
  hours_open     numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    ge.id,
    ge.gate_entry_no,
    ge.timestamp_in,
    ge.party_id,
    coalesce(p.name, ge.unregistered_vendor_name),
    ge.arrival_type,
    ge.package_count,
    ge.vehicle_number,
    round(extract(epoch from (now() - ge.timestamp_in))::numeric / 3600, 1)
  from public.gate_entry ge
  left join public.party p
    on p.id = ge.party_id and p.property_id = ge.property_id
  where ge.property_id = p_property_id
    and not exists (
      select 1 from public.grn g
       where g.gate_entry_id = ge.id and g.amendment_of is null
    )
  order by ge.timestamp_in;
$$;

revoke all on function public.list_open_gate_entries(uuid) from public, anon;
grant execute on function public.list_open_gate_entries(uuid) to authenticated;

comment on function public.list_open_gate_entries(uuid) is
  'Gate entries with no GRN against them yet — the receiving worklist, and the same query the reconciliation sweep will run. SECURITY INVOKER: RLS on gate_entry is exactly the right answer to who may see these.';
