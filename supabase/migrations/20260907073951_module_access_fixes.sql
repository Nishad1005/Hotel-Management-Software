-- Two things the module-access migration got wrong, both found by the tests written to
-- find them.

-- ---------------------------------------------------------------------------
-- 1. The module check was answering a question that was not its own
-- ---------------------------------------------------------------------------
--
-- `has_module_access` included a role limb — does this person's role appear in
-- `module.default_roles` — and because `require_module` runs as the first statement of
-- every wrapper, that limb answered before the implementation's own role check could.
-- The refusal was still correct; the sentence was not:
--
--   a storekeeper leasing gate numbers  → "You do not have access to Gate here."
--                              instead of "Not permitted to lease numbers for this property."
--   another property's admin recording a return
--                                       → "You do not have access to Returnables here."
--                              instead of "You do not have permission to record returns
--                                          at this property."
--
-- The second is the one that settles it. That administrator's problem is not the
-- module — it is that this is not their property — and a message that misnames the
-- reason sends them to the wrong person to fix it.
--
-- Underneath the messages was the real defect: `module.default_roles` and the role array
-- inside each RPC were the same rule written twice, and the copy that fired first was
-- the one with less to say. So the limb comes out. The module now answers only the two
-- questions that belong to it — did this customer buy it, and has this person been
-- restricted — and roles keep being answered where they already were: the role array in
-- each function, and `ROUTE_CAPABILITY` in the navigation.
--
-- Nothing is weakened by this. A storekeeper still cannot lease gate numbers; they are
-- now told why correctly.

create or replace function app.has_module_access(p_property_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app.property_has_module(p_property_id, p_key)
    -- Narrowing only, so this limb defaults to true when no row says otherwise.
    and coalesce(
      (select mm.allowed
         from public.member_module mm
        where mm.property_id = p_property_id
          and mm.user_id = (select auth.uid())
          and mm.module_key = p_key),
      true
    );
$$;

comment on function app.has_module_access(uuid, text) is
  'Whether this module is open to the caller here: the customer holds it, and nobody has restricted this person. Deliberately does NOT ask whether their role does the job — that is asked by the role array inside each function, which gives a better answer and is the only copy of that rule. Do not add a default_roles limb here; it was removed for exactly that reason.';

-- `module.default_roles` survives, and is now used by one caller only:
-- `list_member_modules`, to show an administrator who would hold a module anyway. That
-- is a display composition, not the enforcement rule.
comment on column public.module.default_roles is
  'Who would ordinarily use this module. Read by list_member_modules to compose what an administrator sees, NOT by has_module_access — enforcement of who does which job lives in each function''s own role array.';

-- The visible consequence, stated so it does not read as a bug later: this now answers
-- true for GATE to a storekeeper, because the property holds Gate and nobody restricted
-- them personally. It is not a leak. The navigation still hides the screen — every route
-- passes `ROUTE_CAPABILITY` as well — and `lease_document_numbers` still refuses them by
-- role. "Is this module open here" and "is this your job" are different questions, and
-- this function only answers the first.
comment on function public.my_module_access(uuid) is
  'Every module with whether it is open to the caller at this property — the customer''s licence and any personal restriction, resolved. Not a statement about their role: the navigation pairs this with ROUTE_CAPABILITY, and every write function checks its own roles. A module can be open to somebody whose job does not include it.';

-- ---------------------------------------------------------------------------
-- 2. The three new tables were born with grants for anon
-- ---------------------------------------------------------------------------
--
-- `20260906023229_revoke_default_surplus.sql` ended with:
--
--     alter default privileges revoke all on tables from anon, authenticated;
--
-- and claimed that future tables would start bare. They did not: `module`,
-- `property_module` and `member_module` arrived holding privileges for anon, and the
-- sweep in 030 caught it on the first new table since.
--
-- Postgres keys default privileges by (grantor role, schema). A statement with no
-- `IN SCHEMA` writes a row for schema NULL, which is a DIFFERENT row from Supabase's
-- `IN SCHEMA public` entry — so that revoke matched nothing and cancelled nothing. The
-- clause has been dead since it was written; only the accompanying sweep of existing
-- tables made the test pass, and nothing exercised the claim until a table was added.
--
-- That is the same shape as the lesson already in CLAUDE.md: a check that cannot fail
-- proves nothing. The assertion was fine — it was the mechanism behind it that had
-- never run.

-- Repairs the three tables that already have them. Idempotent, and safe to reapply:
-- anon is meant to hold nothing anywhere in this schema, so there is nothing to restate.
revoke all on all tables in schema public from anon;

-- And prevents the next one. Scoped to `public`, which is the row Postgres actually
-- consults when a table is created there.
--
-- `authenticated` is included because the same reasoning applies to it, and it is safe:
-- its matrix is stated table by table in 20260906023229 and in every migration since,
-- so a future table starting bare is precisely the intended behaviour — the same
-- discipline that made `number_lease` fail CI until its grant was written down.
alter default privileges in schema public revoke all on tables from anon, authenticated;
