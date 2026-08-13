-- Four holes, all of the same shape: a check that looks like authority but is not.
--
-- `property_id in (select app.accessible_properties())` answers "may this user see this
-- property at all". It does not answer "may this user do this here". Where that is the
-- only test on a write policy, every member of the property can perform every write —
-- including AUDITOR, whose entire definition is read-only, and SECURITY, whose role is
-- deliberately limited to two gates.
--
-- `public.item` already got this right (`create_masters.sql:339`). The flow spine did
-- not, which is what this migration fixes.

-- ---------------------------------------------------------------------------
-- 1. Recording stock is a job, not a side effect of membership
-- ---------------------------------------------------------------------------
--
-- STOREKEEPER because it is their work. OWNER and ADMIN because a small property has
-- one person who is all three, and refusing them would mean nobody could record
-- anything on day one.
--
-- Deliberately absent: GM (overrides, not day-to-day), CHEF and BANQUET (they receive
-- issues by presenting a card, they do not operate the app — PRD section 5), PURCHASE,
-- FSO, and above all AUDITOR. pgTAP 014 asserts the refusal rather than trusting this
-- comment.

drop policy batch_insert on public.batch;

create policy batch_insert on public.batch
  for insert to authenticated
  with check (
    app.has_property_role(
      property_id,
      array['OWNER', 'ADMIN', 'STOREKEEPER']::public.membership_role[]
    )
  );

drop policy stock_movement_insert on public.stock_movement;

