-- The stock_lot projection could not be maintained by an ordinary user.
--
-- Recording opening stock failed with "permission denied". The insert into
-- stock_movement was allowed, but its AFTER INSERT trigger — which maintains
-- stock_lot — ran as SECURITY INVOKER, meaning as the signed-in user, and
-- `authenticated` holds only SELECT on stock_lot. The write was refused, so the whole
-- statement rolled back.
--
-- Granting INSERT and UPDATE on stock_lot to authenticated would have fixed the
-- symptom and broken the design: stock_lot is derived and must never be written
-- directly, or it stops being a projection and becomes a second, disagreeing source of
-- truth (ADR 0003).
--
-- The projection is maintained by the system, so the function should run as the
-- system.

create or replace function app.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.from_location_id is not null and new.from_state is not null then
    insert into public.stock_lot (property_id, batch_id, location_id, state, qty, updated_at)
    values (new.property_id, new.batch_id, new.from_location_id, new.from_state, -new.qty, now())
    on conflict (batch_id, location_id, state)
    do update set qty = public.stock_lot.qty - new.qty, updated_at = now();
  end if;

  if new.to_location_id is not null and new.to_state is not null then
    insert into public.stock_lot (property_id, batch_id, location_id, state, qty, updated_at)
    values (new.property_id, new.batch_id, new.to_location_id, new.to_state, new.qty, now())
    on conflict (batch_id, location_id, state)
    do update set qty = public.stock_lot.qty + new.qty, updated_at = now();
  end if;

  return new;
end;
$$;

-- FORCE ROW LEVEL SECURITY applies RLS to the table owner as well, which would block
-- the SECURITY DEFINER function above — it runs as the owner and stock_lot carries no
-- INSERT policy, deliberately. RLS itself stays ON, so reads remain scoped to the
-- caller's properties; only the owner is exempt, and the owner here is the trigger
-- that derives the data in the first place.
alter table public.stock_lot no force row level security;

comment on function app.apply_stock_movement() is
  'Maintains stock_lot from the ledger. SECURITY DEFINER because the projection is derived by the system, not written by the user; granting users write access to stock_lot would make it a second source of truth.';
