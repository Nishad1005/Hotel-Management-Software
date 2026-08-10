# PRD — Material Flow Control, with Inbuilt FSSAI Audit

**Doc ID:** DBBS/GOLAI/PRD/PAR/01 · **Rev 02**
**Product:** PAR Golai — stock control for hotels and restaurants
**Module:** Material Flow (Security → T1 → Zones → Departments → T2 → Security)
**Audience:** Golai architect and build team
**Reference deployment:** Voyage The Solitaire Bliss, Tinsukia, Assam

> **Rev 02 changes:** Security is established as the primary capture point, not Terminal 1. Terminal 2 (dispatch) is added, closing the outbound loop. Gates renumbered. Supersedes Rev 01 and all earlier T1 documents.

> **Repo note:** this file is the committed source of truth for requirements. Character encoding was repaired and the flow diagram redrawn when it was brought into the repository; no requirement text was altered.

---

## How to read this

Every requirement carries a phase tag. **`[P1]` is the go-live build.** Later phases are specified now so the data model is right, but are not built now.

`[P1]` record everything, enforce almost nothing · `[P2]` rules switch on as warnings · `[P3]` selected rules block; regulatory capture · `[P4]` automation

---

## 1. The material flow

```
                    ┌──────────────────────────────────────────┐
   vendor  ────────►│            S E C U R I T Y               │────────► out
                    │      PRIMARY CAPTURE — both directions   │
                    └───────────────┬──────────────▲───────────┘
                                    │              │
                           Gate Entry No.     Gate Pass No.
                                    │              │
                                    ▼              │
                         ┌────────────────┐  ┌─────┴────────┐
                         │  TERMINAL 1    │  │ TERMINAL 2   │
                         │  Q & Q         │  │ DISPATCH     │
                         └───────┬────────┘  └─────▲────────┘
                                 │                 │
                                 ▼                 │
                         ┌───────────────────────────────────┐
                         │            Z O N E S              │
                         └───────┬──────────────────▲────────┘
                                 │                  │
                              issue              return
                                 ▼                  │
                         ┌───────────────────────────────────┐
                         │        D E P A R T M E N T S      │
                         └───────────────────────────────────┘
                           kitchen · bar · housekeeping ·
                           laundry · engineering · banquet
```

**Security is the bookend.** Nothing enters the property without a Gate Entry Number. Nothing leaves without a Gate Pass Number. Every downstream record hangs off one of those two numbers.

**Terminal 1 is the quantity and quality point.** Terminal 2 is the departure point. Zones store. Departments consume.

### The reconciliation control

This is the reason Security captures first rather than T1.

> **Every Gate Entry must resolve to a GRN. Every Gate Pass must resolve to a Dispatch Note.**

An open Gate Entry with no GRN after a configured window means goods came through the gate and never reached the store. An open Gate Pass with no Dispatch Note means something left without a record of what. Both are alerts, both are on the GM's dashboard, and both are the single most valuable control in this module.

If T1 were the first capture point, material that never reaches T1 would be invisible. That is precisely the leak this design closes.

---

## 2. Three principles

**1. Received ≠ accepted ≠ available.** Stock at T1 exists in the system but cannot be issued. It becomes issuable only when physically put away into a zone and confirmed by scanning the destination label.

**2. Witness before you enforce.** Where the property cannot refuse a delivery, the system must not pretend it can. An unenforceable rule produces click-through, which is worse than no rule — the record then carries a false assertion instead of an honest gap. At go-live the gates record; they do not refuse.

**3. Compliance is a by-product, not a second job.** FSSAI registers are populated by the material flow itself. If a storekeeper enters the same temperature twice, once for stock and once for compliance, the compliance entry will be fabricated within a fortnight.

---

## 3. Architecture

### 3.1 Locations

| Location | Role |
|---|---|
| `SB-SEC` | Security gate. Notional location — holds nothing, but every movement references it |
| `SB-T1-RCV` | Terminal 1 receiving bay. Real, countable |
| `SB-T1-REJ` | Rejected goods hold. Physically segregated and labelled |
| `SB-{store}-{zone}-{rack}-{shelf}` | Operating zones |
| `SB-T2-DSP` | Terminal 2 dispatch staging. Real, countable |

### 3.2 Stock states

| State | Location | Issuable | On stock report |
|---|---|---|---|
| `QUARANTINE` | T1 | No | Yes, flagged |
| `AVAILABLE` | zone bin | Yes | Yes |
| `TRANSIT` | between zones | No | Yes, flagged |
| `ISSUED` | department | No | No — consumed or held at outlet |
| `STAGED_OUT` | T2 | No | Yes, flagged as pending departure |
| `REJECT_HOLD` | T1-REJ | No | No — supplier liability |
| `BLOCKED` | zone bin | No | Yes — FSO hold |

---

## 4. Inbound gates

### Gate 0 — Security · primary capture `[P1]`

The record begins here, before anything is unloaded. Security does not judge quality and does not weigh. Security establishes that something arrived, from whom, with what paperwork, and how many packages.

| Field | Phase |
|---|---|
| **Gate Entry Number** — generated, sequential, immutable | `[P1]` |
| Timestamp in, server clock | `[P1]` |
| Vendor — from list, or created with name + phone | `[P1]` |
| Bill photo — printed, handwritten, or "no bill" as a valid answer | `[P1]` |
| Package count | `[P1]` |
| Vehicle number and mode — truck, tempo, two-wheeler, hand-cart | `[P1]` |
| Driver name and phone | `[P2]` |
| Vehicle type — ambient / insulated / reefer | `[P2]` |
| Reefer display temperature + photo | `[P2]` |
| PO reference, if known | `[P2]` |
| Vehicle hygiene checklist, photo-led | `[P2]` |
| Supplier FSSAI licence validity check | `[P3]` |
| GSTIN, e-way bill | `[P3]` |
| Timestamp out — vehicle leaves | `[P1]` |

