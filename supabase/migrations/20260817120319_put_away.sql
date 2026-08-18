-- Gate 6 — put-away. QUARANTINE at Terminal 1 becomes AVAILABLE in a bin.
--
-- This is the gate that makes receiving mean something. Until stock is put away it is
-- on the books and not issuable, which is the only honest description of a pallet
-- standing in the receiving bay.
--
-- Two rules here are hard and carry no enforcement mode (PRD section 8):
--
--   * Rejected stock can never reach a zone. Not so much blocked as unreachable — this
--     function moves QUARANTINE and nothing else, so REJECT_HOLD has no path through it
--     at all. The check constraint on stock_movement says the same thing a second time,
--     because an offline client cannot be trusted.
--
--   * Chilled goods cannot go into an ambient bin. Refused with no override, because
--     this one is a food safety failure rather than a paperwork one.
--
-- And one rule that records rather than blocks — see the scan method below.

-- ---------------------------------------------------------------------------
-- How the destination was established
-- ---------------------------------------------------------------------------
--
-- Hard rule 13 says a put-away destination must be SCANNED; typing a code is not
-- permitted. The MVP ships with typing allowed, and this column is how that concession
-- is made honestly rather than silently.
--
-- PRD section 2 — witness before you enforce. A rule the property cannot yet satisfy,
-- enforced anyway, produces a click-through, and the record then carries a false
-- assertion instead of an honest gap. So every put-away records HOW the bin was
-- established, the rule ships RECORD_ONLY, and tightening to BLOCK later is a
-- configuration change rather than a rewrite. Without this column it would be a
-- migration, and the months of put-aways already recorded would be unattributable.
create type public.scan_method as enum (
  'CAMERA',    -- the device camera read the label
  'HARDWARE',  -- a wedge scanner typed it in a burst
  'TYPED'      -- a person typed it, and this is the case the rule exists to count
);

alter table public.stock_movement
  add column scan_method public.scan_method;

comment on column public.stock_movement.scan_method is
  'How the destination was established, where the movement had a scannable one. TYPED is the concession hard rule 13 does not permit; recorded so the gap is countable rather than invisible.';

-- ---------------------------------------------------------------------------
-- move_stock learns one field
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated rather than given an overload: adding a defaulted parameter
-- alongside the existing signature makes every eleven-argument call ambiguous, and
-- Postgres reports that at call time rather than here. The function is internal — `app`
-- is unexposed and EXECUTE is revoked from everyone — so nothing outside these
-- migrations can be holding a reference to it.
--
-- The alternative was for put_away to insert the movement and then update it. It cannot:
-- stock_movement carries a BEFORE UPDATE trigger that raises on any update at all, which
-- is the ledger being append-only and doing its job (ADR 0003).
drop function app.move_stock(
  uuid, uuid, uuid, uuid, public.stock_state, uuid, public.stock_state,
  numeric, uuid, public.movement_reason, text, text
);

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
  p_note             text default null,
  p_scan_method      public.scan_method default null
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
    qty, uom_id, reason, recorded_by, recorded_by_name, idempotency_key, note, scan_method
  )
  values (
    p_property_id, p_batch_id, p_item_id,
    p_from_location_id, p_from_state, p_to_location_id, p_to_state,
    p_qty, p_uom_id, p_reason, (select auth.uid()), v_name, p_idempotency_key, p_note,
    p_scan_method
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function app.move_stock(
  uuid, uuid, uuid, uuid, public.stock_state, uuid, public.stock_state,
  numeric, uuid, public.movement_reason, text, text, public.scan_method
) from public, anon, authenticated;

comment on function app.move_stock(
  uuid, uuid, uuid, uuid, public.stock_state, uuid, public.stock_state,
  numeric, uuid, public.movement_reason, text, text, public.scan_method
) is
  'The only place stock moves. Re-resolves every id against the property, checks sufficiency under a row lock, and appends to the ledger. Internal: the callable RPCs in public all route through it.';

-- ---------------------------------------------------------------------------
-- Rules, and what a missing row means
-- ---------------------------------------------------------------------------
--
-- Absence means RECORD_ONLY. A property provisioned before a rule existed must behave as
-- though the rule ships in its default mode, not as though it is off — reading a missing
-- row as "no rule" is how an enforcement setting quietly stops applying to exactly the
-- oldest tenants.

create or replace function app.enforcement_mode(p_property_id uuid, p_rule_key text)
returns public.enforcement_mode
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select enforcement_mode from public.rule_config
      where property_id = p_property_id and rule_key = p_rule_key and category_id is null),
    'RECORD_ONLY'
  );
$$;

create or replace function app.rule_threshold(
  p_property_id uuid,
  p_rule_key    text,
  p_default     numeric
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select threshold_value from public.rule_config
      where property_id = p_property_id and rule_key = p_rule_key and category_id is null),
    p_default
  );
$$;

revoke all on function app.enforcement_mode(uuid, text) from public, anon, authenticated;
revoke all on function app.rule_threshold(uuid, text, numeric) from public, anon, authenticated;

