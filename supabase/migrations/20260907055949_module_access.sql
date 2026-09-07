-- Module access — the platform decides what a customer holds, the customer decides
-- who inside it may use each part. Both must pass.
--
-- golaiv1 shipped this and recorded the lesson its migration 0017 exists for: "module
-- access was a UI guard — the sidebar and routes respected it, but a crafted API call
-- could still reach the data". So this migration puts the check in the database, on
-- the same write paths the role checks already guard, and the client only ever reads
-- back an answer it did not compute.
--
-- ## Default-on, and why that is provable
--
-- A base module with no explicit row is ENABLED. That makes this migration a no-op for
-- every property that exists today, and the proof is CI: the whole pgTAP suite runs
-- against a database where these wrappers are in the path, and every existing flow test
-- still passes. Same argument the privilege migration used — the tests are the
-- equivalence proof, not the comment.
--
-- The opposite reading is available per module: `requires_licence` flips a module to
-- opt-in, so an add-on (procurement, IoT temperature) is blocked until it is sold.
-- One table, two readings, chosen per row. Taken from golaiv1 0026, which called this
-- the single best schema decision it made — it is what made rewriting the universal
-- guard safe.
--
-- ## Reads are deliberately NOT gated
--
-- Registers, stock views and traces stay readable to anyone whose role already sees
-- them. The product's claim is the audit trail; a property that switches DISPATCH off
-- must still be able to show an inspector what it dispatched last year. golaiv1 gated
-- reads in its 0063 and had to document that the ledger became partial and the on-hand
-- balance no longer equalled the sum of visible movements. We are not buying that.
--
-- Module-off therefore means: the screen is not offered, and the writes are refused.

-- ---------------------------------------------------------------------------
-- 1. The registry
-- ---------------------------------------------------------------------------
--
-- Global rather than per-property, and so the only table here without `property_id`.
-- It holds no tenant data — it is the list of things the product is made of, closer to
-- an enum than to a record, and `property_module` below is where a tenant meets it.
-- RLS is on with a read-all policy so the sweep in 001 stays meaningful.

create table public.module (
  key              text primary key check (key ~ '^[A-Z][A-Z_]{1,31}$'),
  label            text not null check (length(trim(label)) > 0),
  -- Who may use this module when nobody has said otherwise. Must be a SUPERSET of the
  -- role arrays of every RPC and policy the module gates: the module's person check is
  -- ANDed with those, so a role missing here would be silently narrowed out of a screen
  -- the server would otherwise let them use.
  default_roles    public.membership_role[] not null check (array_length(default_roles, 1) > 0),
  -- false: a base module, on unless switched off (deny-list).
  -- true:  an add-on, off until sold (allow-list).
  requires_licence boolean not null default false,
  sort             integer not null unique
);

comment on table public.module is
  'What the product is made of. Global, not tenant data: property_module is where a customer meets it.';
comment on column public.module.requires_licence is
  'false = base module, enabled unless explicitly switched off. true = add-on, disabled until explicitly granted. The one column that decides whether a customer row is a deny-list or an allow-list entry.';

alter table public.module enable row level security;
alter table public.module force row level security;

create policy module_select on public.module
  for select to authenticated using (true);

grant select on public.module to authenticated;
grant all on public.module to service_role;