**Arrival types:** `PO_DELIVERY` · `MARKET_PURCHASE` `[P3]` · `RETURN_FROM_OUTLET` · `TRANSFER_IN` · `SAMPLE`

**Open Gate Entry alert `[P1]`:** a Gate Entry with no GRN after a configured window — default 4 hours — escalates to the storekeeper, then the GM.

### Gate 0a — Security operates the app directly `[P1]`

**Decision taken: no paper security register.** The gate entry is created in Golai, at the gate, by the security officer, at the moment the vehicle arrives. Nothing is written on paper for someone to key in later.

This is not a preference — it is what makes the reconciliation control real. A paper register re-keyed by the storekeeper at 4pm produces a record that agrees with the GRN by construction, because the same person wrote both. The control only exists if the two records are created by different people at different times.

**What this demands of the build:**

| Requirement | Phase |
|---|---|
| Security is a named app user with a role limited to Gate 0 and Gate 10 | `[P1]` |
| **PIN login, not password.** Gloved hands, night shift, poor light | `[P1]` |
| Two-tap common path: vendor → photo → package count → done | `[P1]` |
| Local-language interface, icon-led. Security staff are often the least trained users on site | `[P1]` |
| Minimal typing — vendor from a searchable list, quantities as package counts only | `[P1]` |
| **Gate entry number displayed immediately** and written by the officer onto the vendor's physical challan, bridging paper to app | `[P1]` |
| A gate entry, once created, cannot be edited or deleted by Security — only appended to | `[P1]` |
| **Full offline operation.** The boundary wall is the weakest network point on any property | `[P1]` |
| Minimal-capture path — vendor + photo + count only, with the rest completed at T1 | `[P1]` |
| Shift handover in-app: open gate entries, pending returnables, outstanding vehicles | `[P2]` |
| Guard roster and supervisor-managed user creation | `[P2]` |

**Attrition is the design constraint.** Security is frequently outsourced agency staff with high churn, so the flow must be learnable in one shift by someone who has never seen the app. If it takes a training session, it will not survive the third guard.

**No fallback to paper.** When the network is down, offline mode is the fallback — not a notebook. A paper register reintroduced "just for emergencies" becomes permanent within a month and the control is gone.

**Out of scope:** visitor entry, staff movement, key handover and night rounds are gate functions but not material flow. If the property wants them digitised, they belong in the Golai TOWER module, not here. Confirm at Phase 0 so the guard is not running two apps.

### Gate 0b — Scannable Vendor ID `[P1]`

Every registered vendor carries a **system-generated identity that Security scans**. Vendor identification at the gate becomes one scan instead of a name search — which is the single biggest speed and accuracy problem in the Gate 0 flow.

**Format**

| Element | Specification |
|---|---|
| Vendor code | `SB-VEN-0042` — sequential, system-generated, with a check digit so a typed code cannot be silently wrong |
| Machine-readable | **QR encoding the vendor ID only** — never licence data, never contact details |
| Human-readable | Code and vendor name printed alongside, for when the QR is damaged |
| Manual fallback | The code can be typed; the check digit catches errors |

**Why the QR carries only the ID:** everything else goes stale. Licence validity, tier and hold status are resolved server-side at scan time, so a vendor's status can change without reissuing a single card.

**What appears on scan `[P1]`**

- Vendor name, tier, and registration status
- On-hold flag, in red, before anything is unloaded
- FSSAI licence validity `[P3]`
- Open purchase orders for this vendor `[P2]`
- **Outstanding empties and returnables owed by or to this vendor** `[P1]`

That last line turns the gate into a collection point. The guard sees "18 crates outstanding" at the moment the vendor is standing there, which is the only moment recovery is easy.

**Issuance**

| Requirement | Phase |
|---|---|
| Digital-first — QR sent to the vendor's phone over WhatsApp, zero cost, instantly reissuable | `[P1]` |
| Printed laminated card for vendors without a smartphone | `[P1]` |
| Card carries the property's name and "quote this number on every bill" — improving the paper trail at source | `[P1]` |
| Revocation is server-side status, never card recall | `[P1]` |
| Reissue on loss without changing the vendor ID | `[P1]` |

**The QR is an identifier, not a credential.** It authorises nothing. Scanning it identifies a party; every check and approval still runs normally. There is no PII on the card and no authentication risk in a copied one — a blacklisted vendor's card scans successfully and displays as blocked, which is the desired behaviour.

**Offline `[P1]`:** the security device caches the vendor master, so scan-to-identify works with no network.

**Party types, not just vendors.** The same ID applies to every counterparty that transacts at the gate — vendors, contractors, external laundry, waste and used-cooking-oil aggregators, outdoor-catering carriers, sister properties. Build one `Party` entity with a type discriminator rather than a vendor-only card, because Terminal 2 needs to scan the laundry and the waste aggregator exactly as Terminal 1 scans the vendor.

**Commercial use.** The card is a tangible reward, which makes the T3 → T2 registration drive far easier to sell. Pair it with a **carded-vendor fast lane** at the gate: registered vendors are identified and cleared in seconds, unregistered ones wait while their details are typed. A queue is a more persuasive argument than a policy.

### Gate 1 — T1 arrival `[P1]`

