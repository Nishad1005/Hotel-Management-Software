-- ---------------------------------------------------------------------------
-- The evidence vault — PRD section 7.2, "every photo and document, every gate".
-- ---------------------------------------------------------------------------
--
-- One store, because there is one requirement wearing three hats. Criterion 8 wants a
-- photograph on every cold-chain line. Criterion 18 wants the receiver's face on screen
-- when their card is scanned. Section 7.2 wants an evidence vault an inspector can be
-- walked through. All three need the same machinery — bytes under 400 KB, addressed by
-- content, immutable once written, with a date they stop being kept — and building it
-- three times would produce three sets of retention rules for one hotel's obligations.
--
-- `gate_entry.bill_photo_ref` and `person.photo_ref` have been bare text columns waiting
-- for this. They stay text: what they hold is a document id, and making them foreign keys
-- would mean a photograph could not be attached before the row it belongs to exists,
-- which is the wrong way round for a camera.
--
-- ## Content-addressed, and why that matters here
--
-- The storage key is the SHA-256 of the bytes. Three consequences, all wanted:
--
--   - the same photograph attached twice is stored once
--   - a file cannot be swapped for another without the address changing, so "this is the
--     photograph taken at the dock that morning" is a checkable claim rather than a
--     filename somebody trusted
--   - an upload interrupted and retried lands on the same key, so a flapping connection
--     at the gate produces one object rather than four orphans
--
-- ## What is deliberately NOT here
--
-- No deletion. Retention is recorded as a date and swept by a later job that has to be
-- written with an eye on what the register still references; a cascade that quietly
-- removed the photograph an inspector is asking about would be worse than keeping it too
-- long. `retention_until` exists now so the clock starts from the first photograph rather
-- than from the day somebody remembers to add the column.

-- ---------------------------------------------------------------------------
-- What a document can be attached to, and what it is
-- ---------------------------------------------------------------------------

/**
 * Polymorphic by design, following the PRD's `DocumentAttachment`.
 *
 * A real foreign key per subject would mean a table with eight nullable columns and eight
 * check constraints, and it would still not stop a photograph naming another property's
 * row. The tenant key does that instead: `property_id` is on the document, and the attach
 * function checks the subject belongs to the same property before writing.
 */
create type public.document_entity as enum (
  'GATE_ENTRY',
  'GRN_LINE',
  'PERSON',
  'TEMPERATURE_READING',
  'DISPATCH_NOTE',
  'RECEIPT_ACK'
);

create type public.document_kind as enum (
  'BILL',                -- the vendor's challan, photographed at the gate
  'COLD_CHAIN',          -- the probe reading, criterion 8
  'STAFF_PHOTO',         -- the face on the card, criterion 18
  'CONDITION',           -- damage, on a rejection or a returnable coming back
  'COLLECTION_RECEIPT'   -- the aggregator's receipt for waste or used cooking oil
);

create table public.document (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.property (id) on delete cascade,

  entity_type public.document_entity not null,
  entity_id   uuid not null,
  kind        public.document_kind not null,

  /** SHA-256 of the bytes, lowercase hex. The address, not a checksum kept beside one. */
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  /** Where it sits in the bucket: `{property_id}/{sha256}`. Derived, stored for clarity. */
  storage_key text not null,

  mime_type   text not null check (mime_type in ('image/jpeg', 'image/webp', 'application/pdf')),

  /*
    PRD section 13 says photos are compressed client-side to under 400 KB. That is a
    client rule until it is also a server one — a device with an older build, or a caller
    that skips the compression step, would otherwise put a four-megabyte original into a
    gate device's sync queue on a 4G connection at the weakest point on the property.
  */
  byte_size   integer not null check (byte_size > 0 and byte_size <= 409600),

  captured_at timestamptz not null default now(),
  captured_by uuid references auth.users (id) on delete set null,

  /**
   * The date this stops being kept.
   *
   * Required, because a photograph with no end date is a decision nobody made. Staff
   * photographs are personal data under the DPDP Act 2023 (PRD section 10) and cannot be
   * kept indefinitely; flow evidence has to outlive an FSSAI inspection cycle. The
   * defaults are in `attach_document` and are a starting point to confirm with the
   * property's own counsel, not a legal opinion.
   */
  retention_until date not null,

  created_at  timestamptz not null default now(),

  -- Content-addressed: the same bytes attached to the same subject twice are one row, so
  -- a retried upload is idempotent rather than a duplicate.
  constraint document_unique_per_subject unique (property_id, entity_type, entity_id, sha256)
);

