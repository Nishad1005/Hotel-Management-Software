-- The spine: batch, the stock ledger, gate entry and pass, GRN, dispatch, returnables.
--
-- PRD section 9 names six things that cannot be retrofitted and must exist in the
-- schema from the first migrations "even where the UI barely touches them". Only one
-- of the six existed. This migration lands the other five, deliberately ahead of any
-- screen that uses them, because the whole point of that list is that adding these
-- later is a rewrite rather than an addition.
--
-- The UI touches almost none of this yet. That is intended.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

-- PRD section 3.2. QUARANTINE, TRANSIT and STAGED_OUT are here from the start even
-- though the pilot only uses AVAILABLE and ISSUED: without them, stock walking between
-- zones is either double-counted or invisible, and both are wrong exactly where the
-- high-value items move.
create type public.stock_state as enum (
  'QUARANTINE',  -- at T1, on the books, not issuable
  'AVAILABLE',   -- in a zone bin, issuable
  'TRANSIT',     -- between zones, issuable at neither end
  'ISSUED',      -- with a department
  'STAGED_OUT',  -- at T2 awaiting departure
  'REJECT_HOLD', -- supplier liability, can never reach a zone
  'BLOCKED'      -- FSO hold
);

create type public.movement_reason as enum (
  'OPENING_STOCK',
  'GRN_POSTING',
  'PUT_AWAY',
  'ZONE_TRANSFER',
  'ISSUE',
  'RETURN_TO_STORE',
  'DISPATCH_STAGING',
  'WRITE_OFF_EXPIRED',
  'WRITE_OFF_DAMAGED',
  'CORRECTION'
);

create type public.batch_source as enum ('OPENING_STOCK', 'GRN');

create type public.arrival_type as enum (
  'PO_DELIVERY', 'MARKET_PURCHASE', 'RETURN_FROM_OUTLET', 'TRANSFER_IN', 'SAMPLE'
);

create type public.vehicle_mode as enum ('TRUCK', 'TEMPO', 'TWO_WHEELER', 'HAND_CART');

-- PRD section 4 Gate 0: "no bill" is a valid answer, and it is a different fact from
-- "not yet asked". Collapsing them would let a blank field assert something.
create type public.bill_state as enum ('UNANSWERED', 'PHOTOGRAPHED', 'NONE');

create type public.grn_line_decision as enum ('ACCEPT', 'ACCEPT_PARTIAL', 'REJECT');

-- PRD section 4 Gate 4: six reasons only at P1. Extended codes come at P2.
create type public.reject_reason as enum (
  'SHORT_SHELF_LIFE', 'NOT_COLD_ENOUGH', 'POOR_QUALITY', 'DAMAGED', 'WRONG_ITEM', 'OTHER'
);

create type public.dispatch_type as enum (
  'SUPPLIER_RETURN', 'EMPTIES', 'LINEN', 'EQUIPMENT_REPAIR', 'OUTDOOR_CATERING',
  'INTER_PROPERTY', 'CONDEMNED', 'FOOD_WASTE', 'USED_COOKING_OIL', 'SCRAP'
);

-- ---------------------------------------------------------------------------
-- Batch — first class, per PRD section 9 item 3
-- ---------------------------------------------------------------------------

create table public.batch (
  id                    uuid primary key default gen_random_uuid(),
  property_id           uuid not null references public.property (id) on delete cascade,
  item_id               uuid not null references public.item (id) on delete restrict,
  batch_no              text not null check (length(trim(batch_no)) > 0),
  -- Every batch-controlled line gets a record even when the vendor supplies no number
  -- (PRD section 4 Gate 3). Generated numbers are marked so a trace can tell them apart.
  is_system_generated   boolean not null default false,
  mfg_date              date,
  best_before           date,
  shelf_life_total_days integer check (shelf_life_total_days is null or shelf_life_total_days > 0),
  -- Remaining shelf life AT RECEIPT, frozen at the moment of receiving. Recomputing it
  -- later would erase the fact the delivery was already old when it arrived.
  pct_at_receipt        numeric(5, 2),
  receipt_temp_c        numeric(5, 2),
  dwell_breach          boolean not null default false,
  source                public.batch_source not null,
  created_at            timestamptz not null default now(),

  constraint batch_no_unique_per_item unique (property_id, item_id, batch_no),
  constraint batch_property_id_id_unique unique (property_id, id),
  constraint batch_dates_ordered check (mfg_date is null or best_before is null or mfg_date <= best_before)
);

create index batch_property_id_idx on public.batch (property_id);
create index batch_item_id_idx on public.batch (item_id);
-- The watchlist orders by expiry, so it gets its own index.
create index batch_best_before_idx on public.batch (property_id, best_before)
  where best_before is not null;