-- The eleven flow areas. `default_roles` mirrors who can reach each area today, so
-- turning the feature on changes nothing until somebody chooses otherwise.
insert into public.module (key, label, default_roles, requires_licence, sort) values
  ('GATE',        'Gate',
   array['OWNER', 'ADMIN', 'GM', 'SECURITY']::public.membership_role[], false, 10),
  ('RECEIVING',   'Receiving',
   array['OWNER', 'ADMIN', 'GM', 'STOREKEEPER', 'CHEF', 'FSO', 'PURCHASE', 'BANQUET', 'AUDITOR']::public.membership_role[], false, 20),
  ('PUTAWAY',     'Put away',
   array['OWNER', 'ADMIN', 'STOREKEEPER']::public.membership_role[], false, 30),
  ('ISSUE',       'Issue',
   array['OWNER', 'ADMIN', 'STOREKEEPER']::public.membership_role[], false, 40),
  ('DISPATCH',    'Dispatch',
   array['OWNER', 'ADMIN', 'STOREKEEPER', 'PURCHASE', 'FSO', 'BANQUET']::public.membership_role[], false, 50),
  ('RETURNABLES', 'Returnables',
   array['OWNER', 'ADMIN', 'GM', 'SECURITY', 'STOREKEEPER', 'CHEF', 'FSO', 'PURCHASE', 'BANQUET', 'AUDITOR']::public.membership_role[], false, 60),
  ('TEMPERATURE', 'Temperature rounds',
   array['OWNER', 'ADMIN', 'STOREKEEPER', 'FSO']::public.membership_role[], false, 70),
  ('STOCK',       'Stock',
   array['OWNER', 'ADMIN', 'GM', 'STOREKEEPER', 'CHEF', 'FSO', 'PURCHASE', 'BANQUET', 'AUDITOR']::public.membership_role[], false, 80),
  ('REGISTERS',   'FSSAI registers',
   array['OWNER', 'ADMIN', 'GM', 'STOREKEEPER', 'CHEF', 'FSO', 'PURCHASE', 'BANQUET', 'AUDITOR']::public.membership_role[], false, 90),
  ('MASTERS',     'Master data',
   array['OWNER', 'ADMIN', 'PURCHASE']::public.membership_role[], false, 100),
  ('USERS',       'Logins and roles',
   array['OWNER', 'ADMIN']::public.membership_role[], false, 110);

-- ---------------------------------------------------------------------------
-- 2. What a customer holds
-- ---------------------------------------------------------------------------

create table public.property_module (
  property_id uuid not null references public.property (id) on delete cascade,
  module_key  text not null references public.module (key) on delete restrict,
  enabled     boolean not null,
  -- 'bundled', 'paid add-on', 'trial to 31-Mar', 'switched off at their request'.
  note        text,
  changed_by  uuid references auth.users (id) on delete set null,
  changed_at  timestamptz not null default now(),

  primary key (property_id, module_key)
);

comment on table public.property_module is
  'Explicit per-customer decisions. Absence is not "off" — see module.requires_licence. Written only by the platform RPCs; no client holds a write privilege.';

create index property_module_property_id_idx on public.property_module (property_id);

alter table public.property_module enable row level security;
alter table public.property_module force row level security;

-- A property may see what it holds, because the navigation is built from it. Nobody
-- writes it from the app: a customer cannot sell themselves a module.
create policy property_module_select on public.property_module
  for select to authenticated
  using (property_id in (select app.accessible_properties()));

grant select on public.property_module to authenticated;
grant all on public.property_module to service_role;

-- ---------------------------------------------------------------------------
-- 3. Who inside the customer may use it
-- ---------------------------------------------------------------------------
--
-- Narrowing only. A row here can take a module away from one person; it cannot hand
-- one to somebody whose role would be refused by the server anyway. That asymmetry is
-- deliberate — golaiv1's override could widen, which put modules into the navigation
-- of people whose role could not open them, and they clicked through to a screen the
-- server refused. Here the person check is `role default AND (override or absent)`, so
-- what is offered can never exceed what is allowed.

create table public.member_module (
  property_id uuid not null references public.property (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  module_key  text not null references public.module (key) on delete restrict,
  -- false takes the module away from this person. true is the explicit "not
  -- restricted" state — it grants nothing their role does not already carry.
  allowed     boolean not null,
  changed_by  uuid references auth.users (id) on delete set null,
  changed_at  timestamptz not null default now(),

  primary key (property_id, user_id, module_key)
);

comment on table public.member_module is
  'Per-person exceptions inside one property. Narrowing only: `allowed = false` removes access, `true` is merely explicit. Written only through set_member_module.';

create index member_module_property_id_idx on public.member_module (property_id);

alter table public.member_module enable row level security;
alter table public.member_module force row level security;

-- Your own restrictions, or anyone's if you administer the property.
create policy member_module_select on public.member_module
  for select to authenticated
  using (
    (property_id in (select app.accessible_properties()) and user_id = (select auth.uid()))
    or app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[])
  );

