# How Golai works

Every feature in the product, what rule it exists to enforce, and where that lives in the
code. Written for the person who has to change one of them.

## Maintaining this file

**Changing a feature means changing its entry here, in the same commit.** Not afterwards
and not in a follow-up — a document updated later is a document that describes the build
before last, and a reader who finds one stale entry stops trusting the other forty.

Three rules keep it useful rather than merely long:

- **It records intent, not implementation.** What the feature is for, the rule it enforces,
  and what it deliberately does not do. Line-by-line behaviour belongs in the code, where
  it cannot drift from itself.
- **Pointers, never copies.** Link to the file. A snippet pasted here is wrong the moment
  somebody edits the original, and nothing tells you.
- **The gaps are part of the entry.** Where something is recorded rather than enforced, or
  built for web and not native, that belongs here — a reader who assumes a control exists
  is worse off than one who knows it does not.

Phase 1 progress against the PRD's own acceptance criteria is scored separately in
[PHASE_1_GAP_ANALYSIS.md](PHASE_1_GAP_ANALYSIS.md). This file says how things work; that
one says how much of the target is met.

---

## The shape of it

Material enters at a gate, is checked at a terminal, is put away into a bin, is issued to
a department, and leaves through a second terminal and the gate again. Every record hangs
off the Gate Entry Number the guard raised when the vehicle arrived.

```
Gate 0        arrival captured, number issued        gate/new
Gates 1–5     quantity, quality, decision, GRN       receive/[entry]
Gate 6        put-away into a scanned bin            putaway
Gate 8        issue to a department, card scanned    issue
Gate 9        staged at Terminal 2                   dispatch
Gate 10       gate pass, verified by Security        gate-out
```

The claim the product is sold on: because that flow already captures vendor, batch,
temperature, expiry and disposal, **the FSSAI registers are a by-product of it rather than
a second job.** Everything in "Compliance" below is a view over the flow, not a form.

---

## Foundations

These cut across every feature. A change here is felt everywhere.

### Tenancy

**What it is.** Every domain table carries `property_id`, has RLS enabled, and has a
policy. The tenant key is the property, never the organisation — group-wide access comes
from extra `membership` rows, not from a wider predicate.

**The rule.** No row spans two properties. Cross-property references use composite foreign
keys `(property_id, x_id)`, so a document at one hotel cannot name another's row even by
accident. `app.accessible_properties()` is the idiom every read policy uses;
`app.has_property_role(property, roles)` is the one write policies use.

**Where.** [`20260810065422_create_tenancy.sql`](../supabase/migrations/20260810065422_create_tenancy.sql),
[`20260812102424_fix_composite_tenant_keys.sql`](../supabase/migrations/20260812102424_fix_composite_tenant_keys.sql).

**Watch out.** `has_property_role(x, null)` does **not** mean "any role" — the function
ends in `role = any(allowed)` and `= any(NULL)` is NULL, so it denies everyone silently.
Use `accessible_properties()` for "any member".

### Module access

**What it is.** The platform decides which modules a property holds; the property decides
which of its people may use each one. Eleven flow-area modules — GATE, RECEIVING, PUTAWAY,
ISSUE, DISPATCH, RETURNABLES, TEMPERATURE, STOCK, REGISTERS, MASTERS, USERS.

**The rule.** Two questions only: did the customer buy it, and was this person restricted
from it. Roles are answered elsewhere — inside each RPC and in `ROUTE_CAPABILITY` — because
a rule expressed twice diverges, and when it did the module layer stole the specific
refusal and reported a cross-tenant error as a module problem.

**Where.** [`20260907055949_module_access.sql`](../supabase/migrations/20260907055949_module_access.sql),
[`lib/modules.ts`](../apps/mobile/lib/modules.ts), member toggles in
[`admin/users.tsx`](../apps/mobile/app/admin/users.tsx), property licensing in
[`platform/index.tsx`](../apps/mobile/app/platform/index.tsx).

**Gap.** `module.default_roles` is display only — it shows an administrator who would hold
a module anyway. It is not the enforcement rule and must not become one.

### Numbering

**What it is.** Sequential, immutable document numbers per property: `TW-GE-000608`,
`TW-GRN-000004`, `TW-DN-000001`, `TW-GP-000001`.

**The rule.** Gate entry numbers are **leased in blocks to a device** so a guard can write
one on a paper challan with no network (ADR 0005). Every other number is taken inside the
transaction that creates its document, because nothing outside the property depends on
knowing it early.