-- ---------------------------------------------------------------------------
-- Gate entry and gate pass — the spine, per PRD section 9 item 1
-- ---------------------------------------------------------------------------

create table public.gate_entry (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.property (id) on delete cascade,
  -- Sequential and immutable. Written by hand onto the vendor's challan, which is why
  -- it can never be reassigned (ADR 0005).
  gate_entry_no  text not null,
  timestamp_in   timestamptz not null default now(),
  timestamp_out  timestamptz,
  party_id       uuid,
  unregistered_vendor_name text,
  arrival_type   public.arrival_type not null default 'PO_DELIVERY',
  bill           public.bill_state not null default 'UNANSWERED',
  bill_photo_ref text,
  package_count  integer not null check (package_count >= 1),
  vehicle_mode   public.vehicle_mode,
  vehicle_number text,
  captured_by    uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint gate_entry_no_unique_per_property unique (property_id, gate_entry_no),
  constraint gate_entry_property_id_id_unique unique (property_id, id),
  -- A vendor is either registered or named. Neither is not an option.
  constraint gate_entry_has_a_vendor
    check (party_id is not null or length(trim(coalesce(unregistered_vendor_name, ''))) > 0),
  constraint gate_entry_photo_matches_bill_state
    check (bill <> 'PHOTOGRAPHED' or bill_photo_ref is not null)
);

create index gate_entry_property_id_idx on public.gate_entry (property_id);
-- The reconciliation control (PRD section 1) scans for entries with no GRN.
create index gate_entry_open_idx on public.gate_entry (property_id, timestamp_in);

comment on table public.gate_entry is
  'Primary inbound capture. Every downstream record hangs off this number, and every entry must resolve to a GRN or raise an alert.';

-- ---------------------------------------------------------------------------
-- GRN — immutable, amended never edited. PRD section 9 item 5
-- ---------------------------------------------------------------------------

create table public.grn (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.property (id) on delete cascade,
  grn_no         text not null,
  gate_entry_id  uuid references public.gate_entry (id) on delete restrict,
  party_id       uuid,
  posted_at      timestamptz not null default now(),
  posted_by      uuid references auth.users (id) on delete set null,
  -- An amendment is a NEW grn pointing at the one it supersedes. The original is never
  -- touched, so the trail is the chain itself.
  amendment_of   uuid references public.grn (id) on delete restrict,
  amendment_reason text,
  created_at     timestamptz not null default now(),

  constraint grn_no_unique_per_property unique (property_id, grn_no),
  constraint grn_property_id_id_unique unique (property_id, id),
  constraint grn_amendment_has_reason
    check (amendment_of is null or length(trim(coalesce(amendment_reason, ''))) > 0)
);

create index grn_property_id_idx on public.grn (property_id);
create index grn_gate_entry_id_idx on public.grn (gate_entry_id);

create table public.grn_line (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.property (id) on delete cascade,
  grn_id         uuid not null references public.grn (id) on delete cascade,
  item_id        uuid not null references public.item (id) on delete restrict,
  batch_id       uuid references public.batch (id) on delete restrict,
  qty_challan    numeric(14, 4),
  qty_physical   numeric(14, 4) not null check (qty_physical >= 0),
  qty_accepted   numeric(14, 4) not null default 0 check (qty_accepted >= 0),
  qty_rejected   numeric(14, 4) not null default 0 check (qty_rejected >= 0),
  uom_id         uuid not null references public.uom (id) on delete restrict,
  decision       public.grn_line_decision not null,
  reject_reason  public.reject_reason,
  created_at     timestamptz not null default now(),

  constraint grn_line_reject_has_reason
    check (decision = 'ACCEPT' or reject_reason is not null),
  constraint grn_line_quantities_reconcile
    check (qty_accepted + qty_rejected <= qty_physical)
);

create index grn_line_property_id_idx on public.grn_line (property_id);
create index grn_line_grn_id_idx on public.grn_line (grn_id);

/**
 * GRN immutability.
 *
 * A posted GRN is corrected by amendment, never by edit (PRD section 4 Gate 5,
 * acceptance criterion 10). Enforcing it in the database rather than the application
 * matters because an offline client cannot be trusted and the app will be rewritten
 * long before this schema is.
 */
create or replace function app.forbid_grn_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    'A posted GRN cannot be % . Post an amendment instead: insert a new grn with '
    'amendment_of set to this one and a reason. PRD section 4 Gate 5.',
    lower(tg_op);
end;
$$;

create trigger grn_is_immutable
  before update or delete on public.grn
  for each row execute function app.forbid_grn_mutation();

create trigger grn_line_is_immutable
  before update or delete on public.grn_line
  for each row execute function app.forbid_grn_mutation();