Material physically reaches Terminal 1 and is linked to its Gate Entry. Package count reconciled against what Security recorded. Discrepancy is a flag, not a block, at `[P1]`.

### Gate 2 — Quantity, the first Q

| Requirement | Phase |
|---|---|
| Item from item master — **must exist**, no dock creation | `[P1]` |
| Quantity + UOM as physically received | `[P1]` |
| UOM conversion to base unit, automatic | `[P1]` |
| Tare from crate master, wet and dry tare | `[P2]` |
| Three-way match — PO / challan / physical | `[P2]` |
| Variance vs PO against category tolerance | `[P2]` |
| Scale ID recorded on every weighed line | `[P3]` |
| Weighbridge and scale integration | `[P4]` |

### Gate 3 — Quality and batch, the second Q

**Batch is created here.** Every batch-controlled line gets a batch record even when the vendor supplies no number — generate `SYS-{GRN}-{line}`.

| Requirement | Phase |
|---|---|
| Best-before / expiry — mandatory on perishables | `[P1]` |
| Product probe temperature + photo — mandatory on cold-chain | `[P1]` |
| One photo of goods per perishable line | `[P1]` |
| Batch record with remaining shelf life computed | `[P1]` |
| Category checklist templates, versioned | `[P2]` |
| Minimum remaining shelf-life rule | `[P2]` |
| Temperature range validation | `[P2]` |
| Trim and wastage % on fresh produce | `[P2]` |
| Sampling rule — √n min 3; 10% for high-risk | `[P2]` |
| Legal Metrology label checks — MRP, net qty, packer, veg/non-veg mark | `[P3]` |
| Probe ID and calibration date | `[P3]` |
| IoT sensor feed | `[P4]` |

**Minimum shelf-life defaults `[P2]`:** dairy and bakery 60% · chilled meat and fish 70% · frozen and packaged 75% · dry provisions 70%.

### Gate 3a — Configurable inspection form `[P1 engine, P2 library]`

The quality check at T1 is **not a fixed form**. It is a template the property builds and switches on or off. Some managements will inspect nothing beyond expiry and temperature; others will want fifteen checks on every meat delivery. Both must be possible without a code change, and the difference must be a setting a manager can change on a Tuesday afternoon.

#### Three independent switches per field

This is the core of the model. Every field carries all three, set separately:

| Switch | Question | Values |
|---|---|---|
| **Visible** | Is this field on the form at all? | On / Off |
| **Mandatory** | Must it be filled before the line can be submitted? | Always / Conditional / Never |
| **Blocking** | Does a fail value stop acceptance? | Block / Warn / Record only |

A field can be visible and optional. It can be visible, mandatory, and still non-blocking — the storekeeper must answer, but a bad answer does not stop the delivery. It can be visible, optional and blocking, so it is only asked when relevant but decides the outcome when answered. Keeping the three separate is what makes the same engine serve a lax property and a strict one.

#### Field types

| Type | Use |
|---|---|
| Checkbox / pass-fail | Packaging intact · seal intact · no pest evidence · label legible · no foreign matter |
| Number | Temperature · weight · piece count · trim % · drip loss % · brix |
| Date | Best before · manufacture · packing |
| Text | Batch number · remarks |
| Single-select | Grade A/B/C · condition Good/Fair/Poor · colour · odour |
| Multi-select | Defects observed |
| Photo | One or many, mandatory or optional |
| Rating | 1–5 scale for overall condition |
| Signature | Chef or FSO sign-off on the line |

**Numeric fields carry min, max and target.** Out-of-range triggers the blocking behaviour set on that field, so "temperature between 0 and 4" is configuration, not code.

#### Conditional logic `[P2]`

Fields appear and become mandatory based on what has already been answered:

- `Temperature` visible only when the item is flagged cold-chain
- `Corrective action taken` becomes mandatory only when `Temperature` is out of range
- `Photo of defect` becomes mandatory only when `Condition = Poor`
- `Veterinary mark present` visible only for category = meat and poultry

This is what keeps a rich template short in practice. The form asks fifteen questions only on the delivery that needs fifteen questions.

#### Template assignment

Templates resolve by specificity, most specific winning:

```
Global default  →  Category  →  Sub-category  →  Item  →  Vendor tier
```

A property can run one template for everything, or a different one for river fish than for packaged goods. Where no template resolves, T1 falls back to the `[P1]` minimum — quantity, expiry on perishables, temperature on cold-chain — which is never removable.

#### Non-negotiable floor

Whatever management switches off, four things remain and are not configurable:

1. Item, quantity and UOM
2. Best-before date on any item flagged perishable
3. Probe temperature and its photograph on any item flagged cold-chain
4. Accept / reject decision with a reason

Everything above that floor is the property's choice.

#### Per-delivery flexibility `[P1]`

- The storekeeper may **add an ad-hoc photograph or remark** to any line, even where the template does not ask for one
- Where the property permits it, the storekeeper may **switch to a different template** for an unusual delivery — logged, with the substitution visible on the inspection record
- A **Quick Mode** completes the floor fields only, for a routine delivery from a trusted vendor. Configurable per vendor tier, and every Quick Mode use is counted and reported

#### Template administration `[P1]`

- Built and edited by the Administrator or Food Safety Officer from an admin screen. **No developer involvement, ever** — this is the requirement that makes the feature real rather than theoretical
- **Versioned.** Editing a live template creates a new version; past inspections retain the version they were taken under, so historical records are never retro-altered
- Multilingual labels — Assamese, Hindi, English — entered per field
- Preview mode showing the form as the storekeeper will see it
- Clone-and-edit from an existing template

