-- Gates 9 and 10 — Terminal 2 staging, and the gate pass out.
--
-- Until now nothing could lawfully leave. Rejected stock reached REJECT_HOLD and stayed
-- there, which made the reject decision a dead end rather than a decision: a storekeeper
-- with fifty kilos of bad fish and no way to send it back does not leave it in the cage,
-- they walk it out of a side door, and every control upstream becomes decoration.
--
-- Hard rule 15: nothing leaves the property without a gate pass, and there is no
-- exception path in the UI. These two functions are that rule made available rather than
-- merely asserted.

-- ---------------------------------------------------------------------------
-- A dispatch has lines
-- ---------------------------------------------------------------------------
--
-- dispatch_note carries batch_id, item_id, qty and uom_id on the header, which makes it a
-- document with exactly one line. One rejected line per delivery is the easy case and not
-- the usual one — a vendor drops six crates and two are bad.
--
-- Expand, not replace (CLAUDE.md conventions). The header columns stay, nullable and
-- unused by anything written from here on, because an offline device running last week's
-- build may still write them. They can be contracted away a release later.

create table public.dispatch_line (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid not null references public.property (id) on delete cascade,
  dispatch_note_id uuid not null references public.dispatch_note (id) on delete cascade,
  batch_id         uuid not null,
  item_id          uuid not null,
  from_location_id uuid not null,
  from_state       public.stock_state not null,
  qty              numeric(14, 4) not null check (qty > 0),
  uom_id           uuid not null,
  created_at       timestamptz not null default now(),

  constraint dispatch_line_batch_fk
    foreign key (property_id, batch_id) references public.batch (property_id, id)
    on delete restrict,
  constraint dispatch_line_item_fk
    foreign key (property_id, item_id) references public.item (property_id, id)
    on delete restrict,
  constraint dispatch_line_from_fk
    foreign key (property_id, from_location_id) references public.location (property_id, id)
    on delete restrict,
  constraint dispatch_line_uom_fk
    foreign key (property_id, uom_id) references public.uom (property_id, id)
    on delete restrict,
  -- Where the goods came from, recorded because a supplier return and a linen collection
  -- have to be told apart afterwards and the state is the only thing that says which.
  constraint dispatch_line_state_is_dispatchable
    check (from_state in ('REJECT_HOLD', 'AVAILABLE', 'ISSUED'))
);

create index dispatch_line_property_id_idx on public.dispatch_line (property_id);
create index dispatch_line_note_id_idx on public.dispatch_line (dispatch_note_id);

alter table public.dispatch_note
  add column idempotency_key text,
  add column staged_by_name text;

create unique index dispatch_note_idempotency_unique
  on public.dispatch_note (property_id, idempotency_key)
  where idempotency_key is not null;

alter table public.gate_pass
  add column idempotency_key text,
  add column verified_by_name text,
  add constraint gate_pass_property_id_id_unique unique (property_id, id);

create unique index gate_pass_idempotency_unique
  on public.gate_pass (property_id, idempotency_key)
  where idempotency_key is not null;

-- The dangling reference, same shape as the three the party master fixed.
alter table public.gate_pass
  add constraint gate_pass_dispatch_fk
    foreign key (property_id, dispatch_note_id) references public.dispatch_note (property_id, id)
    on delete restrict not valid;
alter table public.gate_pass validate constraint gate_pass_dispatch_fk;

alter table public.dispatch_line enable row level security;
alter table public.dispatch_line force row level security;

create policy dispatch_line_select on public.dispatch_line
  for select to authenticated using (property_id in (select app.accessible_properties()));

grant select on public.dispatch_line to authenticated;
grant all on public.dispatch_line to service_role;

-- ---------------------------------------------------------------------------
-- What can leave
-- ---------------------------------------------------------------------------

