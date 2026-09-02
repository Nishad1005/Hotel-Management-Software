# Pilot runbook — seeding, rehearsal, and the weekly readout

The build track of the two-week pilot plan (days 1–8) is merged code: number leasing,
the returnable register, the temperature round, Sentry, and the provisioning guard.
This file is the operational half — what gets done on the deployed URL, in order, and
the SQL the weekly review runs. It assumes the pilot property's people are
non-technical; every step names who does it.

## 0. The gate before seeding

Nothing below works until `main` carries the three migrations
(`number_leasing`, `returnable_register`, `temperature_rounds`).

1. **Merge to `main`** (owner, one click). The CI deploy job applies the migrations —
   they reach production through no other path.
2. **Deploy the edge function** (dev machine): `supabase functions deploy provision-tenant`.
   Edge functions are not in the CI deploy job; forgetting this leaves provisioning
   accepting phone-only owners that cannot sign in.
3. **Verify the deploy twice** (CLAUDE.md: a single poll during a Cloudflare rollout
   lies). From any shell:

   ```sh
   # Twice, at least a minute apart — the edge serves inconsistently mid-rollout.
   curl -s https://hotel-management-software.nalawadenishad.workers.dev/ | grep -o 'entry-[a-f0-9]*\.js'
   ```

   Same hash twice, then check a marker **inside the served bundle** — a string this
   release added that no earlier bundle can contain:

   ```sh
   curl -s https://hotel-management-software.nalawadenishad.workers.dev/_expo/static/js/web/<entry-hash>.js \
     | grep -c 'lease_document_numbers'   # expect 1 or more
   ```

4. **Gate capture smoke test** (dev machine, two browser profiles): sign in, capture an
   arrival in each. Expect two _distinct_ leased numbers in the property's series and
   both entries synced. This is the end-to-end proof of ADR 0005 on production — and it
   is what un-breaks the half-shipped state where the leasing client was live before
   its RPC.

## 1. Day 9 — production seeding

| Step                                                                                                                                                   | Who                      | Where                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------ |
| Provision the pilot tenant (org, property code, owner **email**)                                                                                       | Us                       | `/platform`                    |
| Create manager + storekeeper accounts, **separate people, separate logins**                                                                            | Us                       | Supabase Auth + `/admin/users` |
| Roles: storekeeper → `STOREKEEPER`; the person recording arrivals → `SECURITY` (or `ADMIN`)                                                            | Us                       | `/admin/users`                 |
| Import the item spreadsheet                                                                                                                            | Us, with the storekeeper | `/items/import`                |
| Build the location tree — every store, and the **regime** on the cold room and freezer (the temperature round lists only `CHILLED`/`FROZEN` locations) | Storekeeper, with us     | `/setup` → Locations           |
| Print and laminate bin labels; stick them                                                                                                              | Property                 | —                              |
| Walk one temperature round to prove the register fills                                                                                                 | Storekeeper              | `/temperature`                 |

The role split is not bureaucracy: **a storekeeper cannot create gate entries** — by
policy, deliberately. If the same person records the arrival and posts the GRN, the
two records agree by construction and the reconciliation control proves nothing.

Pilot device rules, stated to the users on day one:

- **One browser tab** on the dock device. Two tabs share the number pool's storage;
  the constraint absorbs a double-spend as a retry, but the rule costs nothing.
- The pending-sync count on Home is the truth about what has reached the server.
  Zero by end of shift; anything stuck past an hour is a support call.

## 2. Day 10 — dress rehearsal

At the real dock, on the real device, with the HID scanner (it types like a keyboard —
test it in a plain text box first, then on `/gate/new`).

The run, in flow order, each performed by the person who will do it live:

1. Arrival captured at the gate (SECURITY login) — challan gets the number by hand.
2. Receive against the entry: quantities, a probe reading on a cold-chain line, one
   deliberate reject.
3. Put away with a **scanned** bin label. Typing is counted; labels being up is what
   the weekly typed-share metric measures.
4. Issue to a department.
5. Stage a returnable dispatch (empties) with a promised return date; gate it out;
   record a partial return at `/returnables`.
6. Morning temperature round on `/temperature`, including one blank unit (skipped, not
   zeroed) and one negative reading.
7. Airplane-mode capture: one gate entry offline, watch it sync when the network
   returns. The pending count is the lesson, not the trick.
8. Read every register at `/registers` and show the property that nothing on it was
   entered twice.