comment on table public.document is
  'The evidence vault. Content-addressed, immutable, with a retention date. PRD section 7.2.';

create index document_by_subject on public.document (property_id, entity_type, entity_id);
create index document_by_retention on public.document (retention_until);

-- ---------------------------------------------------------------------------
-- Immutable
-- ---------------------------------------------------------------------------

/**
 * A document is written once.
 *
 * The grants below withhold UPDATE and DELETE, which is the real control. This trigger is
 * the second copy of that rule, and it exists because the grants protect against clients
 * while the trigger also protects against a future migration that adds a well-meaning
 * "fix the mime type" statement. Evidence that can be edited is not evidence.
 */
create or replace function app.document_is_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A document cannot be % once written. Attach a new one; the old one stays.',
    lower(tg_op)
    using errcode = '42501';
end;
$$;

create trigger document_no_update
  before update or delete on public.document
  for each row execute function app.document_is_immutable();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.document enable row level security;

create policy document_read on public.document
  for select to authenticated
  using (property_id in (select app.accessible_properties()));

revoke all on public.document from public, anon, authenticated;
grant select on public.document to authenticated;

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------

/*
  Private. A public bucket would make every staff photograph and every vendor bill
  readable by anyone holding the URL, which for a table containing faces is not a
  configuration choice but a breach waiting for somebody to find the pattern.
*/
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 409600,
        array['image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 409600,
      allowed_mime_types = array['image/jpeg', 'image/webp', 'application/pdf'];

/*
  The first path segment is the property, and that is what the policies check.

  `{property_id}/{sha256}`: a member of a property can read and write inside their own
  prefix and nowhere else. Objects are never updated or deleted through these policies —
  content addressing means a changed file is a different object, and retention is a
  separate sweep that has to consider what still references the row.
*/
drop policy if exists evidence_read on storage.objects;
create policy evidence_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidence'
    and (storage.foldername(name))[1]::uuid in (select app.accessible_properties())
  );

drop policy if exists evidence_write on storage.objects;
create policy evidence_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'evidence'
    and (storage.foldername(name))[1]::uuid in (select app.accessible_properties())
  );

-- ---------------------------------------------------------------------------
-- Attaching
-- ---------------------------------------------------------------------------

/**
 * Records a document against something, after checking that something is ours.
 *
 * The upload happens first, straight to storage under the policies above; this writes the
 * row that makes the object findable and gives it a retention date. Doing it in this order
 * means an interrupted capture leaves an orphan object rather than a row pointing at
 * nothing — and an orphan object is invisible, whereas a dangling row is a photograph an
 * inspector is told exists.
 */
