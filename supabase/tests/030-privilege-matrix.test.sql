-- The privilege matrix, pinned.
--
-- Production shipped with Supabase's bootstrap default privileges granting ALL on
-- every public table to anon and authenticated — privileges no migration stated, which
-- CI's bare stack never had. So the suite's absent-grant assertions were CI-true and
-- production-false until 20260906023229 revoked the surplus. This file states the
-- matrix as catalog facts, which mean the same thing in both environments and fail
-- the moment anything — a future bootstrap, a well-meaning dashboard click replayed
-- into a migration — widens a role again.
--
-- No tenant fixture, deliberately: these are grants, not rows. RLS behaviour under
-- the two-orgs fixture is every other file's job.

begin;
select plan(23);

-- ---------------------------------------------------------------------------
-- anon holds nothing
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'),
  0,
  'anon holds not a single privilege on a public table — RLS is the wall, not the only wall'
);

-- ---------------------------------------------------------------------------
-- Append-only means no verb exists, not just no policy
-- ---------------------------------------------------------------------------

select ok(not has_table_privilege('authenticated', 'public.temperature_reading', 'UPDATE'),
  'a temperature reading cannot be updated — the refusal is a privilege error, loud');
select ok(not has_table_privilege('authenticated', 'public.temperature_reading', 'DELETE'),
  'nor deleted');
select ok(not has_table_privilege('authenticated', 'public.stock_movement', 'UPDATE'),
  'the ledger cannot be updated');
select ok(not has_table_privilege('authenticated', 'public.stock_movement', 'DELETE'),
  'nor thinned');
select ok(not has_table_privilege('authenticated', 'public.grn', 'UPDATE'),
  'a posted receipt cannot be edited — amendment is the only correction');
select ok(not has_table_privilege('authenticated', 'public.grn', 'INSERT'),
  'and only post_grn writes one at all');
select ok(not has_table_privilege('authenticated', 'public.gate_entry', 'DELETE'),
  'a gate entry can never be removed');

-- ---------------------------------------------------------------------------
-- The one narrow door: the vehicle leaving
-- ---------------------------------------------------------------------------

select ok(not has_table_privilege('authenticated', 'public.gate_entry', 'UPDATE'),
  'no table-wide update on gate entries');
select ok(has_column_privilege('authenticated', 'public.gate_entry', 'timestamp_out', 'UPDATE'),
  'except the departure time');
select ok(not has_column_privilege('authenticated', 'public.gate_entry', 'package_count', 'UPDATE'),
  'and nothing else, column by column');

-- ---------------------------------------------------------------------------
-- What work needs is still granted — the revoke must not over-reach
-- ---------------------------------------------------------------------------

select ok(has_table_privilege('authenticated', 'public.stock_movement', 'INSERT'),
  'stock is still recorded by the people doing the work');
select ok(has_table_privilege('authenticated', 'public.temperature_reading', 'INSERT'),
  'the round is still walked');
select ok(has_table_privilege('authenticated', 'public.item', 'UPDATE'),
  'masters are still edited from the app');
select ok(has_table_privilege('authenticated', 'public.party', 'UPDATE'),
  'a counterparty is still correctable');
select ok(not has_table_privilege('authenticated', 'public.party', 'DELETE'),
  'but never deletable — records hang off them');

-- ---------------------------------------------------------------------------
-- Server-owned tables stay server-owned
-- ---------------------------------------------------------------------------

select ok(not has_table_privilege('authenticated', 'public.number_lease', 'INSERT'),
  'leases are written only by lease_document_numbers');
select ok(not has_table_privilege('authenticated', 'public.rule_config', 'UPDATE'),
  'no client can ratchet an enforcement mode — PRD section 8, no UI to change it');

-- Module access is decided by the platform and by a property's own administrator,
-- through guarded functions. A client that could write these tables could sell itself
-- an add-on, or quietly widen its own access — the two failures the whole feature
-- exists to prevent.
select ok(not has_table_privilege('authenticated', 'public.module', 'INSERT'),
  'no client can invent a module');
select ok(not has_table_privilege('authenticated', 'public.property_module', 'INSERT'),
  'nor grant its own property one');
select ok(not has_table_privilege('authenticated', 'public.property_module', 'UPDATE'),
  'nor switch one back on');
select ok(not has_table_privilege('authenticated', 'public.member_module', 'INSERT'),
  'nor write a personal exception directly, bypassing the self-edit refusal');
select ok(not has_table_privilege('authenticated', 'public.member_module', 'DELETE'),
  'nor delete one');

select * from finish();
rollback;
