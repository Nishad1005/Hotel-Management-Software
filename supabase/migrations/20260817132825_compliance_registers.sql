-- The FSSAI registers, as queries.
--
-- PRD section 7.1 is the whole product argument: the compliance module is not a checklist
-- app sitting beside the flow, it runs on data the flow already holds. The cold room that
-- must be temperature-logged IS a location; the batch traced in a recall IS created at
-- Gate 3; the waste consignment an inspector asks about IS a Gate 9 dispatch record.
--
-- So there are no new tables here, and that is the point. Every register below is a
-- SELECT over records captured for an operational reason by somebody who was not thinking
-- about compliance at the time — which is exactly why they are worth trusting. A register
-- filled in for the inspector is filled in the night before; this one cannot be.
--
-- Three of the four `[P1]` auto-populated registers in section 7.2 are one dataset:
-- inward material check, receipt temperature record and non-conforming material differ
-- only in which rows you look at. Splitting them into three functions would mean three
-- places to fix the day a column is added.

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
  -- The two columns that make this the receipt temperature record as well.
  receipt_temp_c numeric,
  temp_min_c     numeric,
  temp_max_c     numeric,
  temp_in_range  boolean,
  decision       public.grn_line_decision,
  reject_reason  public.reject_reason,
  received_by    text,
  batch_id       uuid
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
    -- The vendor as recorded, registered or not. An unregistered supplier is a real
    -- answer to "who did this come from" and blanking it would make the register look
    -- complete while hiding the one row an inspector would ask about.
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
    -- Snapshotted at receipt, so deleting the user does not empty the register three
    -- years later. auth.users is not readable from here in any case.
    coalesce(
      (select m.recorded_by_name from public.stock_movement m
        where m.batch_id = b.id and m.reason = 'GRN_POSTING'
        order by m.occurred_at limit 1),
      ''
    ),
    b.id
  from public.grn_line gl
  join public.grn      g  on g.id = gl.grn_id
  join public.item     i  on i.id = gl.item_id
  join public.uom      u  on u.id = gl.uom_id
  left join public.batch      b  on b.id = gl.batch_id
  left join public.gate_entry ge on ge.id = g.gate_entry_id
  left join public.party      p  on p.id = g.party_id and p.property_id = g.property_id
  where gl.property_id = p_property_id
    and (p_from is null or g.posted_at >= p_from)
    -- Inclusive of the closing day. A range typed as "1st to 31st" that silently excludes
    -- the 31st is the kind of off-by-one an auditor finds and nobody else does.
    and (p_to is null or g.posted_at < (p_to + 1))
  order by g.posted_at desc, g.grn_no desc, i.name;
$$;

revoke all on function public.list_inward_register(uuid, date, date) from public, anon;
grant execute on function public.list_inward_register(uuid, date, date) to authenticated;

comment on function public.list_inward_register(uuid, date, date) is
  'PRD section 7.2 — inward material check, receipt temperature record and non-conforming material. One dataset: they differ only in which rows you look at. No extra entry anywhere; every column was captured for an operational reason.';

-- ---------------------------------------------------------------------------
-- The waste disposal register
-- ---------------------------------------------------------------------------
--
-- A filtered view of dispatch, not a separate log (PRD section 7.2). Used cooking oil
-- already leaves through Terminal 2, so recording it twice would be the exact thing this
-- product exists to stop — and a UCO log kept beside the flow is one that disagrees with
-- it by the end of the first month.