**Where.** [`20260901004412_number_leasing.sql`](../supabase/migrations/20260901004412_number_leasing.sql),
[`lib/numbers.ts`](../apps/mobile/lib/numbers.ts),
[`packages/domain/src/numbering`](../packages/domain/src/numbering).

**Consequence.** A gap in the series is legal and explainable from the retained lease rows.
A number minted outside a lease is not, which is why nothing does it.

### Offline capture

**What it is.** An append-only queue on the device, drained when the network returns.
Five capture types: `GATE_ENTRY`, `GRN_POST`, `ISSUE_STOCK`, `DISPATCH_STAGE`,
`TEMPERATURE_READING`.

**The rule.** A screen queues **only when nothing answered**. A server that refused is
obeyed, because telling a storekeeper their receipt is safely waiting when it has already
been rejected is worse than failing in front of them. `serverAnswered()` lives in
`packages/db` so the screen deciding to queue and the sender deciding to retry cannot
drift.

**Where.** [`packages/outbox`](../packages/outbox), [`packages/db/src/sync.ts`](../packages/db/src/sync.ts),
[`lib/sync.ts`](../apps/mobile/lib/sync.ts), drivers in `lib/outbox-store.*.ts`.

**Deliberately online.** Put-away confirmation and gate-out. Both require the server: a
gate pass is what Security checks against a vehicle at the barrier, and one issued from an
unsynced device is a pass nobody at the gate can see (PRD §13).

**How a transaction is carried.** `SyncTarget` is a union — a row to insert, or a function
to call. The RPC form has no `idempotentOn`: `post_grn`, `issue_stock` and
`stage_for_dispatch` each take a submission key and return the first attempt's result, so
a replay is an ordinary success rather than a constraint collision.

### The evidence vault

**What it is.** One content-addressed, immutable store for cold-chain photographs, staff
faces, vendor bills and collection receipts.

**The rule.** The storage key is the SHA-256 of the bytes, so the same photograph filed
twice is stored once, a file cannot be swapped without its address changing, and an
interrupted upload retried lands on the same key. Under 400 KB is a check constraint as
well as a client rule. `retention_until` is required — a photograph with no end date is a
decision nobody made, and staff photographs are personal data under the DPDP Act 2023.

**Where.** [`20260908050506_evidence_vault.sql`](../supabase/migrations/20260908050506_evidence_vault.sql),
[`lib/evidence.ts`](../apps/mobile/lib/evidence.ts),
[`lib/photo.web.ts`](../apps/mobile/lib/photo.web.ts),
[`components/photo-field.tsx`](../apps/mobile/components/photo-field.tsx).

**Immutable in two layers.** Grants withhold UPDATE and DELETE from clients; a trigger
refuses them again so a future migration cannot edit evidence either. The trigger caught
the first upsert written against it — which is why the retry path reads rather than writes.

**Gap.** Nothing is deleted yet. Retention is recorded and the sweep is unwritten, because
it has to consider what the registers still reference. There is deliberately no DELETE
policy on the bucket for the same reason — when the sweep exists it runs with its own
authority, not as a client holding a session.

**Storage policies.** SELECT, INSERT and UPDATE, all scoped by the first path segment
being a property the member belongs to. UPDATE matters and was missing at first: the key
is the content address, so a retried upload lands on the same object and needs UPDATE
rather than INSERT. Without it the _second_ attempt at one photograph was refused — the
exact case the addressing exists to make safe. CI could not see it, because a stack
replayed from empty never uploads the same object twice.

**Platform.** Compression and hashing use canvas and `crypto.subtle` — no dependency, web
only. Native refuses clearly and gets a driver in Phase 9.

### Enforcement mode

**What it is.** Every check carries `RECORD_ONLY` / `WARN` / `BLOCK` on `rule_config`, and
ships at `RECORD_ONLY` with no UI to change it.

**The rule.** Witness before you enforce (PRD §2). Where the property cannot refuse a
delivery, the system must not pretend it can — an unenforceable rule produces click-through,
and the record then carries a false assertion instead of an honest gap.

**Where this bites today.** The card scan on issue records rather than blocks, because no
cards are printed. Temperature excursions and short shelf life are recorded against the
batch and do not stop a receipt.

---

## The flow

### Gate 0 — arrival