#### Guardrails against form bloat

A template nobody can complete is worse than no template. The engine must push back:

- **Warning in the admin screen when a template exceeds 10 visible fields**, with the average completion time shown
- **Median completion time reported per template**, so management can see what it has actually imposed on the dock
- Any field answered identically on 100% of deliveries for 90 days is flagged — it is either meaningless or being clicked through (see §8)

#### Shipped template library `[P2]`

Golai ships pre-built hospitality inspection templates the property switches on rather than builds: dairy · chilled meat and poultry · fish and seafood · frozen · fresh produce · bakery · dry provisions · packaged and tinned · beverages · bar stock · housekeeping chemicals · linen · engineering spares · LPG and fuel.

This is a commercial asset as much as a feature. A property that has never written an inspection checklist gets a professionally structured one on day one, and ACG's role becomes tuning rather than authoring.

### Gate 4 — Decision

Per **line**, not per arrival. `ACCEPT` · `ACCEPT_PARTIAL` · `REJECT`

**Reject reasons `[P1]` — six only:** Short shelf life · Not cold enough · Poor quality · Damaged · Wrong item · Other

Extended codes at `[P2]`. Rejected stock moves to `SB-T1-REJ`, held off book, and **can never transition to a zone** — the state machine does not permit it. It leaves via Terminal 2 on a supplier-return gate pass.

### Gate 5 — GRN posting

| Requirement | Phase |
|---|---|
| GRN generated, **immutable**, linked to Gate Entry Number | `[P1]` |
| Stock posted to T1 in `QUARANTINE` | `[P1]` |
| Documents and photos bound to the GRN | `[P1]` |
| Batch records written | `[P1]` |
| **FSSAI inward check record written in the same transaction** | `[P1]` |
| Amendment flow — reason, authority, before/after trail | `[P1]` |
| PO line closed / part-pending / short-closed | `[P2]` |

### Gate 6 — Put-away to zone

| Requirement | Phase |
|---|---|
| System proposes destination bin from item default location | `[P1]` |
| **Destination label must be scanned** — typing a code is not permitted | `[P1]` |
| Stock moves `T1 QUARANTINE → zone AVAILABLE` | `[P1]` |
| Split put-away across bins, quantities must sum | `[P2]` |
| Regime validation — chilled cannot go to ambient. **Hard block, no override** | `[P2]` |
| T1 dwell timer, amber/red escalation | `[P2]` |
| Dwell breach recorded permanently against the batch | `[P2]` |

**Dwell limits `[P2]`, Assam defaults:** frozen 15 min · chilled 20 min · produce 30 min · ambient 4 hrs · non-food 8 hrs. Seasonally configurable.

---

## 5. Internal movement

### Gate 7 — Inter-zone transfer

Stock stays under store control; ownership does not pass to a department.

**Reasons:** `REPLENISH_SUB_STORE` (main → bar store, main → kitchen sub-store) · `CONSOLIDATE` · `REGIME_CORRECTION` · `QUARANTINE_RELEASE` · `RECALL_SEGREGATION` `[P3]`

| Requirement | Phase |
|---|---|
| Two-sided — despatch and receipt, **both scanned** | `[P1]` |
| Stock enters `TRANSIT` between scans, issuable at neither end | `[P1]` |
| Batch identity preserved — never merged, never re-dated | `[P1]` |
| Destination regime validation | `[P2]` |
| Cold-chain transfer clock | `[P2]` |
| Temperature at receipt for cold-chain transfers | `[P2]` |
| Unreceived transfers escalate after a threshold | `[P2]` |

**Why `TRANSIT` is its own state:** without it, stock walking from the cold room to the bar store is either double-counted or invisible. Both are wrong, and wrong exactly where the high-value items move.

### Gate 8 — Zone → Department, scan to receive

Full requisition and approval logic belongs to the **Issuance module**. This PRD defines the handoff and the acknowledgement.

| Requirement | Phase |
|---|---|
| Stock leaves the zone and enters `ISSUED` against a department or event code | `[P1]` |
| **The receiver scans their own card. The scan is the acknowledgement** | `[P1]` |
| An issue is not closed until it is scan-acknowledged | `[P1]` |
| Batch selected by configured issue method — FEFO for perishables, FIFO otherwise | `[P2]` |
| Return-to-store reverses to the original batch where identity is preserved | `[P1]` |
| Department-held stock is visible but not counted as store stock | `[P1]` |

**The scan replaces the signature.** A signature on an issue slip identifies a scrawl. A card scan identifies a person, at a timestamp, against a specific batch from a specific bin. This is the accountability leg of the Golai Test, and it is the point at which the whole chain becomes a chain rather than a set of records.

#### Staff identity `[P1]`

Every person who can receive material carries a **system-generated card**, on the same scheme as the vendor ID at Gate 0b.

| Element | Specification |
|---|---|
| Person code | `SB-EMP-0117` — sequential, check digit |
| Machine-readable | QR encoding the **person ID only** |
| Printed on card | Photograph, name, code, department |
| Manual entry | Not permitted. See the exception path below |

**Identity is not access.** Most receivers — stewards, commis, housekeeping attendants, banquet staff — will never hold app credentials. The card gives them a verifiable identity without giving them a login. A subset of card-holders are also app users; the card links to that user record where it exists, and stands alone where it does not.

**Operating flow:** the receiver presents the card, the **storekeeper scans it on the storekeeper's device**. The receiver does not operate the app. One device, one scan, two seconds.

