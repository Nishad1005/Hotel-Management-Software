-- Two prerequisites the whole flow waits on: who goods came from, and what to number
-- the paperwork.

-- ---------------------------------------------------------------------------
-- Document numbers
-- ---------------------------------------------------------------------------
--
-- Allocated server-side inside the transaction that uses them, under a row lock. That
-- is enough for receiving, issuing and dispatch, which happen at a dock with a network.
--
-- It is NOT enough for Gate 0, which must work with the boundary wall's signal — that
-- needs the offline block leasing of ADR 0005, and Gate 0 keeps its device-side number
-- until leasing lands. Two mechanisms is the honest answer here: an online allocator is
-- a few lines and correct, and pretending one design serves both cases is how the gate
-- ends up unable to capture when the network drops.

create type public.document_number_type as enum (
  'GATE_ENTRY',
  'GRN',
  'GATE_PASS',
  'DISPATCH_NOTE',
  'ISSUE',
  'PARTY'
);

create table public.number_sequence (
  property_id uuid not null references public.property (id) on delete cascade,
  doc_type    public.document_number_type not null,
  next_value  bigint not null default 1 check (next_value >= 1),
  updated_at  timestamptz not null default now(),

  primary key (property_id, doc_type)
);

alter table public.number_sequence enable row level security;
alter table public.number_sequence force row level security;

-- Readable so a screen can show how far a series has run; never writable from a client.
-- The only way the counter moves is through the allocator below, which is what makes
-- "sequential and immutable" (PRD section 4) true rather than aspirational.
create policy number_sequence_select on public.number_sequence
  for select to authenticated
  using (property_id in (select app.accessible_properties()));

grant select on public.number_sequence to authenticated;

comment on table public.number_sequence is
  'Per-property document counters. Advanced only by app.next_document_number; no write policy exists, deliberately.';

/**
 * The short form that appears in a number: SB-GRN-000042.
 *
 * Duplicated from packages/domain/src/gate/gate-entry.ts, which cannot be reached from
 * SQL. The server is the side that must be right, because a number written onto a
 * vendor's challan is permanent.
 */
