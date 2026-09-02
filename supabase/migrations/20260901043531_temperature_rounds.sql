-- Temperature rounds — PRD section 7.3, the only self-entry register tagged [P1].
--
-- Twice a day someone stands in front of the cold room with a thermometer. Everything
-- else in the FSSAI registers is a by-product of the material flow; this one is not,
-- because the temperature of a room is not a movement of stock. It has to be walked to
-- and written down, which is why it gets its own table and nothing else does.
--
-- Deliberately a plain table with an INSERT policy, not an RPC. There is no allocation,
-- no state machine and no cross-row invariant — a reading is one fact, append-only.
-- The retry seam is the idempotency key: the capture screen queues readings through the
-- offline outbox exactly as gate entries queue, and a resend of a send the device never
-- heard the answer to lands on the named unique constraint and is recognised as its own.
--
-- No thresholds are enforced. A freezer at -12 when it should be at -18 is recorded at
-- -12 — witness before enforce (PRD section 2): the register's value is that it is what
-- the thermometer said, not what the rule wished it said. Alerting is P2.

create table public.temperature_reading (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.property (id) on delete cascade,
  location_id   uuid not null,
  temperature_c numeric(5, 1) not null,
  recorded_by   uuid references auth.users (id) on delete set null,
  -- Server-authoritative, always (CLAUDE.md 19). The device's claim sits beside it so a
  -- round walked offline at 07:00 and synced at 13:00 still reads as the morning round.
  recorded_at     timestamptz not null default now(),
  taken_at_device timestamptz,
  idempotency_key text not null check (length(trim(idempotency_key)) between 1 and 128),
  created_at      timestamptz not null default now(),

  -- Named, because the sync engine treats a violation of exactly this constraint as
  -- "my own retry" and reports success instead of parking the record.
  constraint temperature_reading_idempotent unique (property_id, idempotency_key),

  -- The reading and its location must belong to the same property (CLAUDE.md 4). The
  -- composite FK is what makes a cross-tenant location id a refusal instead of a row.
  constraint temperature_reading_location_same_property
    foreign key (property_id, location_id)
    references public.location (property_id, id) on delete restrict,

  -- Plausibility of the instrument, not compliance. A kitchen thermometer cannot read
  -- 300 — that is a typo — but -12 in a freezer is a true and important reading.
  constraint temperature_reading_instrument_plausible
    check (temperature_c > -100 and temperature_c < 100)
);

comment on table public.temperature_reading is
  'PRD section 7.3 — the cold room and freezer rounds. Append-only: a wrong reading is corrected by taking another, never by editing, so the register can be trusted to be what the thermometer said at the time.';

comment on column public.temperature_reading.taken_at_device is
  'What the capturing device believed the time was. Never authoritative — see recorded_at. Held so an offline round can be aged from when it was walked rather than from the sync.';

-- The register reads by day; the compliance metric reads per location per day. Both
-- lead with the tenant key.
create index temperature_reading_register_idx
  on public.temperature_reading (property_id, recorded_at desc);
create index temperature_reading_location_idx
  on public.temperature_reading (property_id, location_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- Grants and row level security
-- ---------------------------------------------------------------------------
--
-- SELECT and INSERT only. There is deliberately no UPDATE or DELETE grant at any
-- level, so an edit fails loudly at the privilege check — the append-only rule needs
-- no trigger here because no verb that could break it is granted at all.

grant select on public.temperature_reading to authenticated;
grant insert on public.temperature_reading to authenticated;
grant all on public.temperature_reading to service_role;

alter table public.temperature_reading enable row level security;
alter table public.temperature_reading force row level security;

create policy temperature_reading_select on public.temperature_reading
  for select to authenticated
  using (property_id in (select app.accessible_properties()));

-- Who walks the round: the storekeeper as part of the day's work, the FSO because
-- temperature is theirs to escalate, OWNER and ADMIN because a small property is one
-- person wearing every lanyard. Deliberately absent: SECURITY (two gates, nothing
-- else), CHEF and BANQUET (they do not operate the app — PRD section 5), and AUDITOR,
-- whose entire definition is read-only.
create policy temperature_reading_insert on public.temperature_reading
  for insert to authenticated
  with check (
    app.has_property_role(
      property_id,
      array['OWNER', 'ADMIN', 'STOREKEEPER', 'FSO']::public.membership_role[]
    )
  );
