-- Correcting a posted goods receipt.
--
-- Non-negotiable 10 is "GRN immutability with an amendment trail", and only half of it
-- existed. `amendment_of` has been on the table since the flow spine, the triggers have
-- refused UPDATE and DELETE since the same day, and nothing could write an amendment —
-- so a posted GRN was not immutable, it was uncorrectable. Somebody types 400 instead of
-- 40 on the first morning and the only remedy is a compensating stock movement with no
-- document behind it, which is precisely the thing the immutability rule exists to stop.
--
-- ---------------------------------------------------------------------------
-- What an amendment is
-- ---------------------------------------------------------------------------
--
-- A NEW receipt, with its own number, pointing at the one it supersedes. The original is
-- never touched — the trail is the chain itself (PRD section 4 Gate 5). Both appear in
-- the inward register, the original marked as superseded, because hiding it would defeat
-- the whole point of having a trail.
--
-- ---------------------------------------------------------------------------
-- The part that is not paperwork
-- ---------------------------------------------------------------------------
--
-- Correcting the document is easy. Correcting the STOCK is the real work: 400 units went
-- into quarantine, and if only 40 arrived then 360 were never real and have to leave the
-- ledger. That is a compensating movement with reason CORRECTION, because the ledger is
-- append-only and nothing is ever edited out of it.
--
-- Which means an amendment can only reduce a line by what is still where the receipt put
-- it. Once stock has been put away and issued it is in bins and departments and cannot be
-- attributed back to a line. This refuses that case by name rather than silently
-- correcting the paperwork and leaving the stock wrong — a register that disagrees with
-- the shelf is worse than one that admits it cannot help.

