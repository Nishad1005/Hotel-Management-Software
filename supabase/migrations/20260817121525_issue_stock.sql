-- Gate 8 — zone to department.
--
-- This is where the chain becomes a chain (PRD section 4 Gate 8). Everything before it
-- records what the property received; this records who took it, and that is the leg an
-- audit actually leans on.
--
-- ---------------------------------------------------------------------------
-- What this build does NOT do, stated once and plainly
-- ---------------------------------------------------------------------------
--
-- Acceptance criterion 17 requires that no custody changes hands without a card scan:
-- the receiver presents a card, the storekeeper scans it, the person's photograph appears
-- and the storekeeper confirms the face. That is not met here. This build takes a TYPED
-- receiver name, which is an assertion by the storekeeper rather than proof of anybody's
-- identity.
--
-- So receipt_ack carries `verified_by_scan` and it is written false. When the staff master
-- and its cards land, the change is a value in a column rather than a migration, and
-- every issue recorded in the meantime is correctly marked as unverified rather than
-- silently indistinguishable from a real one. The register must not claim more than
-- happened — that is the whole of PRD section 2.

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------

create or replace function system.seed_property_departments(
  p_property_id   uuid,
  p_property_code text
)
returns void
language sql
security definer
set search_path = ''
as $$
  -- A starting set, not a fixed one. Every property adds its own — a resort has a pool
  -- bar and a spa, a city hotel has neither — and the point of seeding is that issuing
  -- works on day one rather than that this list is right.
  insert into public.location (property_id, code, name, kind, regime, fixture_type) values
    (p_property_id, p_property_code || '-DEPT-KIT',   'Main kitchen',      'DEPARTMENT', 'AMBIENT', 'Department'),
    (p_property_id, p_property_code || '-DEPT-BAKE',  'Bakery',            'DEPARTMENT', 'AMBIENT', 'Department'),
    (p_property_id, p_property_code || '-DEPT-BANQ',  'Banquet kitchen',   'DEPARTMENT', 'AMBIENT', 'Department'),
    (p_property_id, p_property_code || '-DEPT-FNB',   'F&B service',       'DEPARTMENT', 'AMBIENT', 'Department'),
    (p_property_id, p_property_code || '-DEPT-BAR',   'Bar',               'DEPARTMENT', 'AMBIENT', 'Department'),
    (p_property_id, p_property_code || '-DEPT-HK',    'Housekeeping',      'DEPARTMENT', 'AMBIENT', 'Department'),
    (p_property_id, p_property_code || '-DEPT-ENG',   'Engineering',       'DEPARTMENT', 'AMBIENT', 'Department'),
    (p_property_id, p_property_code || '-DEPT-STAFF', 'Staff cafeteria',   'DEPARTMENT', 'AMBIENT', 'Department')
  on conflict (property_id, code) do nothing;
$$;

revoke all on function system.seed_property_departments(uuid, text) from public, anon, authenticated;
grant execute on function system.seed_property_departments(uuid, text) to service_role;

create or replace function app.seed_new_property_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform system.seed_property_rules(new.id);
  perform system.seed_property_departments(new.id, new.code);
  return new;
end;
$$;

-- Replaces the rules-only trigger from the put-away migration. Everything a property
-- needs in order to work on its first morning hangs off one hook, because provisioning
-- has more than one entry point and the one that forgets is the one used at seven in the
-- evening to onboard a customer.
drop trigger if exists property_gets_default_rules on public.property;
drop function if exists app.seed_rules_for_new_property();

create trigger property_gets_defaults
  after insert on public.property
  for each row execute function app.seed_new_property_defaults();

select system.seed_property_departments(id, code) from public.property;

-- ---------------------------------------------------------------------------
-- The issue note
-- ---------------------------------------------------------------------------
--
-- Header and lines, the same shape as the GRN, because it is the same kind of object: a
-- document with a number that somebody may have to produce a year later. The movements
-- are not the document — they are what the document caused.

create table public.issue_note (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references public.property (id) on delete cascade,
  issue_no        text not null,
  -- A DEPARTMENT location. Enforced in issue_stock rather than by constraint, because a
  -- check constraint cannot look at another table.
  department_id   uuid not null,
  purpose         text,
  issued_at       timestamptz not null default now(),
  issued_by       uuid references auth.users (id) on delete set null,
  issued_by_name  text,
  idempotency_key text,
  created_at      timestamptz not null default now(),

  constraint issue_no_unique_per_property unique (property_id, issue_no),
  constraint issue_note_property_id_id_unique unique (property_id, id),
  constraint issue_note_department_fk
    foreign key (property_id, department_id) references public.location (property_id, id)
    on delete restrict
);

