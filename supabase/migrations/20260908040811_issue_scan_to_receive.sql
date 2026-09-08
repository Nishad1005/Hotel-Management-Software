-- ---------------------------------------------------------------------------
-- Scan to receive — PRD section 4 Gate 8. Criterion 17, and criterion 19 at the
-- point where it bites.
-- ---------------------------------------------------------------------------
--
-- "The receiver scans their own card. The scan is the acknowledgement." Until now
-- `receipt_ack.verified_by_scan` has been written false on every row, with a comment
-- saying so honestly. This is what makes it capable of being true.
--
-- ## What this does not do: block
--
-- Criterion 17 reads "no material changes custody without a card scan — the only
-- alternative is a supervisor override carrying the supervisor's identity". That is a
-- rule about a property where cards exist. None are printed yet, and PRD section 2 is
-- explicit that where the property cannot yet comply the system must not pretend it
-- can: an unenforceable rule produces click-through, and the record then carries a false
-- assertion instead of an honest gap.
--
-- So an issue with no card is still recorded, and recorded as unverified. What changes
-- is that it is now *distinguishable*: `verified_by_scan` finally means something,
-- an override carries a reason and the supervisor's identity, and the property can count
-- how often material changes hands anonymously — which is the number that tells them
-- when enforcement is affordable. Turning it into a block is a `rule_config` decision
-- once cards are in hands, not a code change.
--
-- ## Where the logic sits
--
-- In the wrapper, beside the module gate, rather than inside `issue_stock_impl`. The
-- impl is a hundred and fifty lines of movement and ledger work that is correct and
-- tested; re-declaring it to add three parameters would mean transcribing all of it, and
-- a transcription error in stock movement is a worse outcome than the problem being
-- solved. The wrapper resolves the person first, hands the impl the name it should
-- record, and completes the acknowledgement — all inside the one transaction the impl
-- already opens, so an issue still cannot exist without its acknowledgement.

-- ---------------------------------------------------------------------------
-- The exception path gets somewhere to live
-- ---------------------------------------------------------------------------

alter table public.receipt_ack
  add column override_reason text;

comment on column public.receipt_ack.override_reason is
  'Why material changed hands without a card. The supervisor is recorded_by; this is their reason.';

-- A scan identifies somebody. A row claiming verification with nobody named is the same
-- empty assertion the `scan_has_a_method` constraint already refuses in its own way.
alter table public.receipt_ack
  add constraint receipt_ack_scan_identifies_a_person
  check (not verified_by_scan or receiver_person_id is not null);

-- A scan and an override are alternatives, not belt and braces. A row carrying both
-- would be a supervisor explaining away a scan that happened.
alter table public.receipt_ack
  add constraint receipt_ack_override_excludes_scan
  check (not (verified_by_scan and override_reason is not null));

-- ---------------------------------------------------------------------------
-- issue_stock, taught to take a card
-- ---------------------------------------------------------------------------

-- Dropped rather than replaced because the signature grows. The new parameters all carry
-- defaults, so a device running an older build still calls it with six named arguments
-- and still succeeds — CLAUDE.md rule 20, the sync API is additive only, and an offline
-- device can be days stale. PostgREST resolves by argument name, so the old call shape
-- lands here rather than failing to find a function.
drop function if exists public.issue_stock(uuid, uuid, text, text, text, jsonb);

create function public.issue_stock(
  p_property_id     uuid,
  p_department_id   uuid,
  p_receiver_name   text,
  p_purpose         text,
  p_idempotency_key text,
  p_lines           jsonb,
  /** The card that was scanned. Null means no card was presented. */
  p_receiver_person_id uuid default null,
  /** How the code arrived — camera, wedge, or typed. Typed is the case worth counting. */
  p_scan_method     public.scan_method default null,
  /** Why there was no card. The supervisor is whoever is signed in. */
  p_override_reason text default null
)
returns table (issue_id uuid, issue_no text, expired_lines integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person   public.person%rowtype;
  v_name     text;
  v_issue_id uuid;
  v_issue_no text;
  v_expired  integer;
  v_rows     integer;
begin
  perform app.require_module(p_property_id, 'ISSUE');

  if p_receiver_person_id is not null then
    select * into v_person
      from public.person
     where property_id = p_property_id
       and id = p_receiver_person_id;

    -- Not "no such person": the card belongs to somewhere else, and saying so is the
    -- difference between a damaged card and a card from another property.
    if v_person.id is null then
      raise exception 'That card is not on this property''s staff master.'
        using errcode = '42501';
    end if;

    /*
      Criterion 19, at the only moment it matters.

      "Server-side and immediate" is a claim about this check, not about how quickly a
      flag reaches devices. A card stopped a minute ago fails here even if the
      storekeeper's cached staff master still lists the person as active — which is
      exactly the case the requirement was written for: contract staff who left this
      morning and still hold the plastic.
    */
    if not v_person.is_active then
      raise exception 'That card was stopped on %. It cannot take custody of anything.',
        to_char(v_person.deactivated_at, 'DD Mon YYYY')
        using errcode = '42501';
    end if;

    if p_scan_method is null then
      raise exception 'Record how the card was read. A scan with no method is not a scan.'
        using errcode = '23514';
    end if;

    if p_override_reason is not null then
      raise exception 'A card was scanned, so there is nothing to override.'
        using errcode = '23514';
    end if;
  end if;

  -- The master is the name of record. A storekeeper's typing is what the acknowledgement
  -- falls back to, never what it prefers.
  v_name := coalesce(nullif(trim(v_person.full_name), ''), p_receiver_name);

  select r.issue_id, r.issue_no, r.expired_lines
    into v_issue_id, v_issue_no, v_expired
    from public.issue_stock_impl(p_property_id, p_department_id, v_name,
                                 p_purpose, p_idempotency_key, p_lines) as r;

  /*
    Completes the acknowledgement the impl just wrote, in the same transaction.

    Deliberately a separate statement rather than a data-modifying CTE beside the call.
    Sub-statements in a WITH share one snapshot and cannot see each other's effects, so an
    UPDATE sitting next to the call would have matched zero rows every time — the
    acknowledgement row does not exist yet from that statement's point of view. Written
    that way first; it would have failed on the first real issue.

    A replayed submission returns the original issue without inserting anything, and this
    update then rewrites the same values onto the row that already carries them, so a
    retry stays idempotent rather than reassigning who signed for what.
  */
  update public.receipt_ack
     set receiver_person_id = p_receiver_person_id,
         verified_by_scan   = p_receiver_person_id is not null,
         scan_method        = p_scan_method,
         override_reason    = nullif(trim(coalesce(p_override_reason, '')), '')
   where property_id = p_property_id
     and issue_note_id = v_issue_id;

  get diagnostics v_rows = row_count;

  -- Zero rows here would leave stock issued with no acknowledgement completed against it.
  -- CLAUDE.md 4b: a silent zero is a failure, and this one is loud.
  if v_rows = 0 then
    raise exception 'The issue was recorded but its acknowledgement was not.'
      using errcode = '23514';
  end if;

  return query select v_issue_id, v_issue_no, v_expired;
end;
$$;

revoke all on function public.issue_stock(uuid, uuid, text, text, text, jsonb, uuid, public.scan_method, text)
  from public, anon;
grant execute on function public.issue_stock(uuid, uuid, text, text, text, jsonb, uuid, public.scan_method, text)
  to authenticated;

comment on function public.issue_stock(uuid, uuid, text, text, text, jsonb, uuid, public.scan_method, text) is
  'Gate 8. Takes a scanned staff card where there is one, records an override where there is not, and refuses a stopped card. PRD section 4 Gate 8.';
