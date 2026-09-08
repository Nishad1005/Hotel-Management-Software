# Phase 1 gap analysis — PRD Rev 02 against the build

Scored on 2026-09-08 against [`PRD_PAR_Golai_Material_Flow_Rev02.md`](PRD_PAR_Golai_Material_Flow_Rev02.md)
§14, which is the PRD's own definition of Phase 1 done. Twenty-four criteria, scored as
met, partial, or not started.

This is a snapshot, not a plan. It records what was true at a point in time and how each
line was checked, so a later reader can tell an untested claim from a verified one.

## How each line was checked

Three different strengths of evidence appear below, and they are not interchangeable:

- **Verified** — exercised end to end against the production database through the built
  web bundle, using a server-issued number or an exact quantity as the discriminator, and
  confirmed from a different screen than the one that claimed to do the work.
- **Present** — the table, function or screen exists and was read, but no one has run it.
- **Absent** — searched for and not found. Where a word appears only in a comment, that is
  called out, because grepping a term and finding hits is not the same as it being built.

---

## Scoreboard

| #   | Criterion                                                      | State           | Evidence                                                              |
| --- | -------------------------------------------------------------- | --------------- | --------------------------------------------------------------------- |
| 1   | Nothing enters without a Gate Entry Number                     | Met             | Verified — `TW-GE-000608`                                             |
| 2   | Nothing leaves without a Gate Pass, no exception path          | Present         | `gate_pass`, `gate-out/index.tsx`; untested                           |
| 3   | Every Gate Entry resolves to a GRN or raises an alert          | Partial         | `list_open_gate_entries` gives the worklist; no aged escalation found |
| 4   | Every Gate Pass resolves to a Dispatch Note or raises an alert | Partial         | `dispatch_note` present; the alerting half not confirmed              |
| 5   | Stock at T1 cannot be issued                                   | Met             | Verified — T1 lots count as "not issuable yet"                        |
| 6   | Issuable only after a destination bin label is scanned         | Met             | Verified — put-away into `TW-DRY-A1`                                  |
| 7   | In-transit stock issuable at neither end                       | Partial         | State exists in the enum; Gate 7 itself is V2                         |
| 8   | Perishable expiry, cold-chain probe **and photograph**         | Partial         | Expiry and probe verified; **photograph absent**                      |
| 9   | No-bill unregistered vendor received in under four minutes     | Met             | Verified — the flow test does exactly this                            |
| 10  | Posted GRN cannot be edited, only amended with a trail         | Met             | `amend_grn` present with its trail                                    |
| 11  | Batch records for every batch-controlled line                  | Met             | Verified — `SYS-TW-GRN-000003-01` generated                           |
| 12  | Inward check and waste registers, zero extra entry             | Met             | Registers screen reads from the flow                                  |
| 13  | Forward and backward trace from any batch                      | Met             | `registers/trace/[batch].tsx`                                         |
| 14  | Rejected stock cannot reach a zone                             | Met             | State machine forbids the transition                                  |
| 15  | Returnable dispatch on an aged outstanding register            | Present         | `returnable_item` + screen; untested                                  |
| 16  | Scannable system-generated party ID                            | **Not started** | See below                                                             |
| 17  | No custody change without a card scan                          | **Not started** | See below                                                             |
| 18  | Receiver's photograph from cache, no network                   | **Not started** | Depends on 17                                                         |
| 19  | Deactivated card stops working server-side                     | **Not started** | Depends on 17                                                         |
| 20  | Admin builds/edits/versions/disables inspection templates      | **Not started** | See below                                                             |
| 21  | Each inspection field independently visible/mandatory/blocking | **Not started** | Depends on 20                                                         |
| 22  | Switching every optional check off leaves the floor            | Met             | The floor is what exists today                                        |
| 23  | Editing a live template never alters a past record             | **Not started** | Depends on 20                                                         |
| 24  | Full flow offline except put-away confirmation and gate-out    | Met (flow)      | Verified with the network cut — see below                             |

Roughly fourteen met, four present-but-unverified, six not started.

---

## Where the gaps are

### Offline coverage (criterion 24) — closed for the flow gates

**Was** the largest gap and is now the smallest. The outbox had been built and tested
while only gate entries and temperature rounds ever called it — the two captures that
happen to be single rows — so everything at the dock went straight to the server and
simply failed without a network, at the place §13 identifies as the weakest network
point on the property.