**What it does.** Security captures who is delivering, whether there is a bill, how many
packages, and what it arrived in. A Gate Entry Number is issued from the device's leased
block and written on the paper challan.

**Rules.** A vendor is registered or named — neither is not an option
(`gate_entry_has_a_vendor`). Nothing enters without a number.

**Where.** [`gate/new.tsx`](../apps/mobile/app/gate/new.tsx),
[`gate/recorded.tsx`](../apps/mobile/app/gate/recorded.tsx), `lib/numbers.ts`.

**Offline.** Fully. This is the screen the leasing exists for.

**Gap.** The bill photograph is not wired to the vault yet — the screen still says
"Coming soon". Criterion 16's scannable vendor card is not built; vendors are chosen from
a list.

### Gates 1–5 — receiving

**What it does.** One screen for the whole conversation with a waiting driver: what
arrived, how much, what condition, and the accept/reject decision. Posting writes the GRN,
its lines, a batch per line and the stock movements in one transaction.

**Rules.** An item must already exist — nothing is created at the dock. A perishable line
needs a best-before date; a cold-chain line needs a probe temperature and a photograph.
A posted GRN is immutable and corrected only by amendment with a full trail. Accepted
stock lands in `QUARANTINE` at Terminal 1 — receiving something does not make it issuable.

**Where.** [`receive/index.tsx`](../apps/mobile/app/receive/index.tsx),
[`receive/[entry].tsx`](../apps/mobile/app/receive/[entry].tsx),
[`lib/receiving.ts`](../apps/mobile/lib/receiving.ts),
[`20260817114128_post_grn.sql`](../supabase/migrations/20260817114128_post_grn.sql),
[`20260819094146_amend_grn.sql`](../supabase/migrations/20260819094146_amend_grn.sql).

**Offline.** Yes. A queued receipt has no GRN number until it syncs, and says so rather
than showing a placeholder that could be written on a challan.

**Reconciliation.** `list_open_gate_entries` is the receiving worklist and the
reconciliation control at once: every gate entry resolves to a GRN or stays on that list
getting older. Arrivals past four hours are counted on the worklist and the dashboard.

### Gate 6 — put-away

**What it does.** Moves stock from Terminal 1 into a bin, which is what makes it issuable.

**Rules.** The destination bin must be **scanned**. Typing is permitted only while labels
are being printed, and every typed put-away is counted — the field records which method was
used rather than asking (`scan_method`: CAMERA, HARDWARE, TYPED). Rejected stock can never
reach a zone; the state machine does not allow the transition.

**Where.** [`putaway/index.tsx`](../apps/mobile/app/putaway/index.tsx),
[`lib/putaway.ts`](../apps/mobile/lib/putaway.ts),
[`components/scan-field.tsx`](../apps/mobile/components/scan-field.tsx),
[`20260817120319_put_away.sql`](../supabase/migrations/20260817120319_put_away.sql).

**Deliberately online.** PRD §13.

### Gate 8 — issue to a department

**What it does.** Stock leaves a bin and enters `ISSUED` against a department. The receiver
presents their card and the storekeeper scans it; that scan is the acknowledgement.

**Rules.** An issue and its acknowledgement are one transaction — an acknowledgement
written by a second call is one that can fail to arrive, leaving stock that has left the
store with nobody's name against it. A stopped card is refused at this point, which is
where criterion 19's "immediate and server-side" actually bites. Batches are offered
first-expired-first-out.

**Where.** [`issue/index.tsx`](../apps/mobile/app/issue/index.tsx),
[`lib/issuing.ts`](../apps/mobile/lib/issuing.ts),
[`20260817121525_issue_stock.sql`](../supabase/migrations/20260817121525_issue_stock.sql),
[`20260908040811_issue_scan_to_receive.sql`](../supabase/migrations/20260908040811_issue_scan_to_receive.sql).

**Gap.** It records rather than blocks. No cards are printed, so an issue with no card is
still allowed and recorded as unverified with a supervisor's reason. The gap is countable —
`verified_by_scan` means something — and blocking is a `rule_config` decision once cards
exist.

### Gates 9 and 10 — out

**What they do.** Gate 9 stages a consignment at Terminal 2 — waste, empties, linen,
equipment, condemned stock, rejected goods back to a vendor. Gate 10 is Security verifying
it out and issuing the Gate Pass Number.