create or replace function public.list_waste_register(
  p_property_id uuid,
  p_from        date default null,
  p_to          date default null
)
returns table (
  dispatched_at   timestamptz,
  dispatch_no     text,
  dispatch_type   public.dispatch_type,
  reason_code     text,
  recipient_name  text,
  recipient_fssai text,
  item_code       text,
  item_name       text,
  batch_no        text,
  qty             numeric,
  uom_code        text,
  -- Null until Security passes it out. A consignment staged and not yet gone is exactly
  -- the row a register should show as open rather than omit.
  gate_pass_no    text,
  left_at         timestamptz,
  carrier         text,
  vehicle_number  text,
  staged_by_name  text,
  verified_by_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    d.created_at, d.dispatch_no, d.dispatch_type, d.reason_code,
    p.name, p.fssai_licence,
    i.code, i.name, b.batch_no,
    dl.qty, u.code,
    gp.gate_pass_no, gp.timestamp_out, gp.carrier, gp.vehicle_number,
    d.staged_by_name, gp.verified_by_name
  from public.dispatch_line dl
  join public.dispatch_note d on d.id = dl.dispatch_note_id
  join public.item          i on i.id = dl.item_id
  join public.batch         b on b.id = dl.batch_id
  join public.uom           u on u.id = dl.uom_id
  left join public.party     p  on p.id = d.recipient_party_id and p.property_id = d.property_id
  left join public.gate_pass gp on gp.dispatch_note_id = d.id
  where dl.property_id = p_property_id
    -- Everything a food safety inspector counts as disposal. Supplier returns and linen
    -- are dispatches too, and deliberately absent: they are not waste.
    and d.dispatch_type in ('FOOD_WASTE', 'USED_COOKING_OIL', 'CONDEMNED', 'SCRAP')
    and (p_from is null or d.created_at >= p_from)
    and (p_to is null or d.created_at < (p_to + 1))
  order by d.created_at desc, d.dispatch_no desc;
$$;

revoke all on function public.list_waste_register(uuid, date, date) from public, anon;
grant execute on function public.list_waste_register(uuid, date, date) to authenticated;

comment on function public.list_waste_register(uuid, date, date) is
  'PRD section 7.2 — waste disposal and used cooking oil. A filtered view of dispatch rather than a separate log, because UCO already leaves through Terminal 2 and a second log would disagree with the first by the end of the month.';

-- ---------------------------------------------------------------------------
-- Traceability
-- ---------------------------------------------------------------------------
--
-- PRD section 7.5, and both directions are `[P1]`. This is the forward one: this batch
-- came through gate entry X from this vendor, was checked by this person, sits in these
-- bins, went to these departments, and its waste left on this gate pass.
--
-- Built from the ledger rather than from a purpose-made audit table, because the ledger is
-- append-only and already carries every movement. An audit trail assembled separately is
-- one that can disagree with the stock it describes, and the disagreement surfaces during
-- a recall — which is the one moment it must not.

create or replace function public.trace_batch(p_property_id uuid, p_batch_id uuid)
returns table (
  occurred_at    timestamptz,
  reason         public.movement_reason,
  qty            numeric,
  uom_code       text,
  from_code      text,
  from_name      text,
  from_state     public.stock_state,
  to_code        text,
  to_name        text,
  to_state       public.stock_state,
  scan_method    public.scan_method,
  recorded_by_name text,
  note           text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.occurred_at, m.reason, m.qty, u.code,
    fl.code, fl.name, m.from_state,
    tl.code, tl.name, m.to_state,
    m.scan_method, m.recorded_by_name, m.note
  from public.stock_movement m
  join public.uom u on u.id = m.uom_id
  left join public.location fl on fl.id = m.from_location_id
  left join public.location tl on tl.id = m.to_location_id
  where m.property_id = p_property_id and m.batch_id = p_batch_id
  -- Oldest first. A trace is read as a story, and a recall reads it forwards.
  order by m.occurred_at, m.id;
$$;

revoke all on function public.trace_batch(uuid, uuid) from public, anon;
grant execute on function public.trace_batch(uuid, uuid) to authenticated;

comment on function public.trace_batch(uuid, uuid) is
  'PRD section 7.5 forward trace, read off the append-only ledger. Not a separate audit table: one assembled beside the stock can disagree with it, and the disagreement surfaces during a recall.';

/**
 * Where a batch came from.
 *
 * The header a trace hangs under, and the half a recall actually starts from — an
 * inspector naming a vendor and a date needs the batches, not the movements.
 */
create or replace function public.batch_provenance(p_property_id uuid, p_batch_id uuid)
returns table (
  batch_no       text,
  is_system_generated boolean,
  item_code      text,
  item_name      text,
  category_name  text,
  uom_code       text,
  best_before    date,
  mfg_date       date,
  receipt_temp_c numeric,
  pct_at_receipt numeric,
  dwell_breach   boolean,
  source         public.batch_source,
  received_at    timestamptz,
  grn_no         text,
  gate_entry_no  text,
  arrived_at     timestamptz,
  vendor_name    text,
  vendor_code    text,
  vendor_fssai   text,
  decision       public.grn_line_decision,
  reject_reason  public.reject_reason,
  qty_accepted   numeric,
  qty_rejected   numeric,
  received_by    text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    b.batch_no, b.is_system_generated,
    i.code, i.name, c.name, u.code,
    b.best_before, b.mfg_date, b.receipt_temp_c, b.pct_at_receipt, b.dwell_breach, b.source,
    g.posted_at, g.grn_no, ge.gate_entry_no, ge.timestamp_in,
    coalesce(p.name, ge.unregistered_vendor_name), p.code, p.fssai_licence,
    gl.decision, gl.reject_reason, gl.qty_accepted, gl.qty_rejected,
    (select m.recorded_by_name from public.stock_movement m
      where m.batch_id = b.id order by m.occurred_at limit 1)
  from public.batch b
  join public.item          i on i.id = b.item_id
  join public.item_category c on c.id = i.category_id
  join public.uom           u on u.id = i.base_uom_id
  -- Left, because opening stock has no receipt. A batch recorded as an opening balance is
  -- still a batch and still traceable forward; what it lacks is a vendor, and saying so
  -- is more honest than omitting the row.
  left join public.grn_line   gl on gl.batch_id = b.id
  left join public.grn        g  on g.id = gl.grn_id
  left join public.gate_entry ge on ge.id = g.gate_entry_id
  left join public.party      p  on p.id = g.party_id and p.property_id = g.property_id
  where b.property_id = p_property_id and b.id = p_batch_id
  order by g.posted_at
  limit 1;
$$;

revoke all on function public.batch_provenance(uuid, uuid) from public, anon;
grant execute on function public.batch_provenance(uuid, uuid) to authenticated;

comment on function public.batch_provenance(uuid, uuid) is
  'Where a batch came from — the header a forward trace hangs under. Opening-stock batches are returned with a null vendor rather than omitted: they are still traceable forward, and saying they have no receipt is more honest than leaving them out.';
