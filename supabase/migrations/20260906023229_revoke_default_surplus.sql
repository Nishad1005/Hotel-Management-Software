-- Production holds privileges the migrations never granted.
--
-- Found by testing, not by reading: a PATCH on temperature_reading as a signed-in
-- user returned 200 with zero rows instead of the 42501 that pgTAP 029 proves in CI.
-- Hosted Supabase bootstraps default privileges that grant ALL on new public tables
-- to anon and authenticated; the CI stack replays migrations into a database without
-- those defaults. Two consequences, both worth killing:
--
--   1. CI and production disagree on the privilege matrix, so every pgTAP assertion
--      about an absent grant proves something that is CI-true and production-false.
--   2. Where a table has no UPDATE/DELETE policy, the surplus privilege turns a loud
--      privilege refusal into RLS's silent zero-row denial — rule 4b's exact quiet
--      failure. No data was reachable (RLS held everywhere, verified: anon reads []
--      on every table, the gate_entry trigger refused edits loudly), but the app's
--      defence was one layer thinner than the repo believed.
--
-- The fix: strip both roles to nothing, then restate the intended grants verbatim.
-- The restatement's completeness is proven by CI itself — its stack only ever had
-- the stated grants, so a grant forgotten here fails the existing suite.

-- ---------------------------------------------------------------------------
-- 1. anon holds nothing on tenant tables
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- 2. authenticated: to zero, then exactly the stated matrix
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from authenticated;

-- Everyone signed in can read what RLS shows them.
grant select on
  public.organisation, public.property, public.membership,
  public.uom, public.item_category, public.location, public.item, public.item_pack,
  public.rule_config, public.party,
  public.batch, public.gate_entry, public.grn, public.grn_line,
  public.dispatch_note, public.dispatch_line, public.gate_pass,
  public.returnable_item, public.stock_movement, public.stock_lot,
  public.issue_note, public.issue_line, public.receipt_ack,
  public.number_sequence, public.number_lease,
  public.temperature_reading
to authenticated;

-- Masters are edited from the app (policies restrict to OWNER/ADMIN).
grant insert, update, delete on
  public.uom, public.item_category, public.location, public.item, public.item_pack
to authenticated;

-- Counterparties: created and corrected, never deleted — records hang off them.
grant insert, update on public.party to authenticated;

-- The append-only paths: the ledger, its batches, the gate spine, the temperature
-- register. INSERT is the only verb these ever get.
grant insert on
  public.batch, public.stock_movement, public.gate_entry, public.temperature_reading
to authenticated;

-- The one column that may move after creation: the vehicle leaving. The trigger
-- app.gate_entry_is_append_only remains the rule itself; this is the narrow door.
grant update (timestamp_out) on public.gate_entry to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Future tables start bare, as they already do in CI
-- ---------------------------------------------------------------------------
--
-- Global, not IN SCHEMA: per-schema default privileges are additive and cannot
-- subtract from a global bootstrap grant. This runs as the migration role, so it
-- affects only tables that role creates — which is every table in this repo, and
-- nothing Supabase creates internally as supabase_admin. In CI it revokes defaults
-- that were never granted, which is a no-op, and that is the point: after this,
-- both environments hand a new table zero privileges until a migration states them —
-- the number_lease lesson (grant-or-CI-fails) now holds in production too.

alter default privileges revoke all on tables from anon, authenticated;