**Rules.** **Whoever staged a consignment may not verify it out.** Enforced against the
individual rather than by withholding a capability, because a small property doubles people
up and the same person can legitimately hold both roles — what they cannot be is both ends
of one consignment. `issue_gate_pass` is the only insert path into `gate_pass` and
`authenticated` holds no INSERT on that table, so the control cannot be walked around.

**Where.** [`dispatch/index.tsx`](../apps/mobile/app/dispatch/index.tsx),
[`gate-out/index.tsx`](../apps/mobile/app/gate-out/index.tsx),
[`lib/dispatch.ts`](../apps/mobile/lib/dispatch.ts),
[`20260817122339_dispatch_and_gate_pass.sql`](../supabase/migrations/20260817122339_dispatch_and_gate_pass.sql).

**Offline.** Staging queues; the gate pass does not, and a queued staging withholds its
route to gate-out rather than offering a dead end.

### Returnables

**What it does.** A dispatch that comes back — crates, cylinders, linen — stays on an aged
outstanding register until it is received back, with the condition recorded.

**Where.** [`returnables/index.tsx`](../apps/mobile/app/returnables/index.tsx),
[`lib/returnables.ts`](../apps/mobile/lib/returnables.ts),
[`20260901041414_returnable_register.sql`](../supabase/migrations/20260901041414_returnable_register.sql).

**Behaviour worth knowing.** The return dialog pre-fills what is owed and refuses more than
that. Partial returns are tracked, so "1 of 2 out" is a state the register holds.

---

## Compliance

The design claim in practice: these read the flow, they do not ask for anything twice.

**Registers** — inward material check, receipt temperature, non-conforming material, waste
out. All views over gates 0–9. [`registers/index.tsx`](../apps/mobile/app/registers/index.tsx),
[`20260817132825_compliance_registers.sql`](../supabase/migrations/20260817132825_compliance_registers.sql).

**Traceability** — forward and backward from any batch: which gate entry, which vendor, who
checked it, which bins, which departments, which gate pass.
[`registers/trace/[batch].tsx`](../apps/mobile/app/registers/trace/[batch].tsx), `trace_batch`,
`batch_provenance`.

**Temperature rounds** — the one register the flow cannot derive, so it has its own screen.
Twice daily, per cold room and freezer. [`temperature/index.tsx`](../apps/mobile/app/temperature/index.tsx),
[`20260901043531_temperature_rounds.sql`](../supabase/migrations/20260901043531_temperature_rounds.sql).
Offline, and readings carry the device's claimed time beside the server's.

**Expiring stock** — [`perishables.tsx`](../apps/mobile/app/perishables.tsx), shelf-life
maths in [`packages/domain/src/perishables`](../packages/domain/src/perishables).

**Not built.** Property licence register, cleaning schedules, pest control, water testing,
food-handler medical and FoSTaC tracking, banquet retained samples, CAPA. All `[P2]`.

---

## Masters and administration

| Screen        | What it holds                                                       | Code                                                              |
| ------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Items         | What the property buys, how each is counted, shelf life, cold chain | [`items/`](../apps/mobile/app/items)                              |
| Zones & bins  | The location tree and the printed bin labels                        | [`admin/locations.tsx`](../apps/mobile/app/admin/locations.tsx)   |
| Floor plan    | The same locations grouped into rooms, and how each is drawn        | [`admin/floor-plan.tsx`](../apps/mobile/app/admin/floor-plan.tsx) |
| Vendors       | Every counterparty — suppliers, laundry, waste and UCO aggregators  | [`vendors/index.tsx`](../apps/mobile/app/vendors/index.tsx)       |
| People        | Logins and role grants                                              | [`admin/users.tsx`](../apps/mobile/app/admin/users.tsx)           |
| Staff cards   | Who may take custody of material                                    | [`admin/cards.tsx`](../apps/mobile/app/admin/cards.tsx)           |
| Opening stock | The first count, before any flow exists                             | [`stock/opening.tsx`](../apps/mobile/app/stock/opening.tsx)       |

**People and Staff cards are separate on purpose.** People is about logins — who signs in
and what they may do. Staff cards is about identity — who may be handed a sack of rice and
be on the record for it. Most of the property appears on the second and never the first,
and merging them would push every steward through an account flow they cannot use.

**Item import** takes a pasted spreadsheet or a CSV file, resolves headings loosely
(Item Name, Particulars, Description all read the same), and marks perishables from a shelf
life column. [`items/import.tsx`](../apps/mobile/app/items/import.tsx),
[`packages/domain/src/items`](../packages/domain/src/items).