The blocker was the transport, not the server: `post_grn`, `issue_stock` and
`stage_for_dispatch` all already took a submission key and replayed safely. What the
outbox could not do was carry anything that was not an insert. `SyncTarget` is now a
union of a row to insert or a function to call, and the queue carries five capture
types:

| Capture               | Gate | State                      |
| --------------------- | ---- | -------------------------- |
| `GATE_ENTRY`          | 0    | queues                     |
| `GRN_POST`            | 1–5  | queues                     |
| `ISSUE_STOCK`         | 8    | queues                     |
| `DISPATCH_STAGE`      | 9    | queues                     |
| `TEMPERATURE_READING` | —    | queues                     |
| put-away confirmation | 6    | **online by design** (§13) |
| `issue_gate_pass`     | 10   | **online by design** (§13) |

Each was verified with the browser actually offline rather than by asking the code
whether it would have queued, and confirmed by a change only the server could cause —
the arrival leaving the receiving worklist, a lot going 2 KG to 1 KG, the count of notes
awaiting a pass going up.

**Scored "Met (flow)" rather than "Met", deliberately.** The gates are covered; two
writes outside them were not taken offline and have not been assessed — receiving a
returnable back, and amending a posted GRN. Neither is a gate in §4–§6, so whether
criterion 24's "full flow" reaches them is a question for whoever settles the scope
discrepancy below, not something to quietly assume either way.

### Evidence vault and photographs (criterion 8, §7.2)

No storage bucket, no attachment table, no client-side compression path. §13 requires
photos under 400 KB, content-addressed, immutable, with `retention_until`; §7.2 lists an
evidence vault of "every photo and document, every gate" as `[P1]`. The gate screen says
"Photograph bill — Coming soon", which is honest and also a Phase 1 line item.

### Staff cards and the person master (criteria 17, 18, 19)

Criterion 17 is the strong one: _no material changes custody anywhere in the property
without a card scan._ Today the issue screen types a name, and says so on screen — "Staff
cards are not built yet, so this records who the storekeeper says collected it rather than
proving who did." That honesty is correct under §2's witness-before-enforce principle, but
the record currently carries an assertion the system cannot back.

Needs a person master, card identities, cached photographs for offline display, and
server-side deactivation.

### Configurable inspection templates — Gate 3a (criteria 20, 21, 22, 23)

Four of the twenty-four criteria. An administrator building, versioning and switching off
templates, with every field independently visible/hidden, mandatory/optional and
blocking/non-blocking, and edits never altering a past inspection record.

Only the hard-coded non-negotiable floor exists. Criterion 22 — the floor survives with
every optional check off — is therefore met by construction, but the engine around it is
not built. "Inspection" appears in the migrations only inside two comments.

### Scannable party ID — Gate 0b (criterion 16)

The entity is right: `party` carries `code`, `party_type`, `on_hold` and `hold_reason`,
and [ADR 0007](decisions/0007-qr-carries-id-only.md) already settles that the QR carries
the identifier only. What is missing is everything around it — the code is typed by an
administrator rather than system-generated, there is **no check digit**, no QR issuance or
printed card, no offline vendor-master cache, and no outstanding-returnables display on
scan. The PRD calls gate-side vendor identification "the single biggest speed and accuracy
problem in the Gate 0 flow".

---

## A scope discrepancy to settle

`CLAUDE.md` defines V1 as "Gates 0–6 and 8", with Gates 7, 9, 10 and the returnable
register as V2. **The PRD tags Gate 9, Gate 10 and the returnable register `[P1]`**, and
criteria 2, 4 and 15 depend on all three.

The code has them — `dispatch_note`, `dispatch_line`, `gate_pass`, `returnable_item` and
their screens all exist. They are simply untested.

So "Phase 1" currently means two different things in the two governing documents. Which
one is authoritative changes whether four criteria are in scope, and it should be decided
before anyone calls Phase 1 complete.

---

## Suggested order

1. ~~Offline coverage~~ — done for the flow gates.
2. **Staff cards.** Three criteria, and until it lands the issue record asserts something
   the system cannot substantiate.
3. **Inspection template engine.** Four criteria, self-contained, no dependency on the
   above.
4. **Photographs and the vendor QR.** Both self-contained and can follow in either order.

Testing Gates 9 and 10 and the returnable register belongs wherever the scope question
above lands.
