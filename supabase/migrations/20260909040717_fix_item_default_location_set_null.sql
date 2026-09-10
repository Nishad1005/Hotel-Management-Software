-- ---------------------------------------------------------------------------
-- `item.default_location_id` — a composite set-null that would null the tenant
-- ---------------------------------------------------------------------------
--
-- `20260812102424` turned every foreign key composite so that a row could not reference
-- another property's (CLAUDE.md 4). One of them kept its original `on delete set null`:
--
--   add constraint item_default_location_fk
--     foreign key (property_id, default_location_id) references public.location (property_id, id)
--     on delete set null not valid;
--
-- Set-null nulls **every column in the key**. The intent was "the item's default location
-- went away, so it has no default"; what it says is "null property_id as well", and
-- `item.property_id` is `not null`. So deleting a `location` that is any item's default
-- fails on a not-null violation, and the error names `item` rather than the location the
-- caller was trying to remove.
--
-- Found by writing the same bug in `20260909032805` and having CI's pgTAP catch it there:
--
--   Failing row contains (a26a2d9d…, null, FA-CHILL, Cold room, ZONE, …)
--
-- **Unreachable today, and that is why it survived a year.** Nothing deletes a location —
-- `deactivate_location` sets `is_active = false`, deliberately, because stock does not
-- stop existing when a shelf is retired (ADR 0003). The one path that would reach it is
-- deleting a *property*: `location.property_id` and `item.property_id` both cascade from
-- `property`, and if the location rows go first while the item rows are still there, this
-- constraint fires and takes the whole deletion down with it. Nothing deletes properties
-- either, yet — churn is erasure and retention (ADR 0012), not `delete from property`.
--
-- Repaired rather than left, because "unreachable" is a statement about today's callers
-- and this is a statement about the schema.
--
-- ---------------------------------------------------------------------------
-- Why the column list rather than `restrict`
-- ---------------------------------------------------------------------------
--
-- `20260909032805` fixed its own instance with `on delete restrict` plus an explicit
-- update inside the one function that deletes a room. That is right there and wrong here,
-- and the difference is worth stating because the next person will reach for consistency:
--
--   * a room is deleted by exactly one function, so the ungrouping has an obvious home
--     and `restrict` turns a stray `DELETE` into a loud refusal.
--   * a location is deleted by nothing at all, so there is no function to put the update
--     in — and `restrict` would make the property-deletion cascade above fail *harder*
--     rather than fix it, refusing to remove a location any item defaults to.
--
-- So this keeps the original, correct intent and names the single column that may be
-- nulled. `on delete set null (column, …)` is Postgres 15+; this project is pinned to 17
-- (`supabase/config.toml`), and CI replays against the same major version, so a mismatch
-- would fail the migration in CI before it could reach production.

alter table public.item
  drop constraint item_default_location_fk,
  add constraint item_default_location_fk
    foreign key (property_id, default_location_id) references public.location (property_id, id)
    on delete set null (default_location_id);

-- Validated immediately rather than `not valid`: the rows already satisfy it — this
-- changes only what happens on a delete, never which rows are legal — so there is no
-- reason to leave the constraint unenforced for existing data.
alter table public.item validate constraint item_default_location_fk;

comment on constraint item_default_location_fk on public.item is
  'Composite so an item cannot default to another property''s location. The column list on set-null is load-bearing: without it, deleting a location nulls property_id too.';