create or replace function public.amend_grn(
  p_property_id     uuid,
  p_grn_id          uuid,
  p_reason          text,
  p_idempotency_key text,
  p_lines           jsonb
)
returns table (grn_id uuid, grn_no text, adjusted_lines integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_id uuid;
  v_existing_no text;
  v_original    public.grn%rowtype;
  v_new_id      uuid;
  v_new_no      text;
  v_recorder    text;
  v_line        jsonb;
  v_index       integer := 0;
  v_adjusted    integer := 0;
  v_orig_line   public.grn_line%rowtype;
  v_item        public.item%rowtype;
  v_physical    numeric(14, 4);
  v_accepted    numeric(14, 4);
  v_rejected    numeric(14, 4);
  v_decision    public.grn_line_decision;
  v_reason      public.reject_reason;
  v_delta       numeric(14, 4);
  v_where       uuid;
  v_held        numeric(14, 4);
begin
  -- Deliberately NOT the storekeeper. Whoever posted a receipt must not be able to
  -- quietly correct it afterwards, for the same reason Security cannot pass out a
  -- consignment they staged — a control one person can be both ends of is not one. On a
  -- small property the storekeeper posts and the owner amends, which is the shape this
  -- expects.
  if not app.has_property_role(
       p_property_id,
       array['OWNER', 'ADMIN', 'GM']::public.membership_role[]
     ) then
    raise exception 'Amending a posted receipt needs an owner, an administrator or the general manager. It is deliberately not the person who posted it.'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'An amendment needs a submission key, so a retry cannot post two.'
      using errcode = '23514';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Say why the receipt is being corrected. An amendment with no reason is an edit wearing a document''s clothes.'
      using errcode = '23514';
  end if;

  select g.id, g.grn_no into v_existing_id, v_existing_no
    from public.grn g
   where g.property_id = p_property_id and g.idempotency_key = p_idempotency_key;

  if v_existing_id is not null then
    -- Aliased, like every grn_line reference in this function: `grn_id` is also one of
    -- this function's own OUT parameters, and Postgres reports the collision at call time
    -- rather than at creation.
    select count(*)::int into v_adjusted
      from public.grn_line gl where gl.grn_id = v_existing_id;
    return query select v_existing_id, v_existing_no, v_adjusted;
    return;
  end if;

  select * into v_original from public.grn
   where id = p_grn_id and property_id = p_property_id;

  if not found then
    raise exception 'That receipt does not belong to this property.' using errcode = '42501';
  end if;

  -- The chain has one head. Amending a superseded receipt would fork the trail, and two
  -- corrections of the same original would each look authoritative.
  perform 1 from public.grn where amendment_of = p_grn_id;
  if found then
    raise exception '% has already been amended. Correct the amendment instead — a receipt has one current version.',
      v_original.grn_no
      using errcode = '23505';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'An amendment needs at least one line.' using errcode = '23514';
  end if;

  select coalesce(nullif(trim(raw_user_meta_data ->> 'full_name'), ''), email)
    into v_recorder
    from auth.users where id = (select auth.uid());

  v_new_no := app.next_document_number(p_property_id, 'GRN');

  insert into public.grn (
    property_id, grn_no, gate_entry_id, party_id, posted_by,
    amendment_of, amendment_reason, idempotency_key
  )
  values (
    p_property_id, v_new_no, v_original.gate_entry_id, v_original.party_id, (select auth.uid()),
    p_grn_id, trim(p_reason), p_idempotency_key
  )
  returning id into v_new_id;

  -- Every id in the payload has to be a line of this receipt. Checked before anything is
  -- written, because a mistyped id would otherwise fall through the loop below and
  -- silently change nothing while reporting success.
  perform 1
     from jsonb_array_elements(p_lines) e
    where not exists (
      select 1 from public.grn_line gl
       where gl.id = (e.value ->> 'grn_line_id')::uuid
         and gl.grn_id = p_grn_id and gl.property_id = p_property_id
    );
  if found then
    raise exception 'An amendment can only correct lines of %.', v_original.grn_no
      using errcode = '42501';
  end if;

  -- Over the ORIGINAL lines, not the payload. An amendment usually corrects one line of
  -- six, and a loop over what was supplied would produce a corrected receipt holding only
  -- that one line — quietly deleting the other five from the record while looking like it
  -- had worked.
  for v_orig_line in
    select gl.* from public.grn_line gl
     where gl.grn_id = p_grn_id and gl.property_id = p_property_id
     order by gl.created_at, gl.id
  loop
    v_index := v_index + 1;

    select e.value into v_line
      from jsonb_array_elements(p_lines) e
     where (e.value ->> 'grn_line_id')::uuid = v_orig_line.id
     limit 1;

    -- Untouched lines are carried forward exactly. `v_line` is null for them, and every
    -- coalesce below falls through to the original figure.
    if v_line is null then v_line := '{}'::jsonb; end if;

    select * into v_item from public.item where id = v_orig_line.item_id;

    v_physical := coalesce((v_line ->> 'qty_physical')::numeric, v_orig_line.qty_physical);
    v_accepted := coalesce((v_line ->> 'qty_accepted')::numeric, v_orig_line.qty_accepted);
    v_rejected := coalesce((v_line ->> 'qty_rejected')::numeric, v_orig_line.qty_rejected);
    v_decision := coalesce((v_line ->> 'decision')::public.grn_line_decision, v_orig_line.decision);
    v_reason   := coalesce((v_line ->> 'reject_reason')::public.reject_reason, v_orig_line.reject_reason);

    if v_physical is null or v_physical <= 0 then
      raise exception 'Line % (%): a corrected count is still a count.', v_index, v_item.name
        using errcode = '23514';
    end if;

    if v_accepted < 0 or v_rejected < 0 then
      raise exception 'Line % (%): a quantity cannot be negative.', v_index, v_item.name
        using errcode = '23514';
    end if;

    if v_accepted + v_rejected <> v_physical then
      raise exception 'Line % (%): accepted plus rejected is %, but % is the corrected count.',
        v_index, v_item.name,
        trim(to_char(v_accepted + v_rejected, 'FM999999990.####')),
        trim(to_char(v_physical, 'FM999999990.####'))
        using errcode = '23514';
    end if;

    if v_decision <> 'ACCEPT' and v_reason is null then
      raise exception 'Line % (%): say why any of it was turned away.', v_index, v_item.name
        using errcode = '23514';
    end if;

    insert into public.grn_line (
      property_id, grn_id, item_id, batch_id,
      qty_challan, qty_physical, qty_accepted, qty_rejected,
      uom_id, decision, reject_reason
    )
    values (
      p_property_id, v_new_id, v_orig_line.item_id, v_orig_line.batch_id,
      v_orig_line.qty_challan, v_physical, v_accepted, v_rejected,
      v_orig_line.uom_id, v_decision, v_reason
    );

    -- ---------------------------------------------------------------------------
    -- The stock, which is the half that can refuse
    -- ---------------------------------------------------------------------------

    v_delta := v_accepted - v_orig_line.qty_accepted;

    if v_delta <> 0 then
      v_adjusted := v_adjusted + 1;

      -- Where the original posting actually put it, read off the ledger rather than
      -- looked up by kind. A property that has since renamed or retired its receiving bay
      -- must still be able to correct a receipt made into the old one.
      select m.to_location_id into v_where
        from public.stock_movement m
       where m.batch_id = v_orig_line.batch_id
         and m.reason = 'GRN_POSTING' and m.to_state = 'QUARANTINE'
       order by m.occurred_at limit 1;

      if v_where is null then
        select id into v_where from public.location
         where property_id = p_property_id and kind = 'RECEIVING' and is_active
         order by code limit 1;
      end if;

      if v_delta < 0 then
        select qty into v_held from public.stock_lot
         where batch_id = v_orig_line.batch_id and location_id = v_where and state = 'QUARANTINE';

        -- The refusal that matters. Correcting the paperwork while leaving the stock
        -- wrong would produce a register that disagrees with the shelf, and a register
        -- that disagrees with the shelf is worse than one that says it cannot help.
        if coalesce(v_held, 0) < -v_delta then
          raise exception
            'Line % (%): % of the original % has already been put away or issued, so only % can still be taken back. Correct the rest with a write-off against the batch, which records who decided it.',
            v_index, v_item.name,
            trim(to_char(v_orig_line.qty_accepted - coalesce(v_held, 0), 'FM999999990.####')),
            trim(to_char(v_orig_line.qty_accepted, 'FM999999990.####')),
            trim(to_char(coalesce(v_held, 0), 'FM999999990.####'))
            using errcode = '23514';
        end if;

        perform app.move_stock(
          p_property_id, v_orig_line.batch_id, v_orig_line.item_id,
          v_where, 'QUARANTINE', null, null,
          -v_delta, v_orig_line.uom_id, 'CORRECTION',
          p_idempotency_key || ':acc:' || v_index,
          'Corrected by ' || v_new_no || ': ' || trim(p_reason)
        );
      else
        perform app.move_stock(
          p_property_id, v_orig_line.batch_id, v_orig_line.item_id,
          null, null, v_where, 'QUARANTINE',
          v_delta, v_orig_line.uom_id, 'CORRECTION',
          p_idempotency_key || ':acc:' || v_index,
          'Corrected by ' || v_new_no || ': ' || trim(p_reason)
        );
      end if;
    end if;

    v_delta := v_rejected - v_orig_line.qty_rejected;

    if v_delta <> 0 then
      if v_accepted - v_orig_line.qty_accepted = 0 then v_adjusted := v_adjusted + 1; end if;

      select m.to_location_id into v_where
        from public.stock_movement m
       where m.batch_id = v_orig_line.batch_id
         and m.reason = 'GRN_POSTING' and m.to_state = 'REJECT_HOLD'
       order by m.occurred_at limit 1;

      if v_where is null then
        select id into v_where from public.location
         where property_id = p_property_id and kind = 'REJECT' and is_active
         order by code limit 1;
      end if;

      if v_delta < 0 then
        select qty into v_held from public.stock_lot
         where batch_id = v_orig_line.batch_id and location_id = v_where and state = 'REJECT_HOLD';

        if coalesce(v_held, 0) < -v_delta then
          raise exception
            'Line % (%): only % of the rejected stock is still in the cage. The rest has already left on a gate pass and cannot be un-rejected.',
            v_index, v_item.name,
            trim(to_char(coalesce(v_held, 0), 'FM999999990.####'))
            using errcode = '23514';
        end if;

        perform app.move_stock(
          p_property_id, v_orig_line.batch_id, v_orig_line.item_id,
          v_where, 'REJECT_HOLD', null, null,
          -v_delta, v_orig_line.uom_id, 'CORRECTION',
          p_idempotency_key || ':rej:' || v_index,
          'Corrected by ' || v_new_no || ': ' || trim(p_reason)
        );
      else
        perform app.move_stock(
          p_property_id, v_orig_line.batch_id, v_orig_line.item_id,
          null, null, v_where, 'REJECT_HOLD',
          v_delta, v_orig_line.uom_id, 'CORRECTION',
          p_idempotency_key || ':rej:' || v_index,
          'Corrected by ' || v_new_no || ': ' || trim(p_reason)
        );
      end if;
    end if;
  end loop;

  return query select v_new_id, v_new_no, v_adjusted;
end;
$$;

revoke all on function public.amend_grn(uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function public.amend_grn(uuid, uuid, text, text, jsonb) to authenticated;

comment on function public.amend_grn(uuid, uuid, text, text, jsonb) is
  'Corrects a posted receipt by superseding it. The original is never touched; the stock difference is a compensating CORRECTION movement, and the amendment is refused where the stock has already moved beyond where the receipt put it.';

-- ---------------------------------------------------------------------------
-- A receipt, with what became of it
-- ---------------------------------------------------------------------------

create or replace function public.list_receipts(
  p_property_id uuid,
  p_from        date default null,
  p_to          date default null
)
returns table (
  grn_id          uuid,
  grn_no          text,
  posted_at       timestamptz,
  posted_by_name  text,
  gate_entry_no   text,
  vendor_name     text,
  line_count      integer,
  total_accepted  numeric,
  total_rejected  numeric,
  -- The trail, both ways. A receipt that superseded another and a receipt that has been
  -- superseded are different things, and a list that showed only one of them would be
  -- describing a chain by its links.
  amends_grn_no   text,
  amendment_reason text,
  superseded_by_grn_no text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    g.id, g.grn_no, g.posted_at,
    (select m.recorded_by_name from public.stock_movement m
       join public.grn_line l on l.batch_id = m.batch_id
      where l.grn_id = g.id order by m.occurred_at limit 1),
    ge.gate_entry_no,
    coalesce(p.name, ge.unregistered_vendor_name),
    count(gl.id)::int,
    coalesce(sum(gl.qty_accepted), 0),
    coalesce(sum(gl.qty_rejected), 0),
    prev.grn_no, g.amendment_reason, next.grn_no
  from public.grn g
  left join public.grn_line   gl on gl.grn_id = g.id
  left join public.gate_entry ge on ge.id = g.gate_entry_id
  left join public.party      p  on p.id = g.party_id and p.property_id = g.property_id
  left join public.grn        prev on prev.id = g.amendment_of
  left join public.grn        next on next.amendment_of = g.id
  where g.property_id = p_property_id
    and (p_from is null or g.posted_at >= p_from)
    and (p_to is null or g.posted_at < (p_to + 1))
  group by g.id, g.grn_no, g.posted_at, ge.gate_entry_no, p.name,
           ge.unregistered_vendor_name, prev.grn_no, g.amendment_reason, next.grn_no
  order by g.posted_at desc, g.grn_no desc;
$$;

revoke all on function public.list_receipts(uuid, date, date) from public, anon;
grant execute on function public.list_receipts(uuid, date, date) to authenticated;

comment on function public.list_receipts(uuid, date, date) is
  'Posted receipts with both ends of the amendment chain — what a receipt corrected, and what corrected it. Superseded receipts are listed rather than hidden: the trail is the point.';

/**
 * The lines of one receipt, for the screen that amends it.
 *
 * Carries how much of each line is still where the receipt put it, because that is what
 * decides whether a correction can be made at all — and telling somebody after they have
 * typed the corrected figures is telling them too late.
 */
create or replace function public.list_receipt_lines(p_property_id uuid, p_grn_id uuid)
returns table (
  line_id        uuid,
  item_id        uuid,
  item_code      text,
  item_name      text,
  batch_id       uuid,
  batch_no       text,
  uom_code       text,
  qty_challan    numeric,
  qty_physical   numeric,
  qty_accepted   numeric,
  qty_rejected   numeric,
  decision       public.grn_line_decision,
  reject_reason  public.reject_reason,
  /** Still in quarantine where the receipt put it, so still correctable downwards. */
  still_quarantined numeric,
  still_rejected    numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    gl.id, i.id, i.code, i.name, b.id, b.batch_no, u.code,
    gl.qty_challan, gl.qty_physical, gl.qty_accepted, gl.qty_rejected,
    gl.decision, gl.reject_reason,
    -- Summed across locations rather than taking the largest lot. A batch split between
    -- two receiving bays is one quantity still correctable, and picking the bigger half
    -- would understate it — which on this screen reads as "you cannot fix that" when you
    -- can.
    coalesce((select sum(sl.qty) from public.stock_lot sl
               where sl.batch_id = gl.batch_id and sl.state = 'QUARANTINE'), 0),
    coalesce((select sum(sl.qty) from public.stock_lot sl
               where sl.batch_id = gl.batch_id and sl.state = 'REJECT_HOLD'), 0)
  from public.grn_line gl
  join public.item i on i.id = gl.item_id
  join public.uom  u on u.id = gl.uom_id
  left join public.batch b on b.id = gl.batch_id
  where gl.property_id = p_property_id and gl.grn_id = p_grn_id
  order by i.name;
$$;

revoke all on function public.list_receipt_lines(uuid, uuid) from public, anon;
grant execute on function public.list_receipt_lines(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The inward register learns about amendments
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated because the return type changes, which CREATE OR REPLACE cannot
-- do.
--
-- Both the original and its amendment are listed, the original marked superseded. Hiding
-- it would make the register tidier and would destroy the trail — an inspector's question
-- is not "what does the receipt say now" but "was it changed, by whom, and why".

drop function public.list_inward_register(uuid, date, date);

create or replace function public.list_inward_register(
  p_property_id uuid,
  p_from        date default null,
  p_to          date default null
)
returns table (
  received_at    timestamptz,
  grn_no         text,
  gate_entry_no  text,
  vendor_name    text,
  vendor_fssai   text,
  item_code      text,
  item_name      text,
  batch_no       text,
  batch_is_generated boolean,
  qty_challan    numeric,
  qty_physical   numeric,
  qty_accepted   numeric,
  qty_rejected   numeric,
  uom_code       text,
  best_before    date,
  receipt_temp_c numeric,
  temp_min_c     numeric,
  temp_max_c     numeric,
  temp_in_range  boolean,
  decision       public.grn_line_decision,
  reject_reason  public.reject_reason,
  received_by    text,
  batch_id       uuid,
  -- The amendment trail, on the register itself.
  amends_grn_no  text,
  amendment_reason text,
  superseded_by_grn_no text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    g.posted_at,
    g.grn_no,
    ge.gate_entry_no,
    coalesce(p.name, ge.unregistered_vendor_name),
    p.fssai_licence,
    i.code, i.name,
    b.batch_no, b.is_system_generated,
    gl.qty_challan, gl.qty_physical, gl.qty_accepted, gl.qty_rejected,
    u.code,
    b.best_before,
    b.receipt_temp_c, i.temp_min_c, i.temp_max_c,
    case
      when b.receipt_temp_c is null or i.temp_min_c is null or i.temp_max_c is null then null
      else b.receipt_temp_c between i.temp_min_c and i.temp_max_c
    end,
    gl.decision, gl.reject_reason,
    coalesce(
      (select m.recorded_by_name from public.stock_movement m
        where m.batch_id = b.id and m.reason = 'GRN_POSTING'
        order by m.occurred_at limit 1),
      ''
    ),
    b.id,
    prev.grn_no, g.amendment_reason, next.grn_no
  from public.grn_line gl
  join public.grn      g  on g.id = gl.grn_id
  join public.item     i  on i.id = gl.item_id
  join public.uom      u  on u.id = gl.uom_id
  left join public.batch      b  on b.id = gl.batch_id
  left join public.gate_entry ge on ge.id = g.gate_entry_id
  left join public.party      p  on p.id = g.party_id and p.property_id = g.property_id
  left join public.grn        prev on prev.id = g.amendment_of
  left join public.grn        next on next.amendment_of = g.id
  where gl.property_id = p_property_id
    and (p_from is null or g.posted_at >= p_from)
    and (p_to is null or g.posted_at < (p_to + 1))
  order by g.posted_at desc, g.grn_no desc, i.name;
$$;

revoke all on function public.list_inward_register(uuid, date, date) from public, anon;
grant execute on function public.list_inward_register(uuid, date, date) to authenticated;

comment on function public.list_inward_register(uuid, date, date) is
  'PRD section 7.2 — inward material check, receipt temperature record and non-conforming material. Superseded receipts are listed and marked rather than hidden: an inspector''s question is not what the receipt says now but whether it was changed, by whom and why.';