create or replace function public.attach_document(
  p_property_id  uuid,
  p_entity_type  public.document_entity,
  p_entity_id    uuid,
  p_kind         public.document_kind,
  p_sha256       text,
  p_mime_type    text,
  p_byte_size    integer,
  p_retention_until date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid;
  v_exists   boolean;
  v_until    date;
begin
  if not app.has_property_role(
       p_property_id,
       array['OWNER', 'ADMIN', 'GM', 'STOREKEEPER', 'SECURITY', 'CHEF', 'FSO']::public.membership_role[]
     ) then
    raise exception 'You cannot attach evidence at this property.' using errcode = '42501';
  end if;

  /*
    The subject has to exist AND belong here.

    Polymorphism costs a case statement; the alternative is a photograph filed against
    another property's gate entry, which would surface as evidence appearing in the wrong
    hotel's register. Each branch is a tenant-scoped existence check, nothing more.
  */
  v_exists := case p_entity_type
    when 'GATE_ENTRY' then exists (
      select 1 from public.gate_entry where property_id = p_property_id and id = p_entity_id)
    when 'GRN_LINE' then exists (
      select 1 from public.grn_line l join public.grn g on g.id = l.grn_id
       where g.property_id = p_property_id and l.id = p_entity_id)
    when 'PERSON' then exists (
      select 1 from public.person where property_id = p_property_id and id = p_entity_id)
    when 'TEMPERATURE_READING' then exists (
      select 1 from public.temperature_reading where property_id = p_property_id and id = p_entity_id)
    when 'DISPATCH_NOTE' then exists (
      select 1 from public.dispatch_note where property_id = p_property_id and id = p_entity_id)
    when 'RECEIPT_ACK' then exists (
      select 1 from public.receipt_ack where property_id = p_property_id and id = p_entity_id)
  end;

  if not coalesce(v_exists, false) then
    raise exception 'There is nothing here to attach that to.' using errcode = '42501';
  end if;

  /*
    Retention defaults, and they are defaults rather than law.

    A staff photograph is personal data and is kept while it is useful and not longer —
    one year past capture, refreshed whenever a new photograph is taken. Flow evidence has
    to survive an inspection asking about last season, so two years. Both are starting
    points for the property's counsel to confirm, which is why the caller can override
    them and why the column is not nullable.
  */
  v_until := coalesce(
    p_retention_until,
    case p_kind
      when 'STAFF_PHOTO' then (current_date + interval '1 year')::date
      else (current_date + interval '2 years')::date
    end
  );

  insert into public.document
    (property_id, entity_type, entity_id, kind, sha256, storage_key,
     mime_type, byte_size, captured_by, retention_until)
  values
    (p_property_id, p_entity_type, p_entity_id, p_kind, lower(trim(p_sha256)),
     p_property_id::text || '/' || lower(trim(p_sha256)),
     p_mime_type, p_byte_size, (select auth.uid()), v_until)
  /*
    The retry case: the same bytes against the same subject, filed twice.

    `do nothing` rather than `do update`, and the difference is not stylistic. An upsert
    fires a BEFORE UPDATE, and the immutability trigger on this table refuses those —
    absolutely, on purpose, so that no statement anywhere can edit evidence. My own
    upsert was the first thing it caught. That is the guarantee behaving correctly, and
    the fix is for the retry to stop trying to write at all.
  */
  on conflict (property_id, entity_type, entity_id, sha256) do nothing
  returning id into v_id;

  -- `do nothing` returns no row when it collided, so the existing document is the answer.
  if v_id is null then
    select d.id into v_id
      from public.document d
     where d.property_id = p_property_id
       and d.entity_type = p_entity_type
       and d.entity_id = p_entity_id
       and d.sha256 = lower(trim(p_sha256));
  end if;

  return v_id;
end;
$$;

revoke all on function public.attach_document(uuid, public.document_entity, uuid,
  public.document_kind, text, text, integer, date) from public, anon;
grant execute on function public.attach_document(uuid, public.document_entity, uuid,
  public.document_kind, text, text, integer, date) to authenticated;

comment on function public.attach_document(uuid, public.document_entity, uuid,
  public.document_kind, text, text, integer, date) is
  'Files an uploaded object against a subject at this property, with a retention date. PRD section 7.2.';

/**
 * What is attached to something.
 *
 * Returns the storage key rather than a URL: a signed URL has a lifetime and is minted by
 * the client when it needs one, and putting one in a row would bake an expiry into a
 * record meant to outlive several of them.
 */
create or replace function public.list_documents(
  p_property_id uuid,
  p_entity_type public.document_entity,
  p_entity_id   uuid
)
returns table (
  id uuid,
  kind public.document_kind,
  storage_key text,
  mime_type text,
  byte_size integer,
  captured_at timestamptz,
  retention_until date
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.kind, d.storage_key, d.mime_type, d.byte_size, d.captured_at, d.retention_until
    from public.document d
   where d.property_id = p_property_id
     and d.entity_type = p_entity_type
     and d.entity_id = p_entity_id
     and p_property_id in (select app.accessible_properties())
   order by d.captured_at;
$$;

revoke all on function public.list_documents(uuid, public.document_entity, uuid) from public, anon;
grant execute on function public.list_documents(uuid, public.document_entity, uuid) to authenticated;