**Creating a login** sends no email. The temporary password appears once on screen for the
administrator to read out, because floor staff mostly have no email address and requiring
one is how a shared account gets invented.

**Known gap.** `revokeRole` exists in `lib/users.ts` with no caller — the app can add
people but not remove them.

### The floor plan

A property's back-of-house, drawn from the locations it already has. It is a **view of
`location`, not a second model of the property** — a location on the plan IS a storage
zone, so nothing is described twice and there is no link between the two to go stale.
[ADR 0017](decisions/0017-living-floor-plan-as-spatial-engine.md), specced in
[`LIVING_FLOOR_PLAN_SPEC.md`](ui-redesign/living-floor-plan/LIVING_FLOOR_PLAN_SPEC.md).

**What is stored.** One table, `facility_room` — the grouping a property adds over its
zones, "Main Kitchen Store" over a chiller, a freezer and a dry store. Everything else is
four nullable columns on `location`: which room it is in, how it is drawn, where its pin's
number comes from, and how big it is on the plan.

**No position is ever stored.** Where a room and a location sit is computed at render time
by [`layoutFloorPlan`](../packages/domain/src/floorplan/layout.ts) — rooms as bays off a
corridor, locations packed into two lanes. That is what lets a property add a room and see
the plan reassemble with no migration and nobody redrawing anything.

**What is drawn is decided by `kind`.** An active `ZONE` is drawn in a room; `SECURITY`,
`RECEIVING` and `DISPATCH` are the fixed scenery; bins, racks and departments are never
drawn. Keying on `kind` rather than on "has somebody set a picture" is what makes the plan
work on day one: a property that has never opened the setup screen still sees the seven
locations provisioning gave it, because the cold room draws as a chiller from its
**regime**.

**Presentation never implies a rule.** `storage_regime` decides what may be stored where
and whether a cold chain applies. `plan_visual_type` decides only what the box looks like,
and nothing may read it to answer an operational question. A property may draw an ambient
room as a chiller — a cheese cave is a real place — and the setup screen says so quietly
rather than refusing, because the regime is the part that carries the consequence.

**Pins show real data or nothing.** Where the number comes from is
`plan_data_behavior`, never the picture, so a chiller-shaped box can legitimately report a
stock count. An empty source renders "No reading yet". There is no placeholder value and
no fallback to another location's reading — an empty pin is information, and a Food Safety
Officer needs to see that this chiller has not been read today.

**The setup screen creates zones**, through the same OWNER/ADMIN policy the zones screen
uses, because a property typing its store in and watching the plan assemble is the point
of the step. **It never creates bins** — those are scanned put-away destinations under
hard rule 13, and a drawing screen must not become a way to conjure somewhere stock can be
dumped without a label.

**How it is drawn.** The scene is isometric SVG in scene units, via `react-native-svg`,
split three ways: [`iso.tsx`](../apps/mobile/components/floor-plan/iso.tsx) is the
projection and the primitives every shape is built from,
[`visuals.tsx`](../apps/mobile/components/floor-plan/visuals.tsx) holds the eight built-in
location renderers, and [`scene.tsx`](../apps/mobile/components/floor-plan/scene.tsx)
assembles the world — grounds, drive, pool, gatehouse, the reefer at the dock, the
building shell, the rooms and the flora. There is no z-buffer, so **draw order is the
drawing**: moving a block changes what stands in front of what.

**Day and night.** The scene follows the device clock — day 06:00–17:59 — with a ☾/☀
control that overrides it and then keeps the override. Every environment-dependent colour
is enumerated for both modes in
[`theme-floor-plan.ts`](../apps/mobile/theme-floor-plan.ts); no scene hex appears in a
component. **The interior does not change between modes** — a store is a lit indoor room
at any hour. What changes is outside: grounds, drive, pool, flora, and whether the path
lamps are burning.

**Deliberately not built yet.** LFP-1 and LFP-2 exist: the data, the CRUD, the setup
screen and the world renderer. **Overlays do not** — room name plates and reading pins are
LFP-3, and they belong in screen space so a label never scales with the world. Nothing in
`scene.tsx` draws text, which is the mechanical form of that rule: if text appears there,
it has been broken. There is also no pan, zoom, level-of-detail ladder, focus dimming or
drill-down yet, nothing is on the dashboard, and no pin reads live data. The plan caps at
4 rooms and 10 locations, enforced in the UI and not in the database, because raising it
is layout work rather than a migration.