**Photo verification `[P1]`:** on scan, the person's photograph from the staff master displays on the storekeeper's screen. The storekeeper confirms it is the person standing in front of them. A borrowed card is the obvious attack on this control, and a photograph on screen defeats it at almost no cost in time.

**Authority check `[P2]`:** the system flags an issue where the receiver's department does not match the requisitioning department. A housekeeping attendant collecting kitchen provisions is not necessarily wrong, but it should never be silent.

**Exception path `[P1]`:** a forgotten or lost card is handled by **supervisor override with a reason code**, not by typing a name. The override carries the supervisor's identity, so the accountability moves rather than disappearing. Overrides appear on a weekly exception report; a receiver who is repeatedly "without a card" is exactly what that report is for.

**Deactivation `[P1]`** is server-side and immediate. Contract, agency and daily-wage staff turn over quickly; a card revoked on exit stops working before the person reaches the gate. No card recall, no reissue of anyone else's card.

**Offline `[P1]`:** the staff master, with photographs, is cached on the storekeeper's device.

#### Where else scan-to-receive applies

| Point | Who scans |
|---|---|
| Gate 7 — inter-zone transfer receipt | Receiving zone custodian |
| Gate 8 — department issue | Receiving department representative |
| Return to store | The person returning the material |
| Banquet event issue | Banquet representative, against the event code |
| Gate 9 — dispatch staging | The person carrying the material out |

The rule is uniform: **material changes hands only when a card is scanned.** No custody transfer anywhere in the property is anonymous.

#### Two integrations to build for, not around

**FSSAI food handler status `[P2]`.** Medical fitness certificates and FoSTaC training records attach to the person record. On scan, an expired medical certificate on someone receiving food material raises a warning — the compliance register and the issue counter become the same check, which is the whole design claim of Section 7 applied to people rather than goods.

**One card, not two `[P1]`.** Golai TOWER covers attendance for the site compliance module. The staff card must serve both attendance and material receipt from day one. Two card systems on one site is the fastest way to have neither used.

---

## 6. Outbound gates — Terminal 2

Everything leaving the property passes T2 and then Security. Nothing goes out of a back door.

### What departs

| Type | Origin | Returnable |
|---|---|---|
| Supplier return — rejected goods | T1-REJ | No |
| Empties — bottles, crates, cylinders, containers | Zone or department | Yes, exchange |
| Linen to external laundry | Zone | **Yes** |
| Equipment for repair | Zone or department | **Yes** |
| Outdoor catering despatch — food, equipment, crockery | Zone or department | **Yes, partly** |
| Inter-property transfer | Zone | No |
| Condemned and expired stock disposal | Zone or T1-REJ | No |
| Food waste and swill | Department | No |
| Used cooking oil | Department | No |
| Scrap, packaging and recyclables | Any | No |

### Gate 9 — T2 staging `[P1]`

| Requirement | Phase |
|---|---|
| Dispatch Note created, linked to origin location and batch | `[P1]` |
| Stock moves to `SB-T2-DSP` in state `STAGED_OUT`, not issuable | `[P1]` |
| Dispatch type and reason code | `[P1]` |
| Photo of goods staged | `[P1]` |
| Recipient — vendor, laundry, contractor, event, sister property | `[P1]` |
| **Returnable flag + expected return date** | `[P1]` |
| Weighing for scrap and waste | `[P2]` |
| Authorisation by value and type | `[P2]` |

### Gate 10 — Security gate-out `[P1]`

| Requirement | Phase |
|---|---|
| **Gate Pass Number** generated, sequential, immutable | `[P1]` |
| Physical verification against the Dispatch Note — package count | `[P1]` |
| Vehicle and carrier recorded, timestamp out | `[P1]` |
| Printed gate pass with the number visible | `[P1]` |
| Nothing leaves without a gate pass — **no exception path in the UI** | `[P1]` |
| Open Gate Pass alert where no Dispatch Note exists | `[P1]` |

### Returnable register `[P1]`

The control that pays for itself. Linen sent to laundry, equipment sent for repair, crockery sent to an outdoor event — all leave with an expected return date and stay on an outstanding register until they come back.

| Requirement | Phase |
|---|---|
| Outstanding returnables report, aged | `[P1]` |
| Return receipt at Security → T2 → back to zone, with condition assessment | `[P1]` |
| Shortfall on return recorded as loss against the responsible department | `[P1]` |
| Overdue returnables escalate to the GM | `[P2]` |
| Empties reconciliation — full-for-empty, cylinder-for-cylinder | `[P2]` |

### Gate 11 — Terminal clearance `[P1]`

T1 and T2 both close for the session. T1 cannot clear while any line sits in `QUARANTINE`. T2 cannot clear while anything sits in `STAGED_OUT`. Session summary on both.

---

## 7. FSSAI audit module — inbuilt

### 7.1 The design claim

The FSSAI module is not a checklist app sitting beside Golai. It runs on data the flow already holds: the cold room that must be temperature-logged **is a location**; the batch traced in a recall **is created at Gate 3**; the vendor whose licence must be valid **is in the vendor master**; the waste consignment an inspector asks about **is a Gate 9 dispatch record**.

**Nothing is entered twice.** That is the product argument.

### 7.2 Registers auto-populated by the flow