grant select on public.member_module to authenticated;
grant all on public.member_module to service_role;

-- ---------------------------------------------------------------------------
-- 4. The two questions
-- ---------------------------------------------------------------------------
--
-- Split deliberately. "Has this customer bought it" and "may this person open it" are
-- different questions with different answers and different error messages, and the
-- platform console asks only the first.

create or replace function app.property_has_module(p_property_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select pm.enabled
       from public.property_module pm
      where pm.property_id = p_property_id and pm.module_key = p_key),
    -- No explicit row: a base module is on, an add-on is off. An unknown key resolves
    -- to `not true` = false, so a typo denies rather than grants.
    not coalesce((select m.requires_licence from public.module m where m.key = p_key), true)
  );
$$;

comment on function app.property_has_module(uuid, text) is
  'Whether this property holds the module at all. The commercial question, asked without reference to who is asking.';

create or replace function app.has_module_access(p_property_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app.property_has_module(p_property_id, p_key)
    and coalesce(
      (select app.has_property_role(p_property_id, m.default_roles)
         from public.module m where m.key = p_key),
      false
    )
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
  'Customer licence AND role default AND the absence of a personal restriction. All three must pass — switching a module off for a property removes it for everyone there, whatever their personal settings say.';

create or replace function app.require_module(p_property_id uuid, p_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.has_module_access(p_property_id, p_key) then
    return;
  end if;

  -- Two different sentences, because they send the reader to two different people.
  if not app.property_has_module(p_property_id, p_key) then
    raise exception '% is not switched on for this property. Your administrator can ask us to enable it.',
      coalesce((select m.label from public.module m where m.key = p_key), p_key)
      using errcode = '42501';
  end if;

  raise exception 'You do not have access to % here.',
    coalesce((select m.label from public.module m where m.key = p_key), p_key)
    using errcode = '42501';
end;
$$;

revoke all on function app.property_has_module(uuid, text) from public, anon;
revoke all on function app.has_module_access(uuid, text) from public, anon;
revoke all on function app.require_module(uuid, text) from public, anon;
grant execute on function app.property_has_module(uuid, text) to authenticated;
grant execute on function app.has_module_access(uuid, text) to authenticated;
grant execute on function app.require_module(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Every key this migration is about to hard-code must exist
-- ---------------------------------------------------------------------------
--
-- A key that is not in `module` makes has_module_access() false for everybody, which
-- would take a screen away from every user of every property and raise nothing. A
-- typo in the wrappers below is exactly that mistake, so it fails here instead —
-- golaiv1 0063's guard, which it added after reasoning through the same hazard.

do $$
declare
  v_missing text;
begin
  select string_agg(k, ', ') into v_missing
  from unnest(array[
    'GATE', 'RECEIVING', 'PUTAWAY', 'ISSUE', 'DISPATCH', 'RETURNABLES',
    'TEMPERATURE', 'STOCK', 'REGISTERS', 'MASTERS', 'USERS'
  ]) as k
  where not exists (select 1 from public.module m where m.key = k);

  if v_missing is not null then
    raise exception 'Cannot gate on module keys that do not exist: %', v_missing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. The write RPCs learn the check
-- ---------------------------------------------------------------------------
--
-- Each function is renamed to *_impl, taken away from clients, and replaced by a
-- wrapper of the identical signature that asks the module question first. The
-- alternative — editing nine function bodies — would have meant reproducing several
-- hundred lines of working transaction logic in this migration to change one line of
-- each, and every one of those lines is a chance to change something else by accident.
--
-- The rename is guarded on *_impl already existing. Without that guard a second run
-- would rename the WRAPPER to _impl and build an infinite recursion, which is how
-- golaiv1 recorded this hazard.

do $$
declare
  f record;
begin
  for f in select * from (values
    ('post_grn',               'uuid, uuid, uuid, text, jsonb'),
    ('amend_grn',              'uuid, uuid, text, text, jsonb'),
    ('put_away',               'uuid, uuid, uuid, text, numeric, public.scan_method, text'),
    ('issue_stock',            'uuid, uuid, text, text, text, jsonb'),
    ('stage_for_dispatch',     'uuid, public.dispatch_type, uuid, text, boolean, date, text, jsonb'),
    ('issue_gate_pass',        'uuid, uuid, text, text, integer, text'),
    ('record_return',          'uuid, uuid, numeric, text'),
    ('lease_document_numbers', 'uuid, public.document_number_type, text, integer'),
    ('deactivate_location',    'uuid, uuid')
  ) as t(fname, fargs) loop
    if to_regprocedure('public.' || f.fname || '_impl(' || f.fargs || ')') is null then
      execute format('alter function public.%I(%s) rename to %I',
                     f.fname, f.fargs, f.fname || '_impl');
    end if;
  end loop;
end $$;

revoke all on function public.post_grn_impl(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.amend_grn_impl(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.put_away_impl(uuid, uuid, uuid, text, numeric, public.scan_method, text)
  from public, anon, authenticated;
revoke all on function public.issue_stock_impl(uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.stage_for_dispatch_impl(uuid, public.dispatch_type, uuid, text, boolean, date, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.issue_gate_pass_impl(uuid, uuid, text, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.record_return_impl(uuid, uuid, numeric, text)
  from public, anon, authenticated;
revoke all on function public.lease_document_numbers_impl(uuid, public.document_number_type, text, integer)
  from public, anon, authenticated;
revoke all on function public.deactivate_location_impl(uuid, uuid)
  from public, anon, authenticated;

-- Every wrapper is SECURITY DEFINER because the implementation it calls is now
-- unreachable by the caller's own privileges. `auth.uid()` still reads the caller's
-- JWT, so the role and module checks inside are answered about the real user.
--
-- Results are returned with an explicit table alias rather than `select *`: the
-- RETURNS TABLE columns are also plpgsql variables, and an unqualified reference to
-- one is ambiguous.

create or replace function public.post_grn(
  p_property_id     uuid,
  p_gate_entry_id   uuid,
  p_party_id        uuid,
  p_idempotency_key text,
  p_lines           jsonb
)
returns table (grn_id uuid, grn_no text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_module(p_property_id, 'RECEIVING');
  return query
    select r.grn_id, r.grn_no
      from public.post_grn_impl(p_property_id, p_gate_entry_id, p_party_id,
                                p_idempotency_key, p_lines) as r;
end;
$$;

create or replace function public.amend_grn(
  p_property_id     uuid,
  p_grn_id          uuid,
  p_reason          text,
  p_idempotency_key text,
  p_lines           jsonb
)
returns table (grn_id uuid, grn_no text, adjusted_lines integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_module(p_property_id, 'RECEIVING');
  return query
    select r.grn_id, r.grn_no, r.adjusted_lines
      from public.amend_grn_impl(p_property_id, p_grn_id, p_reason,
                                 p_idempotency_key, p_lines) as r;
end;
$$;

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
begin
  perform app.require_module(p_property_id, 'PUTAWAY');
  return query
    select r.movement_id, r.to_location_id, r.to_location_code, r.remaining
      from public.put_away_impl(p_property_id, p_batch_id, p_from_location_id,
                                p_to_location_code, p_qty, p_scan_method,
                                p_idempotency_key) as r;
end;
$$;

create or replace function public.issue_stock(
  p_property_id     uuid,
  p_department_id   uuid,
  p_receiver_name   text,
  p_purpose         text,
  p_idempotency_key text,
  p_lines           jsonb
)
returns table (issue_id uuid, issue_no text, expired_lines integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_module(p_property_id, 'ISSUE');
  return query
    select r.issue_id, r.issue_no, r.expired_lines
      from public.issue_stock_impl(p_property_id, p_department_id, p_receiver_name,
                                   p_purpose, p_idempotency_key, p_lines) as r;
end;
$$;

create or replace function public.stage_for_dispatch(
  p_property_id         uuid,
  p_dispatch_type       public.dispatch_type,
  p_recipient_party_id  uuid,
  p_reason_code         text,
  p_is_returnable       boolean,
  p_expected_return_date date,
  p_idempotency_key     text,
  p_lines               jsonb
)
returns table (dispatch_id uuid, dispatch_no text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_module(p_property_id, 'DISPATCH');
  return query
    select r.dispatch_id, r.dispatch_no
      from public.stage_for_dispatch_impl(p_property_id, p_dispatch_type,
                                          p_recipient_party_id, p_reason_code,
                                          p_is_returnable, p_expected_return_date,
                                          p_idempotency_key, p_lines) as r;
end;
$$;

create or replace function public.issue_gate_pass(
  p_property_id     uuid,
  p_dispatch_note_id uuid,
  p_carrier         text,
  p_vehicle_number  text,
  p_package_count   integer,
  p_idempotency_key text
)
returns table (gate_pass_id uuid, gate_pass_no text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_module(p_property_id, 'GATE');
  return query
    select r.gate_pass_id, r.gate_pass_no
      from public.issue_gate_pass_impl(p_property_id, p_dispatch_note_id, p_carrier,
                                       p_vehicle_number, p_package_count,
                                       p_idempotency_key) as r;
end;
$$;

create or replace function public.record_return(
  p_property_id   uuid,
  p_returnable_id uuid,
  p_qty           numeric,
  p_condition     text
)
returns table (qty_out numeric, qty_returned numeric, outstanding numeric)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_module(p_property_id, 'RETURNABLES');
  return query
    select r.qty_out, r.qty_returned, r.outstanding
      from public.record_return_impl(p_property_id, p_returnable_id, p_qty,
                                     p_condition) as r;
end;
$$;

create or replace function public.lease_document_numbers(
  p_property_id uuid,
  p_doc_type    public.document_number_type,
  p_device_id   text,
  p_count       integer
)
returns table (range_start bigint, range_end bigint, property_code text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_module(p_property_id, 'GATE');
  return query
    select r.range_start, r.range_end, r.property_code
      from public.lease_document_numbers_impl(p_property_id, p_doc_type, p_device_id,
                                              p_count) as r;
end;
$$;

create or replace function public.deactivate_location(
  p_property_id uuid,
  p_location_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_module(p_property_id, 'MASTERS');
  perform public.deactivate_location_impl(p_property_id, p_location_id);
end;
$$;

revoke all on function public.post_grn(uuid, uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.amend_grn(uuid, uuid, text, text, jsonb) from public, anon;
revoke all on function public.put_away(uuid, uuid, uuid, text, numeric, public.scan_method, text) from public, anon;
revoke all on function public.issue_stock(uuid, uuid, text, text, text, jsonb) from public, anon;
revoke all on function public.stage_for_dispatch(uuid, public.dispatch_type, uuid, text, boolean, date, text, jsonb) from public, anon;
revoke all on function public.issue_gate_pass(uuid, uuid, text, text, integer, text) from public, anon;
revoke all on function public.record_return(uuid, uuid, numeric, text) from public, anon;
revoke all on function public.lease_document_numbers(uuid, public.document_number_type, text, integer) from public, anon;
revoke all on function public.deactivate_location(uuid, uuid) from public, anon;

grant execute on function public.post_grn(uuid, uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.amend_grn(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.put_away(uuid, uuid, uuid, text, numeric, public.scan_method, text) to authenticated;
grant execute on function public.issue_stock(uuid, uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.stage_for_dispatch(uuid, public.dispatch_type, uuid, text, boolean, date, text, jsonb) to authenticated;
grant execute on function public.issue_gate_pass(uuid, uuid, text, text, integer, text) to authenticated;
grant execute on function public.record_return(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.lease_document_numbers(uuid, public.document_number_type, text, integer) to authenticated;
grant execute on function public.deactivate_location(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. User administration asks the same question, in one place
-- ---------------------------------------------------------------------------
--
-- `can_manage_users` is already the single point every user-administration path
-- consults — grant_role, revoke_role and the create-user edge function all defer to
-- it rather than re-deciding. Adding the module here therefore covers all of them,
-- and there is no second copy of the rule to fall out of step.

create or replace function public.can_manage_users(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_property_role(
           p_property_id, array['OWNER', 'ADMIN']::public.membership_role[]
         )
     and app.has_module_access(p_property_id, 'USERS');
$$;

-- ---------------------------------------------------------------------------
-- 8. The direct-write policies
-- ---------------------------------------------------------------------------
--
-- The tables an app user writes without going through an RPC. Each predicate keeps
-- its previous definition verbatim and gains the module term, and each is quoted
-- above its replacement so a single policy can be reversed by hand without reading
-- this file's history.
--
-- Policy denial on INSERT raises, so these stay loud. The UPDATE policies here
-- (gate_entry_close, the masters) are the quiet case rule 4b warns about — which is
-- why the RPC guards above are the primary mechanism and these are the backstop.

-- was: with check (app.has_property_role(property_id, array['OWNER','ADMIN','SECURITY']))
drop policy gate_entry_insert on public.gate_entry;
create policy gate_entry_insert on public.gate_entry
  for insert to authenticated
  with check (
    app.has_property_role(
      property_id, array['OWNER', 'ADMIN', 'SECURITY']::public.membership_role[]
    )
    and app.has_module_access(property_id, 'GATE')
  );

-- was: using/with check (app.has_property_role(property_id, array['OWNER','ADMIN','SECURITY']))
drop policy gate_entry_close on public.gate_entry;
create policy gate_entry_close on public.gate_entry
  for update to authenticated
  using (
    app.has_property_role(
      property_id, array['OWNER', 'ADMIN', 'SECURITY']::public.membership_role[]
    )
    and app.has_module_access(property_id, 'GATE')
  )
  with check (
    app.has_property_role(
      property_id, array['OWNER', 'ADMIN', 'SECURITY']::public.membership_role[]
    )
    and app.has_module_access(property_id, 'GATE')
  );

-- was: with check (app.has_property_role(property_id, array['OWNER','ADMIN','STOREKEEPER','FSO']))
drop policy temperature_reading_insert on public.temperature_reading;
create policy temperature_reading_insert on public.temperature_reading
  for insert to authenticated
  with check (
    app.has_property_role(
      property_id,
      array['OWNER', 'ADMIN', 'STOREKEEPER', 'FSO']::public.membership_role[]
    )
    and app.has_module_access(property_id, 'TEMPERATURE')
  );

-- The opening-stock path — the only way a client writes the ledger directly. The flow
-- RPCs are SECURITY DEFINER and bypass RLS entirely, so their module check is the
-- wrapper above, not this.
--
-- was: with check (app.has_property_role(property_id, array['OWNER','ADMIN','STOREKEEPER']))
drop policy batch_insert on public.batch;
create policy batch_insert on public.batch
  for insert to authenticated
  with check (
    app.has_property_role(
      property_id, array['OWNER', 'ADMIN', 'STOREKEEPER']::public.membership_role[]
    )
    and app.has_module_access(property_id, 'STOCK')
  );

-- was: with check (app.has_property_role(property_id, array['OWNER','ADMIN','STOREKEEPER']))
drop policy stock_movement_insert on public.stock_movement;
create policy stock_movement_insert on public.stock_movement
  for insert to authenticated
  with check (
    app.has_property_role(
      property_id, array['OWNER', 'ADMIN', 'STOREKEEPER']::public.membership_role[]
    )
    and app.has_module_access(property_id, 'STOCK')
  );

-- The masters. All five carried the identical OWNER/ADMIN predicate.
-- was: using/with check (app.has_property_role(property_id, array['OWNER','ADMIN']))
drop policy uom_write on public.uom;
create policy uom_write on public.uom
  for all to authenticated
  using (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[])
         and app.has_module_access(property_id, 'MASTERS'))
  with check (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[])
              and app.has_module_access(property_id, 'MASTERS'));

drop policy item_category_write on public.item_category;
create policy item_category_write on public.item_category
  for all to authenticated
  using (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[])
         and app.has_module_access(property_id, 'MASTERS'))
  with check (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[])
              and app.has_module_access(property_id, 'MASTERS'));

drop policy location_write on public.location;
create policy location_write on public.location
  for all to authenticated
  using (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[])
         and app.has_module_access(property_id, 'MASTERS'))
  with check (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[])
              and app.has_module_access(property_id, 'MASTERS'));

drop policy item_write on public.item;
create policy item_write on public.item
  for all to authenticated
  using (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[])
         and app.has_module_access(property_id, 'MASTERS'))
  with check (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[])
              and app.has_module_access(property_id, 'MASTERS'));

drop policy item_pack_write on public.item_pack;
create policy item_pack_write on public.item_pack
  for all to authenticated
  using (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[])
         and app.has_module_access(property_id, 'MASTERS'))
  with check (app.has_property_role(property_id, array['OWNER', 'ADMIN']::public.membership_role[])
              and app.has_module_access(property_id, 'MASTERS'));

-- was: using/with check (app.has_property_role(property_id, array['OWNER','ADMIN','PURCHASE']))
drop policy party_write on public.party;
create policy party_write on public.party
  for all to authenticated
  using (
    app.has_property_role(
      property_id, array['OWNER', 'ADMIN', 'PURCHASE']::public.membership_role[]
    )
    and app.has_module_access(property_id, 'MASTERS')
  )
  with check (
    app.has_property_role(
      property_id, array['OWNER', 'ADMIN', 'PURCHASE']::public.membership_role[]
    )
    and app.has_module_access(property_id, 'MASTERS')
  );

-- ---------------------------------------------------------------------------
-- 9. The platform's side
-- ---------------------------------------------------------------------------
--
-- Guarded by the platform-admin check, exactly as list_tenants and
-- set_property_lifecycle are, and for the reason stated there: "all properties or
-- none, depending who asks" is a different question from "which may this user see",
-- and widening an RLS predicate to answer it is how a cross-tenant leak gets shipped.

create or replace function public.platform_list_property_modules(p_property_id uuid)
returns table (
  module_key       text,
  label            text,
  requires_licence boolean,
  enabled          boolean,
  is_explicit      boolean,
  note             text,
  changed_at       timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.key,
    m.label,
    m.requires_licence,
    coalesce(pm.enabled, not m.requires_licence),
    pm.property_id is not null,
    pm.note,
    pm.changed_at
  from public.module m
  left join public.property_module pm
    on pm.module_key = m.key and pm.property_id = p_property_id
  where app.is_platform_admin()
  order by m.sort;
$$;

comment on function public.platform_list_property_modules(uuid) is
  'The effective module grid for one customer, explicit rows marked as such so the console can offer a reset. Returns nothing at all to a caller who is not platform staff.';

create or replace function public.platform_set_property_module(
  p_property_id uuid,
  p_module_key  text,
  p_enabled     boolean,
  p_note        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Only platform staff can change what a customer holds.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.property where id = p_property_id) then
    raise exception 'No such property.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.module where key = p_module_key) then
    raise exception 'No such module: %.', p_module_key using errcode = '22023';
  end if;

  insert into public.property_module
    (property_id, module_key, enabled, note, changed_by, changed_at)
  values
    (p_property_id, p_module_key, coalesce(p_enabled, true), p_note,
     (select auth.uid()), now())
  on conflict (property_id, module_key) do update
    set enabled    = excluded.enabled,
        note       = coalesce(excluded.note, public.property_module.note),
        changed_by = excluded.changed_by,
        changed_at = now();
end;
$$;

create or replace function public.platform_reset_property_module(
  p_property_id uuid,
  p_module_key  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Only platform staff can change what a customer holds.'
      using errcode = '42501';
  end if;

  -- No affected-count check here, deliberately, and this is the one place in the
  -- schema where rule 4b does not apply: "there was no explicit row" and "the explicit
  -- row is now gone" are the same end state, which is exactly what the caller asked
  -- for. A count check could only ever pass.
  delete from public.property_module
   where property_id = p_property_id and module_key = p_module_key;
end;
$$;

revoke all on function public.platform_list_property_modules(uuid) from public, anon;
revoke all on function public.platform_set_property_module(uuid, text, boolean, text) from public, anon;
revoke all on function public.platform_reset_property_module(uuid, text) from public, anon;
grant execute on function public.platform_list_property_modules(uuid) to authenticated;
grant execute on function public.platform_set_property_module(uuid, text, boolean, text) to authenticated;
grant execute on function public.platform_reset_property_module(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. What the app asks
-- ---------------------------------------------------------------------------

create or replace function public.my_module_access(p_property_id uuid)
returns table (module_key text, allowed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.key, app.has_module_access(p_property_id, m.key)
  from public.module m
  where p_property_id in (select app.accessible_properties())
  order by m.sort;
$$;

comment on function public.my_module_access(uuid) is
  'Every module with whether the caller may open it here. The navigation reads this rather than recomputing the rule, so the app can only ever offer what the server would allow.';

create or replace function public.list_member_modules(p_property_id uuid)
returns table (
  user_id     uuid,
  module_key  text,
  allowed     boolean,
  is_override boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  -- `app.has_property_role` cannot serve here: it answers about the caller, and this
  -- function is asked about everybody else. The role default is therefore computed as
  -- an array overlap against the roles that person actually holds at this property.
  select
    u.user_id,
    m.key,
    app.property_has_module(p_property_id, m.key)
      and (u.roles && m.default_roles)
      and coalesce(mm.allowed, true)
      as allowed,
    mm.user_id is not null
  from (
    select ms.user_id, array_agg(ms.role) as roles
      from public.membership ms
     where ms.property_id = p_property_id
     group by ms.user_id
  ) u
  cross join public.module m
  left join public.member_module mm
    on mm.property_id = p_property_id and mm.user_id = u.user_id and mm.module_key = m.key
  where public.can_manage_users(p_property_id)
  order by u.user_id, m.sort;
$$;

comment on function public.list_member_modules(uuid) is
  'Every person at the property against every module, with the effective answer and whether a personal restriction is what produced it.';

create or replace function public.set_member_module(
  p_property_id uuid,
  p_user_id     uuid,
  p_module_key  text,
  p_allowed     boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_users(p_property_id) then
    raise exception 'You do not have permission to change access at this property.'
      using errcode = '42501';
  end if;

  -- The classic hole, and golaiv1 found it the hard way: without this an administrator
  -- can quietly widen their own access, and the audit trail shows them doing it to
  -- themselves.
  if p_user_id = (select auth.uid()) then
    raise exception 'You cannot change your own access.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.membership
     where user_id = p_user_id and property_id = p_property_id
  ) then
    raise exception 'That person does not work at this property.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.module where key = p_module_key) then
    raise exception 'No such module: %.', p_module_key using errcode = '22023';
  end if;

  -- Null clears the exception and returns the person to their role's default.
  if p_allowed is null then
    delete from public.member_module
     where property_id = p_property_id
       and user_id = p_user_id
       and module_key = p_module_key;
    return;
  end if;

  insert into public.member_module
    (property_id, user_id, module_key, allowed, changed_by, changed_at)
  values
    (p_property_id, p_user_id, p_module_key, p_allowed, (select auth.uid()), now())
  on conflict (property_id, user_id, module_key) do update
    set allowed    = excluded.allowed,
        changed_by = excluded.changed_by,
        changed_at = now();
end;
$$;

revoke all on function public.my_module_access(uuid) from public, anon;
revoke all on function public.list_member_modules(uuid) from public, anon;
revoke all on function public.set_member_module(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.my_module_access(uuid) to authenticated;
grant execute on function public.list_member_modules(uuid) to authenticated;
grant execute on function public.set_member_module(uuid, uuid, text, boolean) to authenticated;