create index issue_note_property_id_idx on public.issue_note (property_id);
create index issue_note_department_idx on public.issue_note (property_id, department_id);

create unique index issue_note_idempotency_unique
  on public.issue_note (property_id, idempotency_key)
  where idempotency_key is not null;

create table public.issue_line (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.property (id) on delete cascade,
  issue_note_id uuid not null references public.issue_note (id) on delete cascade,
  batch_id      uuid not null,
  item_id       uuid not null,
  from_location_id uuid not null,
  qty           numeric(14, 4) not null check (qty > 0),
  uom_id        uuid not null,
  -- The expiry rule ships RECORD_ONLY (PRD section 8), so an expired batch can be issued.
  -- What must not happen is that it is issued and nobody can tell afterwards. This is the
  -- register that rule produces, and it is why the rule is worth having before anyone is
  -- willing to switch it to BLOCK.
  was_expired   boolean not null default false,
  days_remaining_at_issue integer,
  created_at    timestamptz not null default now(),

  constraint issue_line_batch_fk
    foreign key (property_id, batch_id) references public.batch (property_id, id)
    on delete restrict,
  constraint issue_line_item_fk
    foreign key (property_id, item_id) references public.item (property_id, id)
    on delete restrict,
  constraint issue_line_from_fk
    foreign key (property_id, from_location_id) references public.location (property_id, id)
    on delete restrict,
  constraint issue_line_uom_fk
    foreign key (property_id, uom_id) references public.uom (property_id, id)
    on delete restrict
);

create index issue_line_property_id_idx on public.issue_line (property_id);
create index issue_line_issue_note_id_idx on public.issue_line (issue_note_id);

-- ---------------------------------------------------------------------------
-- The acknowledgement
-- ---------------------------------------------------------------------------
--
-- PRD section 4 Gate 8: "the scan replaces the signature". A signature on an issue slip
-- identifies a scrawl; a card scan identifies a person, at a timestamp, against a
-- specific batch from a specific bin.
--
-- Both document columns exist from the start because the PRD names four places
-- scan-to-receive applies and dispatch is the next one built. Adding the second later
-- would be a migration against a table that already has rows, and rows on a compliance
-- register are the ones that cannot be reshaped casually.

create table public.receipt_ack (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid not null references public.property (id) on delete cascade,
  -- Composite, like every reference here, so an acknowledgement at one property cannot
  -- name another property's document. The nullable half is fine: a composite foreign key
  -- with any column null is satisfied by default, which is exactly the behaviour the
  -- unused subject needs.
  issue_note_id    uuid,
  dispatch_note_id uuid,

  -- What the storekeeper asserts. Never the proof.
  receiver_name    text not null check (length(trim(receiver_name)) > 0),
  -- The staff master, when there is one. Null is the honest answer today.
  receiver_person_id uuid,
  /**
   * False until a card is scanned, and never inferred.
   *
   * Acceptance criterion 17 is met when this is true and not before. It exists now so
   * that the issues recorded by this build are marked as unverified rather than becoming
   * indistinguishable from verified ones the day cards arrive.
   */
  verified_by_scan boolean not null default false,
  scan_method      public.scan_method,

  acknowledged_at  timestamptz not null default now(),
  recorded_by      uuid references auth.users (id) on delete set null,
  recorded_by_name text,

  constraint receipt_ack_issue_fk
    foreign key (property_id, issue_note_id) references public.issue_note (property_id, id)
    on delete cascade,
  constraint receipt_ack_dispatch_fk
    foreign key (property_id, dispatch_note_id) references public.dispatch_note (property_id, id)
    on delete cascade,
  constraint receipt_ack_has_one_subject check (
    (issue_note_id is not null)::int + (dispatch_note_id is not null)::int = 1
  ),
  -- A scan is a scan or it is not. A row claiming verification with no method recorded is
  -- the exact assertion this table exists to prevent.
  constraint receipt_ack_scan_has_a_method
    check (not verified_by_scan or scan_method is not null)
);

create index receipt_ack_property_id_idx on public.receipt_ack (property_id);
create unique index receipt_ack_one_per_issue on public.receipt_ack (issue_note_id)
  where issue_note_id is not null;
create unique index receipt_ack_one_per_dispatch on public.receipt_ack (dispatch_note_id)
  where dispatch_note_id is not null;

comment on table public.receipt_ack is
  'Who took custody. verified_by_scan is false until a card is scanned; a typed name is the storekeeper''s assertion, not the receiver''s identity. Acceptance criterion 17 is met when that column is true.';