| Register | Fed by | Extra entry | Phase |
|---|---|---|---|
| Inward material check | Gates 0–3, complete | **None** | `[P1]` |
| Receipt temperature record | Gate 3 probe | None | `[P1]` |
| Non-conforming material | Gate 4 rejections | None | `[P1]` |
| Traceability — batch to zone to department | Gates 3, 6, 7, 8 | None | `[P1]` |
| **Waste disposal register** | Gate 9 dispatch, waste types | None | `[P1]` |
| **Used cooking oil disposal** | Gate 9, UCO type | Aggregator details | `[P2]` |
| Condemned stock disposal | Gate 9 + write-off | Authority | `[P2]` |
| Vendor compliance | Vendor master + Gate 0 check | None | `[P3]` |
| Cold chain break | Gate 6/7 dwell + power events | Reason code | `[P2]` |
| Vehicle and transport hygiene | Gate 0 checklist | None | `[P2]` |
| Linen and laundry hygiene | Gate 9/10 returnables | None | `[P2]` |
| Evidence vault | Every photo and document, every gate | None | `[P1]` |

**Used cooking oil is worth building properly.** FSSAI requires food businesses above a fryer-volume threshold to record UCO disposal to registered collection agencies. Because UCO already leaves through T2, the register is a filtered view of dispatch records rather than a separate log — quantity, date, aggregator, and the collection receipt photograph.

### 7.3 Registers needing their own entry

Not produced by material movement, so they need light standalone screens:

| Register | Frequency | Phase |
|---|---|---|
| Storage temperature rounds — cold rooms, freezers, hot holding | Twice daily minimum | `[P1]` |
| Property licence register with renewal alerts | On change | `[P2]` |
| Cleaning and sanitation schedules by area | Daily / weekly | `[P2]` |
| Pest control visits | Per visit | `[P2]` |
| Water potability testing | Per cycle | `[P2]` |
| Food handler medical fitness and FoSTaC training | On joining, with alerts | `[P2]` |
| Banquet retained sample — 48-hour clock | Per function | `[P2]` |

**Power failure `[P2]`:** outages are routine in Upper Assam. The temperature log accepts `POWER_FAILURE` as an excursion reason with outage start, generator changeover and restoration times. Logged as cold chain breaks, not quality incidents. Excursions beyond a configured duration flag every batch in that chamber.

### 7.4 Audit and corrective action

Schedule 4 **Part V** self-audit, scored `[P2]` · NC → CAPA with owner, due date, photo evidence and formal closure `[P2]` · overdue escalation `[P2]` · timed mock recall drill `[P3]` · Hygiene Rating evidence pack `[P3]` · compliance score on the GM dashboard `[P3]`.

**Licence class:** a hotel up to 4-star holds an FSSAI **State Licence** from the Commissioner of Food Safety, Assam. Central applies to 5-star and above. Do not build assuming Central. Regulations were amended in March 2026 — confirm current conditions at Phase 0.

### 7.5 Traceability

Both `[P1]`, both answerable in one screen:

**Forward** — this batch came through Gate Entry X from this vendor, was checked by this person, sits in these bins, was issued to these departments, and its waste left on this gate pass.

**Backward** — this bin holds these batches, from these vendors, on these dates, with these documents and photographs.

---

## 8. Enforcement mode

Every check carries a mode, not an on/off flag: `RECORD_ONLY` · `WARN` · `BLOCK`.

At go-live every rule ships `RECORD_ONLY` with no UI to change it. **The field must exist from day one** — retrofitting it is a rewrite. From `[P2]` the property ratchets rules upward from a dashboard, as a dated management decision, never a deployment.

**Rule Posture report `[P2]`** — every rule and its mode on one screen. Changes logged with who, when and why; reversals logged with equal prominence.

**Exceptions — hard from `[P1]`, no mode:**

1. Item must exist in the item master
2. Put-away requires a destination bin scan
3. Rejected stock cannot reach a zone
4. Nothing leaves the property without a gate pass

### Design against click-through

| Instead of | Capture |
|---|---|
| "Vehicle clean? Y/N" | Photo of vehicle interior |
| "Temperature OK? Y/N" | Photo of probe against product |
| "Quality acceptable? Y/N" | Photo of the lot + numeric grade |
| "Shelf life adequate? Y/N" | Best-before date — system computes the rest |

**Self-audit `[P2]`:** any check running 100% pass for ninety days is flagged. Either it is meaningless or it is being clicked through.

---

## 9. Data model