create or replace function public.list_dispatchable_stock(p_property_id uuid)
returns table (
  batch_id      uuid,
  batch_no      text,
  item_id       uuid,
  item_name     text,
  item_code     text,
  uom_id        uuid,
  uom_code      text,
  location_id   uuid,
  location_code text,
  location_name text,
  state         public.stock_state,
  qty           numeric,
  best_before   date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    b.id, b.batch_no,
    i.id, i.name, i.code,
    u.id, u.code,
    l.id, l.code, l.name,
    sl.state, sl.qty, b.best_before
  from public.stock_lot sl
  join public.batch    b on b.id = sl.batch_id
  join public.item     i on i.id = b.item_id
  join public.uom      u on u.id = i.base_uom_id
  join public.location l on l.id = sl.location_id
  where sl.property_id = p_property_id
    and sl.qty > 0
    and sl.state in ('REJECT_HOLD', 'AVAILABLE', 'ISSUED')
  -- Rejected first. It is the stock with a clock on it: the vendor is owed an answer, and
  -- a reject cage nobody empties is how the reject decision quietly stops being made.
  order by (sl.state <> 'REJECT_HOLD'), b.best_before asc nulls last, i.name;
$$;

revoke all on function public.list_dispatchable_stock(uuid) from public, anon;
grant execute on function public.list_dispatchable_stock(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Gate 9 — staging at Terminal 2
-- ---------------------------------------------------------------------------

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

  return query select v_id, v_no;
end;
$$;

revoke all on function public.stage_for_dispatch(
  uuid, public.dispatch_type, uuid, text, boolean, date, text, jsonb
) from public, anon;
grant execute on function public.stage_for_dispatch(
  uuid, public.dispatch_type, uuid, text, boolean, date, text, jsonb
) to authenticated;

comment on function public.stage_for_dispatch(
  uuid, public.dispatch_type, uuid, text, boolean, date, text, jsonb
) is
  'Gate 9. Moves stock to STAGED_OUT at Terminal 2 against a numbered dispatch note. STAGED_OUT is on the property and still counted — the departure is Gate 10.';

-- ---------------------------------------------------------------------------
-- What is waiting to leave
-- ---------------------------------------------------------------------------

create or replace function public.list_awaiting_gate_pass(p_property_id uuid)
returns table (
  dispatch_id     uuid,
  dispatch_no     text,
  dispatch_type   public.dispatch_type,
  recipient_name  text,
  is_returnable   boolean,
  expected_return_date date,
  staged_by_name  text,
  staged_by       uuid,
  staged_at       timestamptz,
  line_count      integer,
  total_qty       numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    d.id, d.dispatch_no, d.dispatch_type,
    p.name, d.is_returnable, d.expected_return_date,
    d.staged_by_name, d.authorised_by, d.created_at,
    count(dl.id)::int, coalesce(sum(dl.qty), 0)
  from public.dispatch_note d
  left join public.party p
    on p.id = d.recipient_party_id and p.property_id = d.property_id
  left join public.dispatch_line dl on dl.dispatch_note_id = d.id
  where d.property_id = p_property_id
    and not exists (select 1 from public.gate_pass g where g.dispatch_note_id = d.id)
  group by d.id, d.dispatch_no, d.dispatch_type, p.name, d.is_returnable,
           d.expected_return_date, d.staged_by_name, d.authorised_by, d.created_at
  order by d.created_at;
$$;

revoke all on function public.list_awaiting_gate_pass(uuid) from public, anon;
grant execute on function public.list_awaiting_gate_pass(uuid) to authenticated;

comment on function public.list_awaiting_gate_pass(uuid) is
  'Dispatch notes with no gate pass. Goods staged at Terminal 2 and still on the property — the outbound half of the reconciliation control.';

-- ---------------------------------------------------------------------------
-- Gate 10 — Security passes it out
-- ---------------------------------------------------------------------------

create or replace function public.issue_gate_pass(
  p_property_id     uuid,
  p_dispatch_note_id uuid,
  -- Required, unlike the vehicle. Material changes hands here, and the uniform rule is
  -- that no custody transfer anywhere on the property is anonymous (PRD section 4 Gate 8).
  -- A vehicle number is a detail; a name is the record.
  p_carrier         text,
  p_vehicle_number  text,
  p_package_count   integer,
  p_idempotency_key text
)
returns table (gate_pass_id uuid, gate_pass_no text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_id uuid;
  v_existing_no text;
  v_pass_id     uuid;
  v_pass_no     text;
  v_note        public.dispatch_note%rowtype;
  v_recorder    text;
  v_line        record;
  v_index       integer := 0;
begin
  -- Security and the GM, plus the administrators a small property runs on. NOT the
  -- storekeeper, and that omission is the control rather than an oversight — see the
  -- segregation check below, which is the same idea enforced against the individual.
  if not app.has_property_role(
       p_property_id,
       array['OWNER', 'ADMIN', 'SECURITY', 'GM']::public.membership_role[]
     ) then
    raise exception 'Passing goods out of the gate is Security''s job. You do not have that role here.'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'A gate pass needs a submission key, so a retry cannot issue two.'
      using errcode = '23514';
  end if;

  if p_carrier is null or length(trim(p_carrier)) = 0 then
    raise exception 'Say who is carrying it out. Nothing leaves in nobody''s hands.'
      using errcode = '23514';
  end if;

  select g.id, g.gate_pass_no into v_existing_id, v_existing_no
    from public.gate_pass g
   where g.property_id = p_property_id and g.idempotency_key = p_idempotency_key;

  if v_existing_id is not null then
    return query select v_existing_id, v_existing_no;
    return;
  end if;

  select * into v_note from public.dispatch_note
   where id = p_dispatch_note_id and property_id = p_property_id;

  if not found then
    raise exception 'That dispatch note does not belong to this property.' using errcode = '42501';
  end if;

  perform 1 from public.gate_pass where dispatch_note_id = p_dispatch_note_id;
  if found then
    raise exception 'A gate pass has already been issued for %. It cannot leave twice.',
      v_note.dispatch_no
      using errcode = '23505';
  end if;

  -- PRD section 11: the person who stages at Terminal 2 is not the person who verifies at
  -- Security. Enforced against the individual rather than by withholding a capability,
  -- because a small property doubles people up and the same person can legitimately hold
  -- both roles — what they cannot do is be both ends of one consignment.
  --
  -- This blocks rather than warns. A gate pass verified by whoever staged it is not a
  -- weaker control, it is the absence of the control, and the whole reason the gate is
  -- separate from the dispatch note.
  if v_note.authorised_by is not null and v_note.authorised_by = (select auth.uid()) then
    raise exception 'You staged %. Someone else has to verify it out — that separation is the check.',
      v_note.dispatch_no
      using errcode = '42501';
  end if;

  perform 1 from public.dispatch_line where dispatch_note_id = p_dispatch_note_id;
  if not found then
    raise exception '% has no lines. There is nothing to pass out.', v_note.dispatch_no
      using errcode = '23514';
  end if;

  select coalesce(nullif(trim(raw_user_meta_data ->> 'full_name'), ''), email)
    into v_recorder
    from auth.users where id = (select auth.uid());

  v_pass_no := app.next_document_number(p_property_id, 'GATE_PASS');

  insert into public.gate_pass (
    property_id, gate_pass_no, dispatch_note_id, carrier, vehicle_number,
    package_count, verified_by, verified_by_name, idempotency_key
  )
  values (
    p_property_id, v_pass_no, p_dispatch_note_id,
    trim(p_carrier), nullif(trim(coalesce(p_vehicle_number, '')), ''),
    p_package_count, (select auth.uid()), v_recorder, p_idempotency_key
  )
  returning id into v_pass_id;

  -- Off the property. from_state STAGED_OUT with no destination: the ledger records that
  -- it left rather than pretending it moved somewhere, and stock_movement_has_an_end is
  -- satisfied because a movement out of somewhere is still a movement.
  for v_line in
    select * from public.dispatch_line
     where dispatch_note_id = p_dispatch_note_id order by created_at, id
  loop
    v_index := v_index + 1;
    perform app.move_stock(
      p_property_id, v_line.batch_id, v_line.item_id,
      v_note.origin_location_id, 'STAGED_OUT', null, null,
      v_line.qty, v_line.uom_id, 'GATE_OUT',
      p_idempotency_key || ':out:' || v_index,
      'Left the property on ' || v_pass_no
    );
  end loop;

  -- The carrier took custody, so the same acknowledgement the issue gate writes is
  -- written here (PRD section 4 Gate 8: scan-to-receive applies wherever material changes
  -- hands). verified_by_scan is false for the same reason it is false at Gate 8 — a typed
  -- name is an assertion by whoever is standing at the gate, not proof of who the driver
  -- is. Criterion 17 is unmet at both gates, consistently and visibly.
  insert into public.receipt_ack
    (property_id, dispatch_note_id, receiver_name, verified_by_scan, recorded_by, recorded_by_name)
  values
    (p_property_id, p_dispatch_note_id, trim(p_carrier), false, (select auth.uid()), v_recorder);

  return query select v_pass_id, v_pass_no;
end;
$$;

revoke all on function public.issue_gate_pass(uuid, uuid, text, text, integer, text)
  from public, anon;
grant execute on function public.issue_gate_pass(uuid, uuid, text, text, integer, text)
  to authenticated;

comment on function public.issue_gate_pass(uuid, uuid, text, text, integer, text) is
  'Gate 10. Issues the gate pass number and takes the staged stock off the property. Refuses a pass verified by whoever staged it — PRD section 11 segregation, enforced against the individual rather than the role.';