-- ---------------------------------------------------------------------------
-- Dispatch and returnables — PRD section 9 item 6
-- ---------------------------------------------------------------------------

create table public.dispatch_note (
  id                   uuid primary key default gen_random_uuid(),
  property_id          uuid not null references public.property (id) on delete cascade,
  dispatch_no          text not null,
  dispatch_type        public.dispatch_type not null,
  reason_code          text,
  origin_location_id   uuid references public.location (id) on delete restrict,
  batch_id             uuid references public.batch (id) on delete restrict,
  item_id              uuid references public.item (id) on delete restrict,
  qty                  numeric(14, 4) check (qty is null or qty > 0),
  uom_id               uuid references public.uom (id) on delete restrict,
  recipient_party_id   uuid,
  -- The control that pays for itself: linen, equipment and crockery leave with an
  -- expected return date and stay on an aged register until they come back.
  is_returnable        boolean not null default false,
  expected_return_date date,
  authorised_by        uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),

  constraint dispatch_no_unique_per_property unique (property_id, dispatch_no),
  constraint dispatch_property_id_id_unique unique (property_id, id),
  constraint dispatch_returnable_has_date
    check (not is_returnable or expected_return_date is not null)
);

create index dispatch_note_property_id_idx on public.dispatch_note (property_id);
create index dispatch_note_returnable_idx on public.dispatch_note (property_id, expected_return_date)
  where is_returnable;

create table public.gate_pass (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid not null references public.property (id) on delete cascade,
  gate_pass_no     text not null,
  dispatch_note_id uuid references public.dispatch_note (id) on delete restrict,
  timestamp_out    timestamptz not null default now(),
  carrier          text,
  vehicle_number   text,
  package_count    integer check (package_count is null or package_count >= 1),
  verified_by      uuid references auth.users (id) on delete set null,
  printed_at       timestamptz,
  created_at       timestamptz not null default now(),

  constraint gate_pass_no_unique_per_property unique (property_id, gate_pass_no)
);

create index gate_pass_property_id_idx on public.gate_pass (property_id);

create table public.returnable_item (
  id                  uuid primary key default gen_random_uuid(),
  property_id         uuid not null references public.property (id) on delete cascade,
  dispatch_note_id    uuid not null references public.dispatch_note (id) on delete cascade,
  qty_out             numeric(14, 4) not null check (qty_out > 0),
  qty_returned        numeric(14, 4) not null default 0 check (qty_returned >= 0),
  condition_on_return text,
  returned_at         timestamptz,
  responsible_dept    text,
  created_at          timestamptz not null default now(),

  constraint returnable_not_over_returned check (qty_returned <= qty_out)
);

create index returnable_item_property_id_idx on public.returnable_item (property_id);

-- ---------------------------------------------------------------------------
-- The stock ledger — ADR 0003
-- ---------------------------------------------------------------------------
--
-- Append only. stock_lot is derived, never written directly. A correction is a
-- compensating movement, not an edit: appending twice is caught by the idempotency
-- key, whereas incrementing a quantity twice is silent corruption that surfaces weeks
-- later as a discrepancy nobody can explain.

create table public.stock_movement (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid not null references public.property (id) on delete cascade,
  batch_id         uuid not null references public.batch (id) on delete restrict,
  item_id          uuid not null references public.item (id) on delete restrict,
  from_location_id uuid references public.location (id) on delete restrict,
  from_state       public.stock_state,
  to_location_id   uuid references public.location (id) on delete restrict,
  to_state         public.stock_state,
  qty              numeric(14, 4) not null check (qty > 0),
  uom_id           uuid not null references public.uom (id) on delete restrict,
  reason           public.movement_reason not null,
  -- Server-authoritative. Device clocks are never trusted (CLAUDE.md rule 19).
  occurred_at      timestamptz not null default now(),
  recorded_by      uuid references auth.users (id) on delete set null,
  -- The offline outbox retries. A repeated key must be a no-op, not a second movement.
  idempotency_key  text not null,
  note             text,

  constraint stock_movement_idempotency_unique unique (property_id, idempotency_key),
  -- A movement must come from somewhere or go somewhere. Neither is meaningless.
  constraint stock_movement_has_an_end
    check (from_state is not null or to_state is not null),
  -- Rejected stock can never reach a zone. Hard rule, no enforcement mode, no override
  -- (PRD section 8). Enforced here as well as in the domain package because an offline
  -- client cannot be trusted.
  constraint stock_movement_rejected_cannot_reach_a_zone
    check (
      from_state is distinct from 'REJECT_HOLD'
      or to_state is null
      or to_state in ('REJECT_HOLD', 'STAGED_OUT')
    )
);

