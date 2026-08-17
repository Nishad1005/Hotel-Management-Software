-- The one place stock moves.
--
-- Every part of the flow still to come — post_grn, put_away, issue_stock, the write-off
-- that already exists — needs the same four things: check the caller may act here,
-- check sufficiency, write the ledger, let the projection follow. Doing that inline in
-- four RPCs means four chances to get it subtly different, and a stock discrepancy is
-- the one bug this product cannot survive.
--
-- golaiv1's equivalent is `move_stock`, and its shape is worth borrowing: one guarded
-- primitive, revoked from clients, that every module routes through. What is NOT
-- borrowed is its body — it mutates a balance row, applies the delta first and checks
-- for negative afterwards, and keys on (item, shelf) with nowhere to put a batch. Ours
-- appends to a ledger and lets the trigger maintain the projection (ADR 0003), and the
-- batch is the whole point, because that is where traceability lives.
--
-- Internal on purpose. `app` is not exposed to PostgREST, so this is unreachable from a
-- client; the callable RPCs in `public` come next and every one of them goes through
-- here.

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

  insert into public.stock_movement (
    property_id, batch_id, item_id,
    from_location_id, from_state, to_location_id, to_state,
    qty, uom_id, reason, recorded_by, idempotency_key, note
  )
  values (
    p_property_id, p_batch_id, p_item_id,
    p_from_location_id, p_from_state, p_to_location_id, p_to_state,
    p_qty, p_uom_id, p_reason, (select auth.uid()), p_idempotency_key, p_note
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Unreachable from a client, and stated rather than assumed. `app` is not exposed to
-- PostgREST, but a schema being unexposed is a config fact and config changes; a revoke
-- is a permission and permissions do not.
revoke all on function app.move_stock(
  uuid, uuid, uuid, uuid, public.stock_state, uuid, public.stock_state,
  numeric, uuid, public.movement_reason, text, text
) from public, anon, authenticated;

comment on function app.move_stock(
  uuid, uuid, uuid, uuid, public.stock_state, uuid, public.stock_state,
  numeric, uuid, public.movement_reason, text, text
) is
  'The only place stock moves. Re-resolves every id against the property, checks sufficiency under a row lock, and appends to the ledger. Internal: the callable RPCs in public all route through it.';
