-- ---------------------------------------------------------------------------
-- The staff master — PRD section 4 Gate 8, "Staff identity". Criteria 17 and 19.
-- ---------------------------------------------------------------------------
--
-- Every person who can receive material carries a card. The card identifies them; it
-- does not sign them in. That distinction is the whole point of a separate table:
-- stewards, commis and housekeeping attendants will never hold app credentials, and a
-- design that made identity depend on a login would leave the largest group of people
-- who take custody of material with no verifiable identity at all.
--
-- `receipt_ack` has carried `receiver_person_id` and `verified_by_scan` since issuing was
-- built, with a comment saying null was the honest answer until a staff master existed.
-- This is that master. Wiring the scan into `issue_stock` is the next migration; this one
-- establishes who exists and what their number is.
--
-- ## The card number
--
-- `TW-EMP-04270` — the property's code, the person series, a four-digit sequence, and a
-- Damm check digit. Damm rather than Luhn because it catches every adjacent transposition
-- as well as every single-digit substitution, and a transposition is exactly what a
-- person reading a number aloud produces.
--
-- The check digit is computed here AND in packages/domain, which is a rule expressed
-- twice and therefore needs both copies tested (CLAUDE.md). The server generates codes
-- because only it holds the sequence; the device validates a scan offline because at the
-- dock there may be no network. Neither side can be dropped, so the guard is
-- `032-person-master.test.sql`, which asserts this function's output for the same fixed
-- vectors the TypeScript suite asserts. If the two ever diverge, that test fails rather
-- than a storekeeper meeting a card the server minted and the app rejects.

-- ---------------------------------------------------------------------------
-- Check digit
-- ---------------------------------------------------------------------------

/**
 * The Damm operation table, flattened row-major into a 100-element array.
 *
 * Immutable and deterministic, so it may be used in a generated column or an index if a
 * later migration wants one.
 */