-- ---------------------------------------------------------------------------
-- Grants and row level security
-- ---------------------------------------------------------------------------
--
-- Select only. Every write goes through issue_stock, which is the same arrangement as
-- the GRN and for the same reason: a document with a number cannot be assembled from
-- several client statements, because a half-written one is not correctable.

alter table public.issue_note  enable row level security;
alter table public.issue_line  enable row level security;
alter table public.receipt_ack enable row level security;

alter table public.issue_note  force row level security;
alter table public.issue_line  force row level security;
alter table public.receipt_ack force row level security;

create policy issue_note_select on public.issue_note
  for select to authenticated using (property_id in (select app.accessible_properties()));
create policy issue_line_select on public.issue_line
  for select to authenticated using (property_id in (select app.accessible_properties()));
create policy receipt_ack_select on public.receipt_ack
  for select to authenticated using (property_id in (select app.accessible_properties()));

grant select on public.issue_note, public.issue_line, public.receipt_ack to authenticated;
grant all on public.issue_note, public.issue_line, public.receipt_ack to service_role;

-- ---------------------------------------------------------------------------
-- What can be issued
-- ---------------------------------------------------------------------------

create or replace function public.list_issuable_stock(p_property_id uuid, p_item_id uuid default null)
returns table (
  batch_id       uuid,
  batch_no       text,
  item_id        uuid,
  item_name      text,
  item_code      text,
  is_perishable  boolean,
  uom_id         uuid,
  uom_code       text,
  location_id    uuid,
  location_code  text,
  location_name  text,
  qty            numeric,
  best_before    date,
  days_remaining integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    b.id, b.batch_no,
    i.id, i.name, i.code, i.is_perishable,
    u.id, u.code,
    l.id, l.code, l.name,
    sl.qty, b.best_before,
    case when b.best_before is null then null
         else (b.best_before - current_date)::int end
  from public.stock_lot sl
  join public.batch    b on b.id = sl.batch_id
  join public.item     i on i.id = b.item_id
  join public.uom      u on u.id = i.base_uom_id
  join public.location l on l.id = sl.location_id
  where sl.property_id = p_property_id
    and sl.state = 'AVAILABLE'
    and sl.qty > 0
    and (p_item_id is null or i.id = p_item_id)
  -- First expired, first out. Undated batches sort LAST rather than first: issuing stock
  -- with no known expiry ahead of stock about to expire is precisely backwards, and FEFO
  -- then degrades to FIFO among the undated rather than to something arbitrary. The same
  -- rule as sortByFefo in packages/domain, which is what the app applies — stated here
  -- too so a client that does not sort still behaves.
  order by b.best_before asc nulls last, b.created_at asc, i.name;
$$;

revoke all on function public.list_issuable_stock(uuid, uuid) from public, anon;
grant execute on function public.list_issuable_stock(uuid, uuid) to authenticated;

comment on function public.list_issuable_stock(uuid, uuid) is
  'AVAILABLE stock in FEFO order. Quarantine and reject hold are absent by construction — only put-away stock is issuable, which is what Gate 6 is for.';

-- ---------------------------------------------------------------------------
-- Issuing
-- ---------------------------------------------------------------------------

create or replace function public.issue_stock(
  p_property_id   uuid,
  p_department_id uuid,
  p_receiver_name text,
  p_purpose       text,
  p_idempotency_key text,
  p_lines         jsonb
)
returns table (issue_id uuid, issue_no text, expired_lines integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_id uuid;
  v_existing_no text;
  v_issue_id    uuid;
  v_issue_no    text;
  v_dept        public.location%rowtype;
  v_recorder    text;
  v_line        jsonb;
  v_index       integer := 0;
  v_expired     integer := 0;
  v_batch       public.batch%rowtype;
  v_item        public.item%rowtype;
  v_from        uuid;
  v_qty         numeric(14, 4);
  v_days        integer;
  v_was_expired boolean;
begin
  if not app.has_property_role(
       p_property_id,
       array['OWNER', 'ADMIN', 'STOREKEEPER']::public.membership_role[]
     ) then
    raise exception 'You do not have permission to issue stock at this property.'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'An issue needs a submission key, so a retry cannot record it twice.'
      using errcode = '23514';
  end if;

  select n.id, n.issue_no into v_existing_id, v_existing_no
    from public.issue_note n
   where n.property_id = p_property_id and n.idempotency_key = p_idempotency_key;

  if v_existing_id is not null then
    select count(*)::int into v_expired
      from public.issue_line where issue_note_id = v_existing_id and was_expired;
    return query select v_existing_id, v_existing_no, v_expired;
    return;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'An issue needs at least one line.' using errcode = '23514';
  end if;

  -- The concession, and the place it is checked. A blank name would leave a custody
  -- change with nobody attached to it, which is worse than the typed name being weak.
  if p_receiver_name is null or length(trim(p_receiver_name)) = 0 then
    raise exception 'Say who is taking it. Material does not change hands anonymously.'
      using errcode = '23514';
  end if;

  select * into v_dept from public.location
   where id = p_department_id and property_id = p_property_id;

  if not found then
    raise exception 'That department does not belong to this property.' using errcode = '42501';
  end if;

  if v_dept.kind <> 'DEPARTMENT' then
    raise exception '% is a %, not a department. Stock is issued to the department that consumes it.',
      v_dept.code, lower(v_dept.kind::text)
      using errcode = 'P0001';
  end if;

  select coalesce(nullif(trim(raw_user_meta_data ->> 'full_name'), ''), email)
    into v_recorder
    from auth.users where id = (select auth.uid());

  v_issue_no := app.next_document_number(p_property_id, 'ISSUE');

  insert into public.issue_note
    (property_id, issue_no, department_id, purpose, issued_by, issued_by_name, idempotency_key)
  values
    (p_property_id, v_issue_no, p_department_id, nullif(trim(coalesce(p_purpose, '')), ''),
     (select auth.uid()), v_recorder, p_idempotency_key)
  returning id into v_issue_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_index := v_index + 1;

    select * into v_batch from public.batch
     where id = (v_line ->> 'batch_id')::uuid and property_id = p_property_id;
    if not found then
      raise exception 'Line %: that batch does not belong to this property.', v_index
        using errcode = '42501';
    end if;

    -- Re-resolved against the property like everything else, even though the batch's own
    -- composite key already guarantees it. The guarantee is what makes this cheap, not
    -- what makes it unnecessary — SECURITY DEFINER has bypassed RLS by here.
    select * into v_item from public.item
     where id = v_batch.item_id and property_id = p_property_id;
    if not found then
      raise exception 'Line %: that item does not belong to this property.', v_index
        using errcode = '42501';
    end if;

    v_from := (v_line ->> 'from_location_id')::uuid;
    perform 1 from public.location where id = v_from and property_id = p_property_id;
    if not found then
      raise exception 'Line %: that location does not belong to this property.', v_index
        using errcode = '42501';
    end if;

    v_qty := (v_line ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Line % (%): say how much is going out.', v_index, v_item.name
        using errcode = '23514';
    end if;

    -- Recorded, not refused. EXPIRED_STOCK_CANNOT_ISSUE ships RECORD_ONLY, and a kitchen
    -- that cannot issue at seven in the morning will work around the system rather than
    -- around the expiry. What the system CAN insist on is that the fact survives.
    v_days := case when v_batch.best_before is null then null
                   else (v_batch.best_before - current_date)::int end;
    v_was_expired := v_days is not null and v_days < 0;
    if v_was_expired then v_expired := v_expired + 1; end if;

    insert into public.issue_line
      (property_id, issue_note_id, batch_id, item_id, from_location_id, qty, uom_id,
       was_expired, days_remaining_at_issue)
    values
      (p_property_id, v_issue_id, v_batch.id, v_item.id, v_from, v_qty, v_item.base_uom_id,
       v_was_expired, v_days);

    -- AVAILABLE at the bin becomes ISSUED at the department. Not a disappearance: the
    -- stock is still countable, still attributable to a batch, and still returnable to
    -- the store by the opposite movement (PRD section 4 Gate 8).
    perform app.move_stock(
      p_property_id, v_batch.id, v_item.id,
      v_from, 'AVAILABLE', p_department_id, 'ISSUED',
      v_qty, v_item.base_uom_id, 'ISSUE',
      p_idempotency_key || ':line:' || v_index
    );
  end loop;

  -- In the same transaction as the movements, deliberately. An issue is not closed until
  -- it is acknowledged (PRD section 4 Gate 8), and an acknowledgement written afterwards
  -- by a second call is one that can fail to arrive — leaving stock that has left the
  -- store with nobody's name against it.
  insert into public.receipt_ack
    (property_id, issue_note_id, receiver_name, verified_by_scan, recorded_by, recorded_by_name)
  values
    (p_property_id, v_issue_id, trim(p_receiver_name), false, (select auth.uid()), v_recorder);

  return query select v_issue_id, v_issue_no, v_expired;
end;
$$;

revoke all on function public.issue_stock(uuid, uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.issue_stock(uuid, uuid, text, text, text, jsonb) to authenticated;

comment on function public.issue_stock(uuid, uuid, text, text, text, jsonb) is
  'Gate 8. Moves AVAILABLE stock into ISSUED at a department and writes the acknowledgement in the same transaction. verified_by_scan is false: a typed receiver name is not a card scan, and criterion 17 is not met until it is.';