```
GateEntry           id, gate_entry_no, direction=IN, timestamp_in, timestamp_out?,
                    vendor_id, vehicle_no?, mode, package_count, bill_photo_ref?,
                    arrival_type, po_refs[], state, captured_by

GatePass            id, gate_pass_no, direction=OUT, dispatch_note_id, timestamp_out,
                    carrier?, vehicle_no?, package_count, verified_by, printed_at

GRN                 id, gate_entry_id, vendor_id, posted_at, posted_by,
                    immutable, amendment_of?

GRNLine             grn_id, item_id, po_line_id?, qty_challan?, qty_physical,
                    qty_accepted, qty_rejected, uom, scale_id?, decision,
                    reject_reason?, line_state

Batch               id, item_id, grn_line_id, batch_no, is_system_generated,
                    mfg_date?, best_before?, shelf_life_total, shelf_life_remaining,
                    pct_at_receipt, receipt_temp?, dwell_breach_flag

StockLot            batch_id, location_id, qty, state
                    -- QUARANTINE | AVAILABLE | TRANSIT | ISSUED
                    -- | STAGED_OUT | REJECT_HOLD | BLOCKED

QualityInspection   grn_line_id, template_id?, template_version?, sample_size?,
                    results[], probe_id?, photos[], inspector_id, timestamp,
                    quick_mode?, template_substituted?

InspectionTemplate  id, name, version, scope_type, scope_id, is_active,
                    created_by, created_at, superseded_by?
                    -- scope_type: GLOBAL | CATEGORY | SUBCATEGORY | ITEM | TIER

InspectionField     template_id, sequence, field_type, label_i18n{},
                    is_visible, mandatory_mode, blocking_mode,
                    min_value?, max_value?, target_value?, options[]?,
                    condition_expr?
                    -- mandatory_mode: ALWAYS | CONDITIONAL | NEVER
                    -- blocking_mode:  BLOCK | WARN | RECORD_ONLY

InspectionResult    inspection_id, field_id, value, passed?, photo_refs[]

PutawayTask         grn_line_id, batch_id, from_loc, to_loc, qty,
                    scanned_at, scanned_by, regime_validated, state

ZoneTransfer        id, reason_code, from_loc, to_loc, batch_id, qty,
                    despatch_scan_at, despatch_by, receipt_scan_at, receipt_by,
                    transit_temp?, discrepancy_qty?, state

DispatchNote        id, dispatch_type, reason_code, origin_loc, batch_id?, item_id,
                    qty, recipient_type, recipient_id, is_returnable,
                    expected_return_date?, weight?, photos[], authorised_by, state

ReturnableItem      dispatch_note_id, qty_out, qty_returned, condition_on_return?,
                    returned_at?, shortfall_qty?, responsible_dept?, state

Party               id, party_code, check_digit, party_type, name, phone, tier,
                    gstin?, fssai_licence?, licence_valid_to?, on_hold,
                    registration_status, qr_issued_at?, card_issued_at?
                    -- party_type: VENDOR | CONTRACTOR | LAUNDRY | AGGREGATOR
                    --           | CARRIER | SISTER_PROPERTY

Person              id, person_code, check_digit, name, photo_ref, department_id,
                    employment_type, app_user_id?, is_active, deactivated_at?,
                    medical_valid_to?, fostac_valid_to?, card_issued_at?
                    -- employment_type: PERMANENT | CONTRACT | AGENCY | DAILY

ReceiptAck          movement_type, movement_id, person_id?, scanned_at,
                    scanned_by, photo_verified, override_id?, override_reason?
                    -- movement_type: ISSUE | TRANSFER | RETURN | DISPATCH

DocumentAttachment  entity_type, entity_id, doc_type, file_ref, captured_at,
                    captured_by, retention_until, immutable

TemperatureReading  source, entity_id, value, in_range?, taken_at, taken_by,
                    photo_ref, excursion_reason?

ComplianceRecord    register_type, source_entity_type, source_entity_id,
                    payload, created_at, auto_generated

RuleConfig          rule_key, category_id?, vendor_tier?, enforcement_mode,
                    threshold_value?, changed_by, changed_at, reason

OverrideLog         rule_key, entity_id, reason_code, authorised_by, timestamp
```

**Six things that cannot be retrofitted.** Build in `[P1]` even where the UI barely touches them:

1. `GateEntry` and `GatePass` as the spine every record hangs from
2. `QUARANTINE`, `TRANSIT` and `STAGED_OUT` stock states
3. `Batch` as a first-class record
4. `enforcement_mode` on `RuleConfig`
5. GRN immutability with audit trail
6. `is_returnable` and the returnable register

---

## 10. India and Assam specifics

**Vendor tiers `[P3]`** — blocking on an expired FSSAI licence would stop most fresh supply on day one. T1 registered (GSTIN + FSSAI licence, `BLOCK`) · T2 small registered (`WARN`) · T3 unregistered local vendor (permitted, capped, named categories only, enhanced quality checks, monthly FSO review). **KPI: percentage of purchase value from registered vendors, target 80% by month twelve.** Supplier Pareto report shows where registration effort pays — typically eight to twelve vendors carry 80% of spend.

**Market purchase `[P3]`** — daily cash purchase against a pre-approved limit and category list, retrospective PO, bill photo, imprest reconciliation. Routine, not an exception.

**Legal Metrology `[P3]`** — Scale Master with verification certificate, stamping date and expiry; block on expired; scale ID on every weighed line. Practical approach: one stamped scale at T1, since receiving is the only place a weight must stand up legally.