create or replace function app.damm_check_digit(p_digits text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  -- Row-major: t[row * 10 + col + 1], one-based because Postgres arrays are.
  t constant integer[] := array[
    0,3,1,7,5,9,8,6,4,2,
    7,0,9,2,1,5,4,8,6,3,
    4,2,0,6,8,7,1,3,5,9,
    1,7,5,0,9,8,3,4,2,6,
    6,1,2,3,0,4,5,9,7,8,
    3,6,7,4,2,0,9,5,8,1,
    5,8,6,9,7,2,0,1,3,4,
    8,9,4,5,3,6,2,0,1,7,
    9,4,3,8,6,1,7,2,0,5,
    2,5,8,1,4,3,6,7,9,0
  ];
  v_interim integer := 0;
  v_char    text;
  v_digit   integer;
begin
  if p_digits is null or p_digits !~ '^[0-9]+$' then
    raise exception 'A check digit needs digits, got %', coalesce(p_digits, '<null>')
      using errcode = '22023';
  end if;

  for i in 1 .. length(p_digits) loop
    v_char := substr(p_digits, i, 1);
    v_digit := v_char::integer;
    v_interim := t[v_interim * 10 + v_digit + 1];
  end loop;

  return v_interim;
end;
$$;

comment on function app.damm_check_digit(text) is
  'Damm check digit. Mirrored by dammCheckDigit in packages/domain; 032 tests both against the same vectors.';

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

create table public.person (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.property (id) on delete cascade,

  -- The printed card number. Immutable once issued: a reissued card carries the same
  -- number (PRD "reissue on loss without changing the ID"), because the number is the
  -- person's identity in every record that already references them.
  person_code text not null,
  -- Kept alongside the code so the series can be reasoned about without parsing, and so
  -- the uniqueness that actually matters is enforced on the number, not the string.
  person_seq  integer not null check (person_seq >= 1),

  full_name   text not null check (length(trim(full_name)) > 0),

  -- Where they work. A location of kind DEPARTMENT; nullable because contract and agency
  -- staff frequently belong to no department on the property's own chart.
  department_id uuid,

  /**
   * The photograph, when there is one.
   *
   * Criterion 18 — the receiver's photograph displays on scan, from cache, with no
   * network — needs an image store this build does not yet have. The column exists now
   * so that people created before photographs arrive do not have to be re-created after,
   * and so the absence is visible as a null rather than as a missing concept.
   */
  photo_ref   text,

  /**
   * The login, where the person has one. Identity is not access.
   *
   * Most card-holders will never have a row here. A subset are also app users, and the
   * card links to that user rather than the other way round — because the population of
   * people who take custody of material is much larger than the population who sign in,
   * and modelling it the other way would exclude exactly the people the control is for.
   */
  user_id     uuid references auth.users (id) on delete set null,

  is_active   boolean not null default true,
  deactivated_at timestamptz,
  deactivated_by uuid references auth.users (id) on delete set null,
  deactivated_reason text,

  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,

  constraint person_code_unique_per_property unique (property_id, person_code),
  constraint person_seq_unique_per_property unique (property_id, person_seq),
  -- So other tables can reference a person with a composite tenant key (CLAUDE.md 4).
  constraint person_property_id_id_unique unique (property_id, id),
  constraint person_department_same_property
    foreign key (property_id, department_id) references public.location (property_id, id),
  -- A deactivation that is not dated cannot be audited, and "when did their card stop
  -- working" is the first question anyone asks about a card that stopped working.
  constraint person_deactivation_is_dated
    check (is_active or deactivated_at is not null)
);

comment on table public.person is
  'The staff master. A card identifies a person; it does not sign them in. PRD section 4 Gate 8.';

create index person_by_property on public.person (property_id) where is_active;
create index person_by_department on public.person (property_id, department_id) where is_active;

-- `receipt_ack.receiver_person_id` has been waiting for this table since issuing was
-- built. Composite, so an acknowledgement at one property cannot name another's person.
alter table public.receipt_ack
  add constraint receipt_ack_person_same_property
  foreign key (property_id, receiver_person_id) references public.person (property_id, id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.person enable row level security;

/**
 * Everyone at the property can read the staff master.
 *
 * Deliberately not narrowed to administrators. The storekeeper's device caches this list
 * so a card scans with no network (PRD "the staff master, with photographs, is cached on
 * the storekeeper's device"), and a policy that only administrators could read would put
 * the cache out of reach of the one role that needs it.
 *
 * `accessible_properties()` is the idiom every other read policy in this schema uses.
 * The first draft invented a null role array to mean "any role", which reads plausibly
 * and denies everyone: `has_property_role` ends in `m.role = any(allowed)`, and
 * `= any(NULL)` is NULL, so the EXISTS is false for every member. Nothing errored — the
 * table simply looked empty to its own owner.
 */
create policy person_read on public.person
  for select to authenticated
  using (property_id in (select app.accessible_properties()));

-- No insert, update or delete policy, and no table grants for them below. Every write
-- goes through the functions in this migration, which is what makes deactivation
-- something that can be reasoned about rather than something any client could set.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.person from public, anon, authenticated;
grant select on public.person to authenticated;

-- ---------------------------------------------------------------------------
-- Issuing a card
-- ---------------------------------------------------------------------------

/**
 * Adds a person and mints their card number.
 *
 * The sequence is taken under a row lock on the property so two administrators adding
 * staff at once cannot mint the same number. A gap is legal and survivable; a duplicate
 * is not, because the number is the identity every later record hangs off.
 */
create or replace function public.create_person(
  p_property_id   uuid,
  p_full_name     text,
  p_department_id uuid default null,
  p_user_id       uuid default null
)
returns table (person_id uuid, person_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop_code text;
  v_seq       integer;
  v_padded    text;
  v_code      text;
  v_id        uuid;
begin
  perform app.require_module(p_property_id, 'MASTERS');

  -- Master data, not logins: this is the same authority that edits items and locations.
  -- USERS would be the wrong gate, because the point of the staff master is the people
  -- who will never have a login at all.
  if not app.has_property_role(
       p_property_id,
       array['OWNER', 'ADMIN']::public.membership_role[]
     ) then
    raise exception 'Only an owner or administrator can add people to the staff master.'
      using errcode = '42501';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'A card needs a name on it.' using errcode = '23514';
  end if;

  select code into v_prop_code
    from public.property
   where id = p_property_id
     for update;

  if v_prop_code is null then
    raise exception 'That property does not exist.' using errcode = '42501';
  end if;

  select coalesce(max(p.person_seq), 0) + 1 into v_seq
    from public.person p
   where p.property_id = p_property_id;

  if v_seq > 9999 then
    raise exception
      'The four-digit staff series is exhausted at this property. Widening it is a decision about printed cards, not a default.'
      using errcode = '23514';
  end if;

  v_padded := lpad(v_seq::text, 4, '0');
  v_code := v_prop_code || '-EMP-' || v_padded || app.damm_check_digit(v_padded)::text;

  insert into public.person
    (property_id, person_code, person_seq, full_name, department_id, user_id, created_by)
  values
    (p_property_id, v_code, v_seq, trim(p_full_name), p_department_id, p_user_id,
     (select auth.uid()))
  returning id into v_id;

  return query select v_id, v_code;
end;
$$;

revoke all on function public.create_person(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.create_person(uuid, text, uuid, uuid) to authenticated;

comment on function public.create_person(uuid, text, uuid, uuid) is
  'Adds a person to the staff master and mints their card number. PRD section 4 Gate 8.';

-- ---------------------------------------------------------------------------
-- Deactivation — criterion 19
-- ---------------------------------------------------------------------------

/**
 * Stops a card working, server-side and immediately.
 *
 * Criterion 19 in one statement. Contract, agency and daily-wage staff turn over quickly,
 * and a card revoked on exit has to stop working before the person reaches the gate —
 * which means the check has to be a read of this row at scan time, not a flag copied onto
 * a device that may not sync for hours.
 *
 * The row is never deleted. A person who has taken custody of material is referenced by
 * every acknowledgement they signed for, and deleting them would either orphan those
 * records or cascade away the accountability the register exists to hold.
 */
create or replace function public.set_person_active(
  p_property_id uuid,
  p_person_id   uuid,
  p_active      boolean,
  p_reason      text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- A row count, not a flag. The first draft declared this boolean, so `get diagnostics`
  -- assigned an integer to it and the comparison below put a boolean against one:
  -- "no operator matches", raised from inside the function at the moment a card was
  -- being stopped.
  v_rows integer;
begin
  perform app.require_module(p_property_id, 'MASTERS');

  if not app.has_property_role(
       p_property_id,
       array['OWNER', 'ADMIN']::public.membership_role[]
     ) then
    raise exception 'Only an owner or administrator can change who holds a card.'
      using errcode = '42501';
  end if;

  if not p_active and (p_reason is null or length(trim(p_reason)) = 0) then
    raise exception 'Say why the card is being stopped. A revocation with no reason cannot be reviewed.'
      using errcode = '23514';
  end if;

  update public.person
     set is_active = p_active,
         deactivated_at = case when p_active then null else now() end,
         deactivated_by = case when p_active then null else (select auth.uid()) end,
         deactivated_reason = case when p_active then null else trim(p_reason) end
   where property_id = p_property_id
     and id = p_person_id;

  get diagnostics v_rows = row_count;

  -- CLAUDE.md 4b: RLS refuses an update silently, so zero rows is a permission failure
  -- as often as it is a missing row, and both must be loud.
  if v_rows = 0 then
    raise exception 'That person is not on this property''s staff master.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.set_person_active(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.set_person_active(uuid, uuid, boolean, text) to authenticated;

comment on function public.set_person_active(uuid, uuid, boolean, text) is
  'Stops or restores a card, server-side and immediately. Criterion 19. Never deletes the person.';

-- ---------------------------------------------------------------------------
-- Reading the master, and reading a card
-- ---------------------------------------------------------------------------

/**
 * The whole staff master for a property, for the device to cache.
 *
 * Returns inactive people too, and says so in a column. A device holding only the active
 * list would show "no such card" for a revoked one, which reads as a damaged card and
 * invites a retry; "this card was stopped" is the answer that ends the conversation at
 * the counter.
 */
create or replace function public.list_people(p_property_id uuid)
returns table (
  id uuid,
  person_code text,
  full_name text,
  department_id uuid,
  department_name text,
  photo_ref text,
  has_login boolean,
  is_active boolean,
  deactivated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.person_code, p.full_name, p.department_id, l.name,
         p.photo_ref, p.user_id is not null, p.is_active, p.deactivated_at
    from public.person p
    left join public.location l
      on l.property_id = p.property_id and l.id = p.department_id
   where p.property_id = p_property_id
     and p_property_id in (select app.accessible_properties())
   order by p.person_seq;
$$;

revoke all on function public.list_people(uuid) from public, anon;
grant execute on function public.list_people(uuid) to authenticated;

comment on function public.list_people(uuid) is
  'The staff master, including stopped cards so a revoked one reads as stopped rather than unknown.';