create policy stock_movement_insert on public.stock_movement
  for insert to authenticated
  with check (
    app.has_property_role(
      property_id,
      array['OWNER', 'ADMIN', 'STOREKEEPER']::public.membership_role[]
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Capture at the gate belongs to Security
-- ---------------------------------------------------------------------------
--
-- PRD section 4 Gate 0a: Security is a named app user with a role limited to Gate 0 and
-- Gate 10. The reciprocal matters more — if the storekeeper can create the gate entry as
-- well as the GRN, the two records agree by construction and the reconciliation control
-- that the whole module rests on does not exist. STOREKEEPER is not on this list, and
-- that omission is the control.

drop policy gate_entry_insert on public.gate_entry;

create policy gate_entry_insert on public.gate_entry
  for insert to authenticated
  with check (
    app.has_property_role(
      property_id,
      array['OWNER', 'ADMIN', 'SECURITY']::public.membership_role[]
    )
  );

-- The vehicle leaving is an append to the same record, and until now there was no
-- UPDATE policy at all — so `timestamp_out`, a [P1] field, could never be written by
-- anybody. Narrow on purpose: only the timestamp may move, enforced by a trigger below,
-- because Gate 0a also requires that a gate entry cannot be edited once created.
create policy gate_entry_close on public.gate_entry
  for update to authenticated
  using (
    app.has_property_role(
      property_id,
      array['OWNER', 'ADMIN', 'SECURITY']::public.membership_role[]
    )
  )
  with check (
    app.has_property_role(
      property_id,
      array['OWNER', 'ADMIN', 'SECURITY']::public.membership_role[]
    )
  );

grant update (timestamp_out) on public.gate_entry to authenticated;

create or replace function app.gate_entry_is_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A column grant already limits UPDATE to timestamp_out, but a grant is a privilege
  -- and privileges get widened by someone solving a different problem. This is the rule
  -- itself, stated once: everything except the departure time is immutable.
  if new.gate_entry_no is distinct from old.gate_entry_no
     or new.property_id is distinct from old.property_id
     or new.timestamp_in is distinct from old.timestamp_in
     or new.party_id is distinct from old.party_id
     or new.unregistered_vendor_name is distinct from old.unregistered_vendor_name
     or new.arrival_type is distinct from old.arrival_type
     or new.bill is distinct from old.bill
     or new.bill_photo_ref is distinct from old.bill_photo_ref
     or new.package_count is distinct from old.package_count
     or new.vehicle_mode is distinct from old.vehicle_mode
     or new.vehicle_number is distinct from old.vehicle_number
     or new.captured_by is distinct from old.captured_by
     or new.captured_at_device is distinct from old.captured_at_device
  then
    raise exception 'A gate entry cannot be edited once created. Only the departure time may be recorded.'
      using errcode = 'P0001';
  end if;

  -- Closed is closed. Deliberately not "the value changed": inside one transaction
  -- now() does not advance, so a second `set timestamp_out = now()` writes an identical
  -- value and a value comparison sees no change at all. The departure is a fact
  -- recorded once, not a field kept up to date.
  if old.timestamp_out is not null then
    raise exception 'The vehicle has already been recorded as leaving.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger gate_entry_append_only
  before update on public.gate_entry
  for each row execute function app.gate_entry_is_append_only();

-- ---------------------------------------------------------------------------
-- 3. Stock cannot go negative
-- ---------------------------------------------------------------------------
--
-- `app.apply_stock_movement` subtracts without a guard, so issuing ten kilos from a
-- three-kilo lot left -7. The projection then disappeared from the stock report, which
-- filters `qty > 0`, while remaining in the ledger — a discrepancy invisible in the UI
-- until somebody counted the shelf.
--
-- This constraint is a backstop, not the fix. It turns silent corruption into a loud
-- refusal, which is strictly better, but the refusal arrives as a constraint violation
-- from inside a trigger. The real fix is `app.move_stock` taking a row lock and
-- checking sufficiency before it writes, so the user gets "only 3 kg on CHILL-01"
-- instead. That lands with the flow RPCs; this lands now because the hole is open now.

-- The projection maintainer has to stop proposing a negative row before the constraint
-- can exist at all.
--
-- It handled the outbound side as `insert ... values (-qty) on conflict do update set
-- qty = qty - new.qty`. Postgres evaluates CHECK constraints on the tuple being
-- inserted BEFORE it resolves the conflict, so `qty >= 0` rejects the speculative
-- -qty row and every outbound movement fails — even one leaving a healthy positive
-- balance. Writing off 10 from a lot of 40 raised, which is how CI found this.
--
-- Update first, insert only where there is genuinely nothing yet. Taking stock from a
-- lot that does not exist is now a raised error rather than a negative row invented on
-- the spot, which is the same defect this whole section is about (CLAUDE.md 4b: zero
-- rows affected is a failure, not a no-op).
create or replace function app.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_touched integer;
begin
  if new.from_location_id is not null and new.from_state is not null then
    update public.stock_lot
       set qty = qty - new.qty, updated_at = now()
     where batch_id = new.batch_id
       and location_id = new.from_location_id
       and state = new.from_state;

    get diagnostics v_touched = row_count;

    if v_touched = 0 then
      raise exception
        'No stock of this batch is held at that location in that state, so none can be moved out of it.'
        using errcode = '23514';
    end if;
  end if;

  if new.to_location_id is not null and new.to_state is not null then
    -- Always an increase, so the speculative row is never negative and the constraint
    -- has nothing to object to.
    insert into public.stock_lot (property_id, batch_id, location_id, state, qty, updated_at)
    values (new.property_id, new.batch_id, new.to_location_id, new.to_state, new.qty, now())
    on conflict (batch_id, location_id, state)
    do update set qty = public.stock_lot.qty + new.qty, updated_at = now();
  end if;

  return new;
end;
$$;

comment on function app.apply_stock_movement() is
  'Maintains stock_lot from the ledger. Updates the source before inserting the destination, so a negative row is never proposed and stock_lot_never_negative can hold. SECURITY DEFINER because the projection is derived by the system, not written by the user.';

alter table public.stock_lot
  add constraint stock_lot_never_negative check (qty >= 0);

comment on constraint stock_lot_never_negative on public.stock_lot is
  'Backstop against over-issue. The friendly check belongs in app.move_stock; this is what stops the ledger and the projection disagreeing in the meantime.';

-- ---------------------------------------------------------------------------
-- 4. A property code is unique per organisation, not globally
-- ---------------------------------------------------------------------------
--
-- `system.grant_property_role` resolved `where code = upper(trim(p_property_code))` with
-- no org filter, into a non-STRICT SELECT INTO. Two customers both using 'SB' — entirely
-- plausible, it is a generic abbreviation — and it silently granted membership at an
-- arbitrary one of them. Silently: SELECT INTO does not raise on multiple rows, it takes
-- whichever came first.
--
-- The by-code form stays, because it is what a human types in the SQL editor, but it now
-- refuses ambiguity instead of guessing. Anything programmatic should use the by-id form
-- below, where there is nothing to resolve.

create or replace function system.grant_property_role(
  p_email         text,
  p_property_code text,
  p_role          public.membership_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id  uuid;
  v_matches  integer;
  v_prop_id  uuid;
begin
  select id into v_user_id
    from auth.users
   where lower(email) = lower(trim(p_email));

  if v_user_id is null then
    raise exception 'No user found for email %. Create them in Authentication first, with Auto Confirm ticked.', p_email;
  end if;

  select count(*) into v_matches
    from public.property
   where code = upper(trim(p_property_code));

  if v_matches = 0 then
    raise exception 'No property with code %.', upper(trim(p_property_code));
  end if;

  if v_matches > 1 then
    raise exception
      'Property code % exists in % organisations. Use system.grant_property_role_by_id(email, property_id, role) — granting the wrong customer''s property is not a mistake that announces itself.',
      upper(trim(p_property_code)), v_matches;
  end if;

  select id into v_prop_id
    from public.property
   where code = upper(trim(p_property_code));

  perform system.grant_property_role_by_id(p_email, v_prop_id, p_role);
end;
$$;

create or replace function system.grant_property_role_by_id(
  p_email       text,
  p_property_id uuid,
  p_role        public.membership_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_org_id  uuid;
begin
  select id into v_user_id
    from auth.users
   where lower(email) = lower(trim(p_email));

  if v_user_id is null then
    raise exception 'No user found for email %. Create them in Authentication first, with Auto Confirm ticked.', p_email;
  end if;

  select org_id into v_org_id
    from public.property
   where id = p_property_id;

  if v_org_id is null then
    raise exception 'No property with id %.', p_property_id;
  end if;

  insert into public.membership (user_id, org_id, property_id, role)
  values (v_user_id, v_org_id, p_property_id, p_role)
  on conflict do nothing;
end;
$$;

revoke all on function system.grant_property_role(text, text, public.membership_role)
  from public, anon, authenticated;
revoke all on function system.grant_property_role_by_id(text, uuid, public.membership_role)
  from public, anon, authenticated;

grant execute on function system.grant_property_role(text, text, public.membership_role)
  to service_role;
grant execute on function system.grant_property_role_by_id(text, uuid, public.membership_role)
  to service_role;

comment on function system.grant_property_role_by_id(text, uuid, public.membership_role) is
  'Grants a membership at an unambiguous property. Prefer this over the by-code form anywhere a machine is calling.';
