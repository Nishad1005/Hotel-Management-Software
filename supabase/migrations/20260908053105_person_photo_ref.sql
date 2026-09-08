-- ---------------------------------------------------------------------------
-- A face on the cached staff master — criterion 18.
-- ---------------------------------------------------------------------------
--
-- "The receiver's photograph displays on scan, from cache, with no network."
--
-- The vault already holds the photograph; what was missing is a way to find it without
-- asking. `list_people` is what the storekeeper's device caches, and if the face could
-- only be located by calling `list_documents` per scan then the requirement's own
-- condition — no network — would be the one case it failed in. So `person.photo_ref`
-- carries the storage key, and the cached master carries it with everything else.
--
-- Set here rather than by a second call from the client, for the reason CLAUDE.md 4b is
-- about: two statements mean one of them can be the one that does not arrive, and the
-- failure is a photograph in the vault that no scan will ever show.

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
  v_key      text;
begin
  if not app.has_property_role(
       p_property_id,
       array['OWNER', 'ADMIN', 'GM', 'STOREKEEPER', 'SECURITY', 'CHEF', 'FSO']::public.membership_role[]
     ) then
    raise exception 'You cannot attach evidence at this property.' using errcode = '42501';
  end if;

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

  v_until := coalesce(
    p_retention_until,
    case p_kind
      when 'STAFF_PHOTO' then (current_date + interval '1 year')::date
      else (current_date + interval '2 years')::date
    end
  );

  v_key := p_property_id::text || '/' || lower(trim(p_sha256));

  insert into public.document
    (property_id, entity_type, entity_id, kind, sha256, storage_key,
     mime_type, byte_size, captured_by, retention_until)
  values
    (p_property_id, p_entity_type, p_entity_id, p_kind, lower(trim(p_sha256)), v_key,
     p_mime_type, p_byte_size, (select auth.uid()), v_until)
  -- `do nothing` rather than an upsert: the immutability trigger refuses BEFORE UPDATE
  -- absolutely, and a retry must not try to write.
  on conflict (property_id, entity_type, entity_id, sha256) do nothing
  returning id into v_id;

  if v_id is null then
    select d.id into v_id
      from public.document d
     where d.property_id = p_property_id
       and d.entity_type = p_entity_type
       and d.entity_id = p_entity_id
       and d.sha256 = lower(trim(p_sha256));
  end if;

  /*
    The face, onto the master the device caches.

    Only the newest photograph is pointed at, and the older ones stay in the vault —
    somebody who changes their appearance gets a new card photograph, and the register
    still holds the one that was on screen when they collected something last winter.
    The pointer moves; the evidence does not.
  */
  if p_entity_type = 'PERSON' and p_kind = 'STAFF_PHOTO' then
    update public.person
       set photo_ref = v_key
     where property_id = p_property_id
       and id = p_entity_id;
  end if;

  return v_id;
end;
$$;

comment on function public.attach_document(uuid, public.document_entity, uuid,
  public.document_kind, text, text, integer, date) is
  'Files an uploaded object against a subject, and points a person at their newest face so the cached master carries it. PRD section 7.2, criterion 18.';