---

## The platform console

Our side of the product, not a customer's: who the customers are, how far each has got, and
which modules each property holds. Visible only to platform administrators.

**Why it exists.** Before it, onboarding meant the Supabase SQL editor against production.
Fine for tenant one, a liability by tenant five.

**Where.** [`platform/index.tsx`](../apps/mobile/app/platform/index.tsx),
[`lib/platform.ts`](../apps/mobile/lib/platform.ts),
[`20260819100337_platform_provisioning.sql`](../supabase/migrations/20260819100337_platform_provisioning.sql).

---

## The client

**One app, every surface** (ADR 0015). Expo with web enabled; web ships first (ADR 0014)
and native builds come in Phase 9 from the same source. `apps/mobile` is a leftover name.

**Design system.** Estate Heritage — forest, brass and linen, Playfair Display over Plus
Jakarta Sans. Tokens in [`theme.ts`](../apps/mobile/theme.ts), primitives in
[`components/ui.tsx`](../apps/mobile/components/ui.tsx), the rail in
[`components/shell.tsx`](../apps/mobile/components/shell.tsx). The brief and its amendments
are in [`docs/ui-redesign`](ui-redesign).

**Rules that hold across screens.** No literal colours or font sizes outside `theme.ts`.
Two touch densities: `desk` 44pt and `field` 60pt, the latter for gate and dock screens
where hands are cold and gloved. `Field` is the only text input; the CSV paste area is the
one documented exception.

**Platform splits.** `*.web.ts` / `*.native.ts` pairs behind a shared interface —
outbox storage, session storage, printing, telemetry, barcode camera, file and image
pickers, photo compression. TypeScript resolves the base file, so its signature is what
proves the contract for drivers it never sees.

**The trap in that arrangement.** A driver must not import _runtime values_ from its own
base module: on web the bundler resolves `./photo` to `photo.web.ts`, so such an import is
circular and the values are `undefined`, while tsc resolves the base file and typechecks
it happily. Type-only imports are erased and therefore safe. Shared values live in a module
with no variants — [`lib/photo-limits.ts`](../apps/mobile/lib/photo-limits.ts).

---

## Testing

**pgTAP** is the deployment gate and the only place RLS and privileges are actually
exercised — it needs Docker, so it runs in CI and not locally (ADR 0013). Tests write as
`authenticated`, never as the superuser, because a test running as owner proves the logic
and says nothing about whether a real user is permitted.

**Domain unit tests** cover state transitions, check digits and shelf-life maths — the
highest-value tests in the repo.

**Schema sweeps** ask a question of the catalogue rather than of today's rows, so they can
fail for an object nobody has written yet. There are three: every table has RLS
([`001`](../supabase/tests/001-rls-sweep.test.sql)), `anon` holds nothing and a table born
inside the transaction confirms the default privilege is real
([`030`](../supabase/tests/030-privilege-matrix.test.sql)), and no foreign key would null a
`not null` column when its parent row is deleted
([`036`](../supabase/tests/036-on-delete-set-null.test.sql)). The last exists because
`on delete set null` nulls _every_ column in a composite key, and CLAUDE.md 4 makes nearly
every key here composite over a `not null` `property_id` — so the natural clause is an
instruction to erase a row's tenant. It shipped twice. Each sweep carries a canary that
plants a violation and asserts the sweep sees it, because a check that can only return the
answer you expect is not a check.

**Before pushing:** `pnpm typecheck && pnpm test && pnpm build && pnpm format:check`, plus
`node scripts/check-test-plans.mjs` when a pgTAP file changed. Green types are not evidence
it ships; `pnpm build` is.

---

## What is deliberately not built

Recorded so nobody goes looking for it, or worse, assumes it is there.

- **Gate 7**, inter-zone transfer — V2.
- **Inspection templates** (Gate 3a) — the configurable engine is `[P1]` and unbuilt; only
  the hard-coded non-negotiable floor exists.
- **The scannable vendor card** (Gate 0b) — `party` carries code, type and hold status, but
  the code is typed by an administrator, has no check digit, and there is no QR or offline
  vendor cache.
- **Photo capture on native** — web only until Phase 9.
- **Retention sweep** — dates are recorded, nothing is deleted.
- **Removing a person from the team** — `revokeRole` has no UI.
