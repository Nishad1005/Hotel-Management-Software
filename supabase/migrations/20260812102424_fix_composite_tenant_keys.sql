-- A row could reference another property's data. Nothing stopped it.
--
-- Every domain table carries property_id, and every RLS policy checks it. But the
-- foreign keys were single-column — `batch_id references batch (id)` — so a
-- stock_movement at property A naming property B's batch satisfied every constraint
-- in the database. The insert policy only asks whether the caller may write to
-- property A; it never asks whether the batch belongs there.
--
-- That is CLAUDE.md non-negotiable 4 ("never one row spanning two properties") with
-- nothing enforcing it. RLS cannot: it decides which rows you may see and write, not
-- whether the rows you name belong together.
--
-- The fix is composite foreign keys: `(property_id, batch_id)` references
-- `batch (property_id, id)`. The tenancy column becomes part of every reference, so
-- crossing a property boundary is a constraint violation rather than a policy question.
-- Most of the `unique (property_id, id)` constraints these need were already added in
-- anticipation; they simply had no foreign key using them.
--
-- This must land before the flow RPCs. A SECURITY DEFINER function bypasses RLS
-- entirely, so it has to re-check every id it is handed against p_property_id. That
-- check is far easier to get right — and impossible to forget — when the schema
-- refuses the bad reference underneath it.

-- ---------------------------------------------------------------------------
-- The one missing target
-- ---------------------------------------------------------------------------

-- Every other referenced table already carries this. `uom` was the gap, which is why
-- an item at property A could take its base unit from property B.
alter table public.uom
  add constraint uom_property_id_id_unique unique (property_id, id);

-- ---------------------------------------------------------------------------
-- Masters
-- ---------------------------------------------------------------------------
--
-- Each block drops the single-column key and adds the composite as NOT VALID, then
-- validates it separately. NOT VALID skips the full table scan while holding the
-- exclusive lock; VALIDATE takes only a SHARE UPDATE EXCLUSIVE and scans concurrently
-- with reads and writes. These tables are small today, but this is the shape that
-- still works when they are not.
--
-- Nullable reference columns keep MATCH SIMPLE semantics: property_id is NOT NULL
-- everywhere, so when the referencing id is null the constraint is simply not checked,
-- which is exactly right for "no parent" and "no default location".

alter table public.item_category
  drop constraint item_category_parent_id_fkey,
  add constraint item_category_parent_fk
    foreign key (property_id, parent_id) references public.item_category (property_id, id)
    on delete restrict not valid;
alter table public.item_category validate constraint item_category_parent_fk;

alter table public.location
  drop constraint location_parent_id_fkey,
  add constraint location_parent_fk
    foreign key (property_id, parent_id) references public.location (property_id, id)
    on delete restrict not valid;
alter table public.location validate constraint location_parent_fk;

alter table public.item
  drop constraint item_category_id_fkey,
  drop constraint item_base_uom_id_fkey,
  drop constraint item_default_location_id_fkey,
  add constraint item_category_fk
    foreign key (property_id, category_id) references public.item_category (property_id, id)
    on delete restrict not valid,
  add constraint item_base_uom_fk
    foreign key (property_id, base_uom_id) references public.uom (property_id, id)
    on delete restrict not valid,
  add constraint item_default_location_fk
    foreign key (property_id, default_location_id) references public.location (property_id, id)
    on delete set null not valid;
alter table public.item validate constraint item_category_fk;
alter table public.item validate constraint item_base_uom_fk;
alter table public.item validate constraint item_default_location_fk;

alter table public.item_pack
  drop constraint item_pack_item_id_fkey,
  drop constraint item_pack_uom_id_fkey,
  add constraint item_pack_item_fk
    foreign key (property_id, item_id) references public.item (property_id, id)
    on delete cascade not valid,
  add constraint item_pack_uom_fk
    foreign key (property_id, uom_id) references public.uom (property_id, id)
    on delete restrict not valid;
alter table public.item_pack validate constraint item_pack_item_fk;
alter table public.item_pack validate constraint item_pack_uom_fk;

alter table public.rule_config
  drop constraint rule_config_category_id_fkey,
  add constraint rule_config_category_fk
    foreign key (property_id, category_id) references public.item_category (property_id, id)
    on delete cascade not valid;
alter table public.rule_config validate constraint rule_config_category_fk;

-- ---------------------------------------------------------------------------
-- The flow spine
-- ---------------------------------------------------------------------------

alter table public.batch
  drop constraint batch_item_id_fkey,
  add constraint batch_item_fk
    foreign key (property_id, item_id) references public.item (property_id, id)
    on delete restrict not valid;
alter table public.batch validate constraint batch_item_fk;

alter table public.grn
  drop constraint grn_gate_entry_id_fkey,
  drop constraint grn_amendment_of_fkey,
  add constraint grn_gate_entry_fk
    foreign key (property_id, gate_entry_id) references public.gate_entry (property_id, id)
    on delete restrict not valid,
  -- An amendment chain that crossed properties would be the worst version of this bug:
  -- one property's correction rewriting the history of another's.
  add constraint grn_amendment_of_fk
    foreign key (property_id, amendment_of) references public.grn (property_id, id)
    on delete restrict not valid;
alter table public.grn validate constraint grn_gate_entry_fk;
alter table public.grn validate constraint grn_amendment_of_fk;

alter table public.grn_line
  drop constraint grn_line_grn_id_fkey,
  drop constraint grn_line_item_id_fkey,
  drop constraint grn_line_batch_id_fkey,
  drop constraint grn_line_uom_id_fkey,
  add constraint grn_line_grn_fk
    foreign key (property_id, grn_id) references public.grn (property_id, id)
    on delete cascade not valid,
  add constraint grn_line_item_fk
    foreign key (property_id, item_id) references public.item (property_id, id)
    on delete restrict not valid,
  add constraint grn_line_batch_fk
    foreign key (property_id, batch_id) references public.batch (property_id, id)
    on delete restrict not valid,
  add constraint grn_line_uom_fk
    foreign key (property_id, uom_id) references public.uom (property_id, id)
    on delete restrict not valid;