create index stock_movement_property_id_idx on public.stock_movement (property_id);
create index stock_movement_batch_id_idx on public.stock_movement (batch_id);
create index stock_movement_occurred_at_idx on public.stock_movement (property_id, occurred_at);

comment on table public.stock_movement is
  'Append-only ledger. Never updated or deleted; a correction is a compensating movement. See ADR 0003.';

create table public.stock_lot (
  property_id uuid not null references public.property (id) on delete cascade,
  batch_id    uuid not null references public.batch (id) on delete cascade,
  location_id uuid not null references public.location (id) on delete restrict,
  state       public.stock_state not null,
  qty         numeric(14, 4) not null default 0,
  updated_at  timestamptz not null default now(),

  primary key (batch_id, location_id, state)
);

create index stock_lot_property_id_idx on public.stock_lot (property_id);
create index stock_lot_available_idx on public.stock_lot (property_id, state) where qty > 0;

comment on table public.stock_lot is
  'Maintained projection of stock_movement. Never written directly; 007 asserts it equals a full replay of the ledger.';

/**
 * Maintains stock_lot from the ledger.
 *
 * Deliberately not a view: the stock report and the watchlist are read constantly and
 * replaying the whole ledger each time would not survive a year of movements. The
 * pgTAP suite asserts the projection agrees with a replay, which is what keeps a
 * maintained table honest.
 */
create or replace function app.apply_stock_movement()
returns trigger
language plpgsql
security invoker
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

create trigger stock_movement_maintains_lot
  after insert on public.stock_movement
  for each row execute function app.apply_stock_movement();

create or replace function app.forbid_ledger_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    'stock_movement is append-only (ADR 0003). Post a compensating movement with '
    'reason CORRECTION instead of editing history.';
end;
$$;

create trigger stock_movement_is_append_only
  before update or delete on public.stock_movement
  for each row execute function app.forbid_ledger_mutation();

-- ---------------------------------------------------------------------------
-- Grants and row level security
-- ---------------------------------------------------------------------------

grant select on
  public.batch, public.gate_entry, public.grn, public.grn_line,
  public.dispatch_note, public.gate_pass, public.returnable_item,
  public.stock_movement, public.stock_lot
to authenticated;

-- Stock is recorded by the people doing the work, not only by administrators. The
-- ledger is append-only by trigger, so INSERT is the only verb that matters.
grant insert on public.batch, public.stock_movement, public.gate_entry to authenticated;

grant all on
  public.batch, public.gate_entry, public.grn, public.grn_line,
  public.dispatch_note, public.gate_pass, public.returnable_item,
  public.stock_movement, public.stock_lot
to service_role;

alter table public.batch            enable row level security;
alter table public.gate_entry       enable row level security;
alter table public.grn              enable row level security;
alter table public.grn_line         enable row level security;
alter table public.dispatch_note    enable row level security;
alter table public.gate_pass        enable row level security;
alter table public.returnable_item  enable row level security;
alter table public.stock_movement   enable row level security;
alter table public.stock_lot        enable row level security;

alter table public.batch            force row level security;
alter table public.gate_entry       force row level security;
alter table public.grn              force row level security;
alter table public.grn_line         force row level security;
alter table public.dispatch_note    force row level security;
alter table public.gate_pass        force row level security;
alter table public.returnable_item  force row level security;
alter table public.stock_movement   force row level security;
alter table public.stock_lot        force row level security;

create policy batch_select on public.batch
  for select to authenticated using (property_id in (select app.accessible_properties()));
create policy batch_insert on public.batch
  for insert to authenticated with check (property_id in (select app.accessible_properties()));

create policy gate_entry_select on public.gate_entry
  for select to authenticated using (property_id in (select app.accessible_properties()));
create policy gate_entry_insert on public.gate_entry
  for insert to authenticated with check (property_id in (select app.accessible_properties()));

create policy grn_select on public.grn
  for select to authenticated using (property_id in (select app.accessible_properties()));

create policy grn_line_select on public.grn_line
  for select to authenticated using (property_id in (select app.accessible_properties()));

create policy dispatch_note_select on public.dispatch_note
  for select to authenticated using (property_id in (select app.accessible_properties()));

create policy gate_pass_select on public.gate_pass
  for select to authenticated using (property_id in (select app.accessible_properties()));

create policy returnable_item_select on public.returnable_item
  for select to authenticated using (property_id in (select app.accessible_properties()));

create policy stock_movement_select on public.stock_movement
  for select to authenticated using (property_id in (select app.accessible_properties()));
create policy stock_movement_insert on public.stock_movement
  for insert to authenticated with check (property_id in (select app.accessible_properties()));

create policy stock_lot_select on public.stock_lot
  for select to authenticated using (property_id in (select app.accessible_properties()));