create or replace function app.document_prefix(p_doc_type public.document_number_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_doc_type
    when 'GATE_ENTRY'    then 'GE'
    when 'GRN'           then 'GRN'
    when 'GATE_PASS'     then 'GP'
    when 'DISPATCH_NOTE' then 'DN'
    when 'ISSUE'         then 'ISS'
    when 'PARTY'         then 'VEN'
  end;
$$;

create or replace function app.next_document_number(
  p_property_id uuid,
  p_doc_type    public.document_number_type
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next bigint;
  v_code text;
begin
  select code into v_code from public.property where id = p_property_id;
  if v_code is null then
    raise exception 'That property does not exist.' using errcode = '42501';
  end if;

  -- Insert-then-update rather than upsert: the UPDATE takes the row lock, so two
  -- transactions allocating at the same moment queue rather than collide, and the
  -- second gets the next number instead of the same one.
  insert into public.number_sequence (property_id, doc_type)
  values (p_property_id, p_doc_type)
  on conflict (property_id, doc_type) do nothing;

  update public.number_sequence
     set next_value = next_value + 1, updated_at = now()
   where property_id = p_property_id and doc_type = p_doc_type
  returning next_value - 1 into v_next;

  if v_next is null then
    raise exception 'Could not allocate a number.' using errcode = 'P0001';
  end if;

  -- Padded to six for legibility, never truncated: the identity is the sequence, not
  -- its width, so a property that outgrows six digits keeps counting rather than
  -- wrapping.
  return v_code || '-' || app.document_prefix(p_doc_type) || '-' || lpad(v_next::text, 6, '0');
end;
$$;

revoke all on function app.next_document_number(uuid, public.document_number_type)
  from public, anon, authenticated;

comment on function app.next_document_number(uuid, public.document_number_type) is
  'Allocates the next document number under a row lock. Internal: called inside the RPC that uses the number, so allocation and use share a transaction and a rolled-back post does not burn a number.';

-- ---------------------------------------------------------------------------
-- Who the goods came from
-- ---------------------------------------------------------------------------
--
-- One entity with a type discriminator rather than a vendor table, because Terminal 2
-- needs to scan the laundry and the waste aggregator exactly as Terminal 1 scans the
-- vendor (PRD section 4 Gate 0b). A vendor-only table would be rebuilt the moment
-- dispatch arrives.
--
-- No QR cards in this MVP, and no check digit on the code yet. The check digit exists
-- so a TYPED code cannot be silently wrong, which only matters once there is a printed
-- card to type from. Nothing is printed yet, so codes can be renumbered at zero cost
-- when the cards land — that is deliberate, and the moment a card is printed it stops
-- being true.

create type public.party_type as enum (
  'VENDOR',
  'CONTRACTOR',
  'LAUNDRY',
  'AGGREGATOR',
  'CARRIER',
  'SISTER_PROPERTY'
);

create table public.party (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.property (id) on delete cascade,
  code          text not null,
  name          text not null check (length(trim(name)) > 0),
  party_type    public.party_type not null default 'VENDOR',
  phone         text,
  gstin         text,
  fssai_licence text,
  -- Shown in red at the gate before anything is unloaded. Status is resolved
  -- server-side at scan time precisely so it can change without reissuing a card.
  on_hold       boolean not null default false,
  hold_reason   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint party_code_unique_per_property unique (property_id, code),
  constraint party_property_id_id_unique unique (property_id, id),
  constraint party_hold_has_a_reason
    check (not on_hold or length(trim(coalesce(hold_reason, ''))) > 0)
);

create index party_property_id_idx on public.party (property_id);
-- Same shape as item_name_search_idx rather than trigram: pg_trgm is not enabled, and
-- turning on an extension for one index is a bigger decision than this index deserves.
create index party_name_search_idx on public.party using gin (to_tsvector('simple', name));

create trigger party_touch_updated_at
  before update on public.party
  for each row execute function app.touch_updated_at();

alter table public.party enable row level security;
alter table public.party force row level security;

create policy party_select on public.party
  for select to authenticated
  using (property_id in (select app.accessible_properties()));

-- Purchase owns the vendor relationship, so they own the record (PRD section 11).
create policy party_write on public.party
  for all to authenticated
  using (
    app.has_property_role(
      property_id, array['OWNER', 'ADMIN', 'PURCHASE']::public.membership_role[]
    )
  )
  with check (
    app.has_property_role(
      property_id, array['OWNER', 'ADMIN', 'PURCHASE']::public.membership_role[]
    )
  );

grant select, insert, update on public.party to authenticated;

comment on table public.party is
  'Every counterparty that transacts at a gate — vendors, contractors, laundry, waste aggregators, carriers, sister properties. One entity with a discriminator, because Terminal 2 scans the laundry exactly as Terminal 1 scans the vendor.';

-- ---------------------------------------------------------------------------
-- The three columns that have been dangling since the flow spine landed
-- ---------------------------------------------------------------------------
--
-- gate_entry.party_id, grn.party_id and dispatch_note.recipient_party_id have been bare
-- uuids with no foreign key, because there was no table to point at. Composite, like
-- every other reference here, so a gate entry at one property cannot name another
-- property's vendor.

alter table public.gate_entry
  add constraint gate_entry_party_fk
    foreign key (property_id, party_id) references public.party (property_id, id)
    on delete restrict not valid;
alter table public.gate_entry validate constraint gate_entry_party_fk;

alter table public.grn
  add constraint grn_party_fk
    foreign key (property_id, party_id) references public.party (property_id, id)
    on delete restrict not valid;
alter table public.grn validate constraint grn_party_fk;

alter table public.dispatch_note
  add constraint dispatch_note_recipient_party_fk
    foreign key (property_id, recipient_party_id) references public.party (property_id, id)
    on delete restrict not valid;
alter table public.dispatch_note validate constraint dispatch_note_recipient_party_fk;

-- ---------------------------------------------------------------------------
-- Who recorded it, in words
-- ---------------------------------------------------------------------------
--
-- `recorded_by` references auth.users with ON DELETE SET NULL, so deleting a user
-- silently erases the attribution on every movement they ever made. On an ordinary
-- table that is a tidy-up; on a compliance register that must answer "who received this
-- consignment" three years later, it is the register failing.
--
-- The name is snapshotted at write time and never updated afterwards. It records who
-- the person was when they acted, which is what an audit asks — not who they are now.
alter table public.stock_movement
  add column recorded_by_name text;

comment on column public.stock_movement.recorded_by_name is
  'The recorder''s name as it was at the moment of the movement. Denormalised on purpose: recorded_by is nulled when a user is deleted, and an audit trail that forgets who acted is not one.';