alter table public.grn_line validate constraint grn_line_grn_fk;
alter table public.grn_line validate constraint grn_line_item_fk;
alter table public.grn_line validate constraint grn_line_batch_fk;
alter table public.grn_line validate constraint grn_line_uom_fk;

alter table public.dispatch_note
  drop constraint dispatch_note_origin_location_id_fkey,
  drop constraint dispatch_note_batch_id_fkey,
  drop constraint dispatch_note_item_id_fkey,
  drop constraint dispatch_note_uom_id_fkey,
  add constraint dispatch_note_origin_location_fk
    foreign key (property_id, origin_location_id) references public.location (property_id, id)
    on delete restrict not valid,
  add constraint dispatch_note_batch_fk
    foreign key (property_id, batch_id) references public.batch (property_id, id)
    on delete restrict not valid,
  add constraint dispatch_note_item_fk
    foreign key (property_id, item_id) references public.item (property_id, id)
    on delete restrict not valid,
  add constraint dispatch_note_uom_fk
    foreign key (property_id, uom_id) references public.uom (property_id, id)
    on delete restrict not valid;
alter table public.dispatch_note validate constraint dispatch_note_origin_location_fk;
alter table public.dispatch_note validate constraint dispatch_note_batch_fk;
alter table public.dispatch_note validate constraint dispatch_note_item_fk;
alter table public.dispatch_note validate constraint dispatch_note_uom_fk;

alter table public.gate_pass
  drop constraint gate_pass_dispatch_note_id_fkey,
  add constraint gate_pass_dispatch_note_fk
    foreign key (property_id, dispatch_note_id) references public.dispatch_note (property_id, id)
    on delete restrict not valid;
alter table public.gate_pass validate constraint gate_pass_dispatch_note_fk;

alter table public.returnable_item
  drop constraint returnable_item_dispatch_note_id_fkey,
  add constraint returnable_item_dispatch_note_fk
    foreign key (property_id, dispatch_note_id) references public.dispatch_note (property_id, id)
    on delete cascade not valid;
alter table public.returnable_item validate constraint returnable_item_dispatch_note_fk;

-- ---------------------------------------------------------------------------
-- The ledger and its projection — the ones that matter most
-- ---------------------------------------------------------------------------
--
-- stock_movement is append-only and stock_lot is derived from it, so a cross-property
-- reference here is not a row someone can go and correct. It is permanent, and it
-- would put one property's quantity into another property's stock report.

alter table public.stock_movement
  drop constraint stock_movement_batch_id_fkey,
  drop constraint stock_movement_item_id_fkey,
  drop constraint stock_movement_from_location_id_fkey,
  drop constraint stock_movement_to_location_id_fkey,
  drop constraint stock_movement_uom_id_fkey,
  add constraint stock_movement_batch_fk
    foreign key (property_id, batch_id) references public.batch (property_id, id)
    on delete restrict not valid,
  add constraint stock_movement_item_fk
    foreign key (property_id, item_id) references public.item (property_id, id)
    on delete restrict not valid,
  add constraint stock_movement_from_location_fk
    foreign key (property_id, from_location_id) references public.location (property_id, id)
    on delete restrict not valid,
  add constraint stock_movement_to_location_fk
    foreign key (property_id, to_location_id) references public.location (property_id, id)
    on delete restrict not valid,
  add constraint stock_movement_uom_fk
    foreign key (property_id, uom_id) references public.uom (property_id, id)
    on delete restrict not valid;
alter table public.stock_movement validate constraint stock_movement_batch_fk;
alter table public.stock_movement validate constraint stock_movement_item_fk;
alter table public.stock_movement validate constraint stock_movement_from_location_fk;
alter table public.stock_movement validate constraint stock_movement_to_location_fk;
alter table public.stock_movement validate constraint stock_movement_uom_fk;

alter table public.stock_lot
  drop constraint stock_lot_batch_id_fkey,
  drop constraint stock_lot_location_id_fkey,
  add constraint stock_lot_batch_fk
    foreign key (property_id, batch_id) references public.batch (property_id, id)
    on delete cascade not valid,
  add constraint stock_lot_location_fk
    foreign key (property_id, location_id) references public.location (property_id, id)
    on delete restrict not valid;
alter table public.stock_lot validate constraint stock_lot_batch_fk;
alter table public.stock_lot validate constraint stock_lot_location_fk;

-- ---------------------------------------------------------------------------
-- What the device claims, kept apart from what the server knows
-- ---------------------------------------------------------------------------
--
-- timestamp_in defaults to now(), which is the moment the row reached the server. For
-- an entry captured at the gate at 08:00 and synced at 14:00 — the whole point of the
-- offline queue — that is six hours wrong, and the open-Gate-Entry alert measures
-- against it.
--
-- Overwriting timestamp_in with the device's clock is not the answer either
-- (CLAUDE.md 19). So hold both, and name the untrusted one for what it is.
--
-- The reconciliation sweep will measure from `least(timestamp_in, captured_at_device)`:
-- a genuine offline capture then alerts from when the material actually arrived, and a
-- device with a wrong clock cannot push its deadline into the future to silence it.
alter table public.gate_entry
  add column captured_at_device timestamptz;

comment on column public.gate_entry.captured_at_device is
  'What the capturing device believed the time was. Never authoritative — see timestamp_in. Held so an offline capture can be aged from the arrival rather than from the sync.';