create or replace function system.seed_property_rules(p_property_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.rule_config
    (property_id, rule_key, enforcement_mode, threshold_value, reason) values
    (p_property_id, 'MIN_SHELF_LIFE_AT_RECEIPT',  'RECORD_ONLY', null,
     'Ships record-only per PRD section 8'),
    (p_property_id, 'EXPIRED_STOCK_CANNOT_ISSUE', 'RECORD_ONLY', null,
     'Ships record-only per PRD section 8'),
    (p_property_id, 'PUT_AWAY_REQUIRES_SCAN',     'RECORD_ONLY', null,
     'Hard rule 13 wants BLOCK. The pilot types bin codes until labels are printed and scanners are on the floor, and every typed put-away is counted meanwhile.'),
    (p_property_id, 'MAX_DWELL_HOURS_AT_T1',      'RECORD_ONLY', 4,
     'Four hours at Terminal 1 before put-away. Recorded permanently against the batch.')
  on conflict (property_id, rule_key, category_id) do nothing;
$$;

revoke all on function system.seed_property_rules(uuid) from public, anon, authenticated;
grant execute on function system.seed_property_rules(uuid) to service_role;

comment on function system.seed_property_rules(uuid) is
  'The rule rows a new property starts with, all RECORD_ONLY. Separate from seed_property_masters so a rule added later can be back-filled onto existing properties without re-running the whole master seed.';

-- Back-filled onto every property that already exists, so the P2 rules dashboard has a
-- row to show rather than an absence to interpret.
select system.seed_property_rules(id) from public.property;

-- And onto every property created afterwards.
--
-- A trigger rather than another line inside seed_property_masters, because rules should
-- follow from a property existing rather than from one code path having been taken.
-- Provisioning already has three entry points — the function, the edge function, and a
-- human in the SQL editor — and the one that forgets is the one that onboards a customer
-- at seven in the evening.
create or replace function app.seed_rules_for_new_property()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform system.seed_property_rules(new.id);
  return new;
end;
$$;

create trigger property_gets_default_rules
  after insert on public.property
  for each row execute function app.seed_rules_for_new_property();

-- ---------------------------------------------------------------------------
-- What is waiting to be put away
-- ---------------------------------------------------------------------------
--
-- Dwell is computed here from the movement that put the stock into quarantine. It is the
-- figure the whole gate exists to shrink, and a device clock has no business producing
-- it.

create or replace function public.list_awaiting_putaway(p_property_id uuid)
returns table (
  batch_id            uuid,
  batch_no            text,
  is_system_generated boolean,
  item_id             uuid,
  item_name           text,
  item_code           text,
  storage_regime      public.storage_regime,
  uom_id              uuid,
  uom_code            text,
  location_id         uuid,
  location_code       text,
  qty                 numeric,
  best_before         date,
  received_at         timestamptz,
  hours_waiting       numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    b.id, b.batch_no, b.is_system_generated,
    i.id, i.name, i.code, i.storage_regime,
    u.id, u.code,
    l.id, l.code,
    sl.qty, b.best_before,
    arrived.first_at,
    round(extract(epoch from (now() - arrived.first_at))::numeric / 3600, 1)
  from public.stock_lot sl
  join public.batch    b on b.id = sl.batch_id
  join public.item     i on i.id = b.item_id
  join public.uom      u on u.id = i.base_uom_id
  join public.location l on l.id = sl.location_id
  -- Lateral rather than a group-by over the whole ledger: one batch's history is a
  -- handful of rows, the ledger is not.
  left join lateral (
    select min(m.occurred_at) as first_at
      from public.stock_movement m
     where m.batch_id = b.id and m.to_state = 'QUARANTINE'
  ) arrived on true
  where sl.property_id = p_property_id
    and sl.state = 'QUARANTINE'
    and sl.qty > 0
  -- Oldest first. FEFO decides what leaves a zone; what enters one is decided by what
  -- has been standing in the receiving bay longest.
  order by arrived.first_at nulls last, i.name;
$$;

revoke all on function public.list_awaiting_putaway(uuid) from public, anon;
grant execute on function public.list_awaiting_putaway(uuid) to authenticated;

comment on function public.list_awaiting_putaway(uuid) is
  'Stock sitting in QUARANTINE with the hours it has been there. The put-away worklist and the dwell figure at the same time.';

-- ---------------------------------------------------------------------------
-- Putting it away
-- ---------------------------------------------------------------------------

create or replace function public.put_away(
  p_property_id      uuid,
  p_batch_id         uuid,
  p_from_location_id uuid,
  p_to_location_code text,
  p_qty              numeric,
  p_scan_method      public.scan_method,
  p_idempotency_key  text
)
returns table (movement_id uuid, to_location_id uuid, to_location_code text, remaining numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item        public.item%rowtype;
  v_dest        public.location%rowtype;
  v_movement    uuid;
  v_remaining   numeric(14, 4);
  v_held        numeric(14, 4);
  v_rejected    numeric(14, 4);
  v_dwell_hours numeric;
  v_dwell_limit numeric;
begin
  if not app.has_property_role(
       p_property_id,
       array['OWNER', 'ADMIN', 'STOREKEEPER']::public.membership_role[]
     ) then
    raise exception 'You do not have permission to put stock away at this property.'
      using errcode = '42501';
  end if;

  if p_scan_method is null then
    raise exception 'A put-away has to record how the bin was identified.' using errcode = '23514';
  end if;

  select i.* into v_item
    from public.batch b join public.item i on i.id = b.item_id
   where b.id = p_batch_id and b.property_id = p_property_id;

  if not found then
    raise exception 'That batch does not belong to this property.' using errcode = '42501';
  end if;

  -- The destination is resolved from the CODE, not from an id the client chose. That is
  -- the point: what comes off a label is a string, and the app should never have to hold
  -- a bin list in order to interpret one.
  select * into v_dest
    from public.location
   where property_id = p_property_id
     and upper(trim(code)) = upper(trim(coalesce(p_to_location_code, '')));

  if not found then
    raise exception 'No location here has the code %. Check the label.',
      coalesce(nullif(upper(trim(coalesce(p_to_location_code, ''))), ''), '(nothing)')
      using errcode = 'P0001';
  end if;

  if not v_dest.is_active then
    raise exception '% is no longer in use. Put it in a live bin.', v_dest.code
      using errcode = 'P0001';
  end if;

  -- Hard rule: the leaf, and only the leaf. A zone or a rack is a group of places, and
  -- "it is somewhere in the dry store" is the practice this product exists to replace.
  if v_dest.kind <> 'BIN' then
    raise exception '% is a %, not a bin. Stock goes to the labelled position it actually sits in.',
      v_dest.code, lower(v_dest.kind::text)
      using errcode = 'P0001';
  end if;

  -- Hard rule, no enforcement mode, no override (PRD section 4 Gate 6). Ambient goods
  -- may go anywhere — a cold room is wasteful for rice, not dangerous. Chilled and
  -- frozen may only go where they belong, and that asymmetry is the rule.
  if v_item.storage_regime <> 'AMBIENT' and v_dest.regime <> v_item.storage_regime then
    raise exception '% needs % storage and % is %. That cannot be overridden.',
      v_item.name, lower(v_item.storage_regime::text), v_dest.code, lower(v_dest.regime::text)
      using errcode = 'P0001';
  end if;

  -- Sufficiency is checked inside move_stock under a lock, but its message — "there is
  -- none of that batch here to move" — is the wrong answer when the reason is that the
  -- stock was rejected. Rejected stock reaching a zone is the hard rule people most
  -- often try to talk their way around, so it gets the sentence that ends it.
  select qty into v_held from public.stock_lot
   where batch_id = p_batch_id and location_id = p_from_location_id and state = 'QUARANTINE';

  if coalesce(v_held, 0) = 0 then
    select sum(qty) into v_rejected from public.stock_lot
     where batch_id = p_batch_id and state = 'REJECT_HOLD';

    if coalesce(v_rejected, 0) > 0 then
      raise exception 'That stock was rejected. Rejected stock can never be put into a zone — it leaves the property on a gate pass.'
        using errcode = '23514';
    end if;

    raise exception 'None of this batch is waiting at that location.' using errcode = '23514';
  end if;

  v_movement := app.move_stock(
    p_property_id, p_batch_id, v_item.id,
    p_from_location_id, 'QUARANTINE', v_dest.id, 'AVAILABLE',
    p_qty, v_item.base_uom_id, 'PUT_AWAY', p_idempotency_key,
    null, p_scan_method
  );

  -- ---------------------------------------------------------------------------
  -- Dwell
  -- ---------------------------------------------------------------------------
  --
  -- Time at Terminal 1 before put-away. Recorded permanently against the batch and never
  -- cleared: the breach is a fact about a consignment, not a status that improves once
  -- somebody finally moves it.
  select round(extract(epoch from (now() - min(m.occurred_at)))::numeric / 3600, 2)
    into v_dwell_hours
    from public.stock_movement m
   where m.batch_id = p_batch_id and m.to_state = 'QUARANTINE';

  v_dwell_limit := app.rule_threshold(p_property_id, 'MAX_DWELL_HOURS_AT_T1', 4);

  if v_dwell_hours is not null and v_dwell_limit is not null and v_dwell_hours > v_dwell_limit then
    update public.batch set dwell_breach = true where id = p_batch_id;
  end if;

  select coalesce(qty, 0) into v_remaining from public.stock_lot
   where batch_id = p_batch_id and location_id = p_from_location_id and state = 'QUARANTINE';

  return query select v_movement, v_dest.id, v_dest.code, coalesce(v_remaining, 0::numeric(14, 4));
end;
$$;

revoke all on function public.put_away(uuid, uuid, uuid, text, numeric, public.scan_method, text)
  from public, anon;
grant execute on function public.put_away(uuid, uuid, uuid, text, numeric, public.scan_method, text)
  to authenticated;

comment on function public.put_away(uuid, uuid, uuid, text, numeric, public.scan_method, text) is
  'Gate 6. Resolves the destination from a scanned code, refuses anything that is not a live BIN, refuses a regime mismatch outright, and records how the code was established. Rejected stock has no path through here at all.';