**Acceptance (PRD §13): a ten-line delivery, gate to GRN, under four minutes.** Time it
honestly. If it fails, the finding is the deliverable — fix the screen that ate the
time before go-live, not after.

Baseline to capture before leaving: item count, location count, login list, one full
register export, and the readout below run once.

## 3. The weekly readout

Run in the Supabase SQL editor. Set the property first, then every query below works
as written:

```sql
-- The pilot property's id, once:
select id from public.property where code = '<CODE>';
```

Replace `:prop` with that id (or `set` a psql variable).

```sql
-- Is it being used at all — receipts per day
select posted_at::date as day, count(*) as receipts
from public.grn
where property_id = :prop
group by 1 order by 1 desc;

-- Capture-funnel leakage: arrivals no receipt ever answered (the reconciliation
-- control, working). Anything older than a day needs a name attached to why.
select ge.gate_entry_no, ge.timestamp_in::date as arrived
from public.gate_entry ge
left join public.grn g on g.gate_entry_id = ge.id
where ge.property_id = :prop
  and g.id is null
  and ge.timestamp_in < now() - interval '24 hours'
order by ge.timestamp_in;

-- Put-away dwell breaches: stock that sat at T1 past four hours
select b.batch_no, g.grn_no, (sm.occurred_at - g.posted_at) as dwell
from public.stock_movement sm
join public.batch b on b.id = sm.batch_id
join public.grn_line gl on gl.batch_id = b.id
join public.grn g on g.id = gl.grn_id
where sm.property_id = :prop
  and sm.reason = 'PUT_AWAY'
  and sm.occurred_at - g.posted_at > interval '4 hours'
order by dwell desc;

-- Typed-bin share on put-away, last seven days. TYPED trending to zero with labels
-- up is what earns the PUT_AWAY_REQUIRES_SCAN flip to BLOCK — a decision, not code.
select scan_method, count(*)
from public.stock_movement
where property_id = :prop
  and reason = 'PUT_AWAY'
  and occurred_at > now() - interval '7 days'
group by 1;

-- Number-series integrity: every lease, and how much of it the ledger shows spent.
-- A gap inside a consumed range is a captured-but-unsynced entry or a genuine gap;
-- either way it resolves to a device and a shift, which is the ADR 0005 promise.
select l.device_id, l.range_start, l.range_end, l.issued_at::date as leased,
       count(ge.id) as entries_landed
from public.number_lease l
left join public.gate_entry ge
  on ge.property_id = l.property_id
 and (regexp_match(ge.gate_entry_no, '(\d+)$'))[1]::bigint
       between l.range_start and l.range_end
where l.property_id = :prop and l.doc_type = 'GATE_ENTRY'
group by 1, 2, 3, 4
order by l.range_start;

-- Temperature compliance: readings per cold unit per day. The target is ≥ 2.
select l.code, tr.recorded_at::date as day, count(*) as readings
from public.temperature_reading tr
join public.location l on l.id = tr.location_id
where tr.property_id = :prop
  and tr.recorded_at > now() - interval '7 days'
group by 1, 2
order by 2 desc, 1;

-- Returnables exposure: how much is out, and how old the oldest promise is
select count(*) filter (where ri.qty_out > ri.qty_returned)          as open_dispatches,
       coalesce(max(current_date - dn.expected_return_date)
                filter (where ri.qty_out > ri.qty_returned), 0)      as oldest_overdue_days
from public.returnable_item ri
join public.dispatch_note dn on dn.id = ri.dispatch_note_id
where ri.property_id = :prop;
```

Sync health is read in Sentry, not SQL: the parked-outbox events (`Outbox record
parked`) are the pilot's sync-failure telemetry, tagged with `property_id` and
`device_id`. No DSN configured = no telemetry, silently — check the Cloudflare build
env carries `EXPO_PUBLIC_SENTRY_DSN` before trusting the quiet.

Plus the human loop: thirty minutes with the property each week, and a one-page
laminated cheat sheet per role. The users are non-technical; the training artefact
matters as much as any screen.

## 4. Support path during the pilot

A support session is a consent-noted membership grant, honest and auditable as a
`membership` row — via the SQL editor:

```sql
select system.grant_property_role_by_id('<our email>', '<property id>', 'ADMIN');
```

Revoke it when done by deleting that membership row. The ADR 0011 impersonation
machinery is a later build; this is the interim that leaves a trail.