**GST and e-way bill `[P3]`** — GSTIN at vendor and gate entry; tax invoice vs bill of supply; e-way bill threshold held as **configuration, not a constant** (Assam follows ₹50,000 intra-state; confirm with the property's CA at Phase 0). Unregistered-vendor purchases flagged for Accounts on reverse charge; Golai does not compute tax.

**Local units and tare `[P2]`** — 25/50 kg bora · 15 L oil tin · eggs by peti · jute bag and crate · fish by piece and kg · 19 kg commercial LPG. **Jute sacks gain weight through the monsoon** — crate master holds wet and dry tare, selected at receipt.

**Language `[P2]`** — Assamese, Hindi and English. **Checklist items and reject reasons icon-led with local-language labels** — an English-only dropdown at the dock gets clicked through without being read.

**Monsoon `[P2]`** — seasonal par profiles with higher safety stock May–September; a supply-disruption mode relaxing shelf-life thresholds by a configured margin with FSO approval.

**Data residency `[P2]`** — staff medical certificates, training records and photographs are personal data under the DPDP Act 2023.

---

## 11. Roles

| Role | Gates | Notes |
|---|---|---|
| **Security** | 0, 10 | Primary capture in and out, **in the app, at the gate**. Documents, counts, vehicle. No quality, no weight, no editing |
| Storekeeper | 1–9, 11 | Primary operator inside the property |
| Chef or department rep | 3, 8 | Perishable quality sign-off; receives issues |
| Purchase | 2, 4, 9 | Variance approval, supplier returns |
| Food Safety Officer | 3, 4, 9 | Temperature and hygiene escalation; can place a batch on `BLOCKED`; owns waste and UCO records |
| Banquet Manager | 8, 9 | Outdoor catering despatch and returnables |
| GM | Overrides | High-value gate passes, enforcement modes |
| Auditor | Read-only | Full trail including every override |

**Segregation:** the person who inspects cannot approve their own override. **The person who stages at T2 cannot be the person who verifies at Security.**

---

## 12. Edge cases

1. No PO — emergency purchase, retrospective PO `[P2]`
2. Partial delivery, balance to follow `[P2]`
3. One PO across several vehicles; one vehicle carrying several POs `[P2]`
4. After-hours delivery — flagged; timestamp always the server's `[P1]`
5. Vendor substitution — substitute must exist in the item master `[P2]`
6. Damaged but usable — partial acceptance; Golai records quantity, not rate `[P2]`
7. Re-inspection after FSO hold — both inspections retained `[P2]`
8. Mixed-temperature load — each lot gets its own probe reading and dwell clock `[P2]`
9. Network down for a full session — offline queue; put-away deferred to sync `[P1]`
10. Item not in the item master — blocking by design `[P1]`
11. Direct-to-kitchen produce — passes all gates logically; put-away targets the kitchen zone `[P2]`
12. Transfer despatched but never received — escalation `[P2]`
13. **Gate Entry with no GRN** — the core reconciliation alert `[P1]`
14. **Gate Pass with no Dispatch Note** — the outbound equivalent `[P1]`
15. **Returnable overdue** — linen not back from laundry, equipment not back from repair `[P1]`
16. Outdoor event returning at 2am — after-hours return receipt at Security, reconciled next morning `[P2]`
17. Empties leaving without a corresponding full delivery `[P2]`
18. Staff personal belongings — explicitly out of scope; the gate pass covers property material only

---

## 13. Non-functional

Mobile-first at gate and dock, large touch targets for cold and gloved hands · camera in-flow with client-side compression under 400 KB · scanner input, hardware and camera · **ten-line delivery completable in under four minutes** · gate-out verification in under 60 seconds · offline capture and sync throughout, **except put-away confirmation and gate-out**, both of which require the server · immutable audit trail, server-authoritative timestamps · Android-first, tolerant of low-end devices and weak 4G · gate pass printable at Security.

**Gate device `[P1]`** — a dedicated Android device at the security post, on charge, usable one-handed through a night shift. PIN login with fast user switching for shift change. Screen legible in direct sun and in darkness. The gate is typically the weakest network point on the property, so offline capacity must be sized for a full shift of entries, not a handful.

---

## 14. Phase 1 acceptance criteria

1. Nothing enters the property without a Gate Entry Number
2. Nothing leaves the property without a Gate Pass Number, and there is no exception path in the UI
3. Every Gate Entry resolves to a GRN, or raises an alert
4. Every Gate Pass resolves to a Dispatch Note, or raises an alert
5. Stock at T1 cannot be issued to anyone
6. Stock becomes issuable only after a destination bin label is scanned
7. Stock in transit between zones is issuable at neither end
8. Every perishable line carries an expiry date; every cold-chain line a probe temperature and photograph
9. A vendor with no bill and no registration can be received in under four minutes
10. A posted GRN cannot be edited — only amended, with a full trail
11. Batch records exist for every batch-controlled line, system-generated where the vendor gives none
12. The FSSAI inward check and waste disposal registers populate with **zero additional data entry**
13. Forward and backward trace runs from any batch to vendor, inspector, documents, bin, department and gate pass
14. Rejected stock cannot reach any zone location
15. Every returnable dispatch appears on an aged outstanding register until it returns
16. Every registered party carries a scannable system-generated ID; scanning it at the gate identifies the party, its tier, its hold status and its outstanding returnables, with no network
17. No material changes custody anywhere in the property without a card scan — issue, transfer receipt, return or dispatch. The only alternative is a supervisor override carrying the supervisor's identity
18. The receiver's photograph displays on scan, from cache, with no network
19. A deactivated person's card stops working immediately, server-side
20. An administrator can build, edit, version and switch off an inspection template without any developer involvement
21. Every inspection field can be set visible/hidden, mandatory/optional and blocking/non-blocking independently of the other two
22. Switching every optional check off still leaves the non-negotiable floor: item, quantity, expiry on perishables, probe temperature on cold-chain, and a reasoned accept/reject
23. Editing a live template never alters a past inspection record
24. The full flow works offline except put-away confirmation and gate-out

---

## 15. Open questions for the architect

1. Is `QUARANTINE` a stock state or a separate location? **Recommendation: a state**, so T1 holds quarantined and reject stock without duplicating the location tree.
2. Should `ZoneTransfer`, `PutawayTask` and `DispatchNote` share one movement entity with a type discriminator, or stay separate? **Recommendation: separate** — each has distinct scan, state and authorisation semantics.
3. Should chef acceptance on perishables be a hard block or asynchronous sign-off? A hard block is correct for control but will stall the dock during service.
4. How does an unsynced offline Gate Entry behave if its PO is closed by another user in the interim?
5. Does the returnable register belong here or in an assets module, given linen and equipment are arguably assets rather than stock?
6. Are the gate's non-material functions — visitor entry, staff movement, key handover, night rounds — going into Golai TOWER, and if so, does the guard use one app or two?

**Resolved:** Security operates the Golai app directly at the gate. No paper security register. See Gate 0a.

---

*Golai · Quantity. Movement. Accountability.*
