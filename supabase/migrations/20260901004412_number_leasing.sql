-- Number block leasing for offline-capable document numbering. ADR 0005.
--
-- The gate entry number has been minted from the device clock since the flow was first
-- walked — the code marked itself "placeholder until number leasing lands", and the
-- consequence was worse than a placeholder usually is: two devices capturing in the
-- same second mint the same number, and because a unique violation was therefore
-- ambiguous, the sync path deliberately disabled its own idempotency and parked every
-- clash for a human. The safety net was off BECAUSE the numbers were unsafe.
--
-- Leasing ends the ambiguity. A device asks the server for a block of numbers while it
-- has a connection and spends them locally — instantly, offline, and without overlap,
-- because every block is carved from the same forward-only sequence the server-side
-- allocator uses. After this, a unique violation on gate_entry_no can only be one
-- thing: the same device retrying a send it did not hear the answer to.
--
-- Scope is deliberately GATE_ENTRY-shaped but not GATE_ENTRY-limited: the table and
-- RPC take any document type, because ADR 0005 applies to all of them — but nothing
-- else needs a lease yet. GRNs, issues, dispatch notes and gate passes are all numbered
-- inside their own server-side RPCs, which is correct for flows that require the server
-- anyway. They move to leases when they go offline, not before.

-- ---------------------------------------------------------------------------
-- The lease record
-- ---------------------------------------------------------------------------
--
-- Every gap in a number series must resolve to a device, a shift and a reason (ADR
-- 0005): leases are the record that does the resolving, so they are retained forever
-- and never reused. `consumed_upto` stays null until consumption reporting exists —
-- every spent number becomes a gate_entry row, so consumption is derivable by range
-- query, and reporting earns its complexity only when an offline guard device does.

create table public.number_lease (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.property (id),
  doc_type      public.document_number_type not null,
  -- The app's own installation id, not anything the platform issues. Free text with a
  -- sanity bound; its job is "which device was this", not authentication.
  device_id     text not null,
  range_start   bigint not null,
  range_end     bigint not null,
  issued_at     timestamptz not null default now(),
  -- Advisory. An expired lease's numbers are NOT reclaimed — they were carved from a
  -- forward-only sequence and may already be written on a vendor's challan. Expiry
  -- exists so an auditor asking about a gap can see the lease was abandoned, not lost.
  expires_at    timestamptz,
  consumed_upto bigint,

  constraint number_lease_range_sane check (range_end >= range_start),
  constraint number_lease_device_id_sane check (char_length(device_id) between 1 and 128),
  constraint number_lease_consumed_in_range
    check (consumed_upto is null or (consumed_upto >= range_start - 1 and consumed_upto <= range_end))
);

comment on table public.number_lease is
  'Blocks of document numbers issued to devices (ADR 0005). Retained forever: every gap in a series must resolve to a lease.';

-- Gap queries read newest-first per property and type.
create index number_lease_property_type_idx
  on public.number_lease (property_id, doc_type, issued_at desc);

alter table public.number_lease enable row level security;

-- Members may read their property's leases — that is what makes gaps explainable from
-- inside the tenant. Nobody writes them from the client; the RPC below is the only
-- writer, and it is SECURITY DEFINER.
create policy number_lease_select on public.number_lease
  for select to authenticated
  using (property_id in (select app.accessible_properties()));

-- ---------------------------------------------------------------------------
-- Leasing a block
-- ---------------------------------------------------------------------------

create or replace function public.lease_document_numbers(
  p_property_id uuid,
  p_doc_type    public.document_number_type,
  p_device_id   text,
  p_count       int
)
returns table (range_start bigint, range_end bigint, property_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code  text;
  v_start bigint;
begin
  -- Bounded, because a runaway client asking for a million numbers would not break
  -- correctness (the sequence just advances) but would manufacture a gap so large the
  -- "every gap is explainable" promise turns into a shrug.
  if p_count < 1 or p_count > 500 then
    raise exception 'Lease size must be between 1 and 500 numbers.' using errcode = '22003';
  end if;

  if p_device_id is null or char_length(trim(p_device_id)) = 0 then
    raise exception 'A lease names the device it was issued to.' using errcode = '22023';
  end if;

  -- The same authority as inserting the documents themselves: leasing gate entry
  -- numbers is gated exactly like inserting gate entries (harden_write_authority).
  -- A role that cannot create the document has no business holding its numbers.
  if not app.has_property_role(
    p_property_id, array['OWNER', 'ADMIN', 'SECURITY']::public.membership_role[]
  ) then
    raise exception 'Not permitted to lease numbers for this property.' using errcode = '42501';
  end if;

  select code into v_code from public.property where id = p_property_id;
  if v_code is null then
    raise exception 'That property does not exist.' using errcode = '42501';
  end if;

  -- Insert-then-update, exactly as app.next_document_number does: the UPDATE takes the
  -- row lock, so a lease racing another lease — or racing the server-side allocator on
  -- the same sequence — queues rather than collides. One sequence feeds both paths,
  -- which is precisely why they cannot overlap.
  insert into public.number_sequence (property_id, doc_type)
  values (p_property_id, p_doc_type)
  on conflict (property_id, doc_type) do nothing;

  update public.number_sequence
     set next_value = next_value + p_count, updated_at = now()
   where property_id = p_property_id and doc_type = p_doc_type
  returning next_value - p_count into v_start;

  if v_start is null then
    raise exception 'Could not allocate a number block.' using errcode = 'P0001';
  end if;

  insert into public.number_lease
    (property_id, doc_type, device_id, range_start, range_end, expires_at)
  values
    (p_property_id, p_doc_type, trim(p_device_id), v_start, v_start + p_count - 1,
     now() + interval '7 days');

  return query select v_start, v_start + p_count - 1, v_code;
end;
$$;

comment on function public.lease_document_numbers(uuid, public.document_number_type, text, int) is
  'Issues a device a block of document numbers to spend offline (ADR 0005). Same role gate as inserting the documents; blocks are carved from number_sequence so leases and server-side allocation cannot overlap.';

revoke all on function public.lease_document_numbers(uuid, public.document_number_type, text, int)
  from public, anon;
grant execute on function public.lease_document_numbers(uuid, public.document_number_type, text, int)
  to authenticated;
