# Golai — Material Flow Control

Read this file fully before touching anything. It is the standing context for this repo.

## What this is

**PAR Golai** is stock control for hotels and restaurants, sold as a multi-tenant SaaS. It tracks material from the moment it reaches the security gate, through receiving and quality inspection, into storage zones, out to departments, and eventually off the property again.

Its central claim: because the material flow already captures vendor, batch, temperature, expiry and disposal, the **FSSAI compliance registers are a by-product of it, not a second job**. Nothing is entered twice.

Reference deployment and tenant #1: **Voyage The Solitaire Bliss, Tinsukia, Assam.**

Source of truth for requirements: [`docs/PRD_PAR_Golai_Material_Flow_Rev02.md`](docs/PRD_PAR_Golai_Material_Flow_Rev02.md). Read the relevant section before implementing a gate. Requirements carry phase tags — **`[P1]` is the go-live build**; `[P2]`–`[P4]` are specified so the data model is right, but are not built now.

---

## The non-negotiables

These are prohibitions, not preferences. If a change requires breaking one, stop and raise it.

### Tenancy

1. **Every domain table carries `property_id`** and has RLS enabled with a policy. A table without one fails CI.
2. **The tenant key is `property_id`, never `org_id`.** Group-wide access comes from extra `membership` rows, never from a wider RLS predicate.
3. **No service-role key on tenant data.** This — not badly-written policies — is how cross-tenant leaks actually happen. System work goes through the reviewed `SECURITY DEFINER` functions in the `system` schema, which take `property_id` explicitly.
4. **Never one row spanning two properties.** Cross-property flows (sister-property transfer) use two records and an explicit `inter_property_link` bridge.
5. **Never assume a single database or a single Supabase project.** Tenancy is a column, not a code path — that is what makes a dedicated deployment possible later.

### Cannot be retrofitted (PRD §9)

Present in the schema from the first migrations, even where the UI barely touches them:

6. `gate_entry` / `gate_pass` as the spine every record hangs from
7. `QUARANTINE`, `TRANSIT`, `STAGED_OUT` in the stock state enum
8. `batch` as a first-class record
9. `enforcement_mode` on `rule_config` — **shipped at `RECORD_ONLY` with no UI to change it** (PRD §8)
10. GRN immutability with an amendment trail
11. `is_returnable` and the returnable register

### Hard rules — no enforcement mode, no override (PRD §8)

12. An item must exist in the item master. **No creation at the dock.**
13. Put-away requires a **scanned** destination bin. Typing a code is not permitted.
14. **Rejected stock can never reach a zone.** The state machine does not permit the transition.
15. Nothing leaves the property without a gate pass. **No exception path in the UI.**

### Design rules

16. **`packages/domain` has zero I/O.** Rules must hold identically on an offline device and on the server. Two implementations will diverge, and the divergence surfaces as a stock discrepancy nobody can explain.
17. **Stock is an append-only ledger.** Never add a mutable quantity column — see [ADR 0003](docs/decisions/0003-stock-as-a-ledger.md).
18. **Witness before you enforce** (PRD §2). Where the property cannot refuse a delivery, the system must not pretend it can. An unenforceable rule produces click-through, and the record then carries a false assertion instead of an honest gap.
19. **Server-authoritative timestamps**, always. Never trust device clocks.
20. Sync API is **additive only**; server accepts payload schema versions N−2. Offline devices can be days stale.

---

## Stack

| Layer       | Choice                                                                     |
| ----------- | -------------------------------------------------------------------------- |
| Mobile      | React Native + Expo, TypeScript                                            |
| Consoles    | Next.js — `apps/admin` (tenant-facing), `apps/console` (Golai operators)   |
| Backend     | Supabase — Postgres, Auth, Storage, RLS. **Region: Mumbai (`ap-south-1`)** |
| Local store | `expo-sqlite` + Drizzle                                                    |
| Monorepo    | pnpm workspaces + Turborepo                                                |
| Errors      | Sentry, tagged `org_id` / `property_id` / `device_id` / `app_version`      |
| E2E         | Maestro                                                                    |
| DB tests    | pgTAP                                                                      |

Versions are pinned in the lockfile. **Check current library docs (Context7) before upgrading or adding a dependency** — do not rely on recalled API shapes.

## Layout

```
apps/mobile      Security · Storekeeper · Chef · FSO
apps/admin       Tenant-facing: masters, templates, dashboards
apps/console     Golai-facing: fleet, health, provisioning, support
packages/domain  ★ Pure TypeScript. Zero I/O. The rules.
packages/db      Generated Supabase types + shared queries
packages/ui      Design tokens + shared components
supabase/migrations   ★ The source of truth for the data model
supabase/functions    Number leasing · reconciliation sweep · provisioning
supabase/tests        pgTAP — RLS and trigger tests
supabase/seed         Two orgs × two properties — the standard fixture
docs/decisions        ADRs — read the index before proposing an architecture change
```

## Commands

```bash
pnpm install
pnpm dev                    # all apps
pnpm test                   # unit tests
pnpm test --filter domain   # domain rules only
pnpm typecheck
pnpm format                 # prettier write
```

### Database

**We develop cloud-first. There is no local Docker** — see [ADR 0013](docs/decisions/0013-cloud-first-development.md).

Project `dwnuxeeglkpsssissmuu` · region `ap-south-1` (Mumbai) · `https://dwnuxeeglkpsssissmuu.supabase.co`

```bash
pnpm exec supabase migration new <name>   # writes a file; no container needed
```

**Types are generated in CI from the migrations, not from the live project** — `supabase gen types typescript --local` against the replayed stack. That needs no access token and no database password, and it makes the committed types provably a function of the migrations rather than of whatever someone last changed by hand in the dashboard. CI fails if the committed types drift from the schema.

**Migrations reach production only through CI, and only if the tests passed.** Supabase's
own "Deploy to production" toggle is deliberately OFF, because it applies migrations on
merge regardless of CI. The `deploy` job in [ci.yml](.github/workflows/ci.yml) `needs` the
test jobs — that gate is the only path into the production database.

**The test suite is therefore the deployment safeguard.** Never weaken the `needs`
relationship to unblock a release.

`supabase start`, `db reset` and `test db` need Docker and so only run in CI. The pgTAP
suite — including the sweep that fails on any table without RLS — gates every push and
pull request, but cannot be run before pushing.

There are no preview databases per pull request; branching needs the Pro plan. CI's
replayed stack substitutes for it.

Repository: `https://github.com/Nishad1005/Hotel-Management-Software.git`

## Conventions

- **Migrations are forward-only and expand/contract.** Backwards-compatible for at least one release — offline devices are running older code.
- **Every test fixture seeds two organisations with two properties each.** No test runs in a single-tenant world; cross-tenant bugs then surface by themselves.
- Domain rules get unit tests before implementation. State transitions, check digits and shelf-life maths are the highest-value tests in the repo.
- Tables and columns `snake_case`; TypeScript `camelCase`; the boundary is `packages/db`.
- Photos: client-side compression **under 400 KB** (PRD §13), content-addressed, immutable, with `retention_until`.
- Anything user-facing at the gate or dock needs large touch targets — cold hands, gloves, night shift, direct sun.

## Current state

**Phase 1 — tenancy schema and RLS.** See the build plan for phase definitions and exit criteria.

V1 = inbound spine + reconciliation + minimal Gate 8: Gates 0–6 and 8. Gates 7, 9, 10 and the returnable register are V2.

**Web is the first delivery target** ([ADR 0014](docs/decisions/0014-web-first-via-expo-web.md)). `apps/mobile` is an Expo app with web enabled — it runs in a browser now and builds for the stores later from the same source. Native builds move to Phase 9.

The consequence that cannot be deferred: **the offline outbox must sit behind a storage interface with two drivers** (SQLite on native, IndexedDB/OPFS on web) from its first commit. Retrofitting that once it has callers is the expensive version of this decision.

---

## Glossary

Read this. Code written without it will be confidently wrong.

**Flow points**

- **Gate 0** — Security capture, inbound. The primary capture point; everything hangs off its Gate Entry Number.
- **Gates 1–5** — Terminal 1: arrival, quantity, quality/batch, accept-reject decision, GRN posting.
- **Gate 6** — Put-away from T1 into a storage zone. Requires a scanned bin label.
- **Gate 7** — Inter-zone transfer (V2). **Gate 8** — Zone → department issue.
- **Gate 9** — Terminal 2 dispatch staging (V2). **Gate 10** — Security gate-out, issues the Gate Pass Number (V2). **Gate 11** — Terminal clearance.
- **T1** — Terminal 1, the receiving bay: the quantity-and-quality point. **T2** — Terminal 2, dispatch staging: the departure point.
- **Zone** — a storage location (`SB-{store}-{zone}-{rack}-{shelf}`). **Bin** — the leaf.

**Documents and records**

- **GRN** — Goods Received Note. Immutable once posted; corrected by amendment with a full trail.
- **Gate Entry Number** — inbound, sequential, immutable. **Gate Pass Number** — outbound, same.
- **Dispatch Note** — the outbound counterpart of a GRN.
- **Challan** — the vendor's delivery note (paper). The gate entry number gets written onto it by hand, bridging paper to app.
- **Batch** — created at Gate 3. System-generated as `SYS-{GRN}-{line}` when the vendor supplies no number.

**Rules and states**

- **Enforcement mode** — every check is `RECORD_ONLY` / `WARN` / `BLOCK`. Ships as `RECORD_ONLY`.
- **Dwell** — time stock sits at T1 before put-away. Breaches are recorded permanently against the batch.
- **FEFO** — first-expired-first-out, used for perishables. **FIFO** otherwise.
- **Tare** — packaging weight deducted from gross. **Wet/dry tare** matters because jute sacks gain weight through the monsoon.
- **Quick Mode** — completes only the non-negotiable floor fields, for routine deliveries from trusted vendors. Every use is counted and reported.

**Compliance and people**

- **FSSAI** — Food Safety and Standards Authority of India. Hotels up to 4-star hold a **State Licence**, not Central.
- **FSO** — Food Safety Officer. Owns inspection templates, waste and UCO records; can place a batch on `BLOCKED`.
- **FoSTaC** — the FSSAI food-handler training certification. Tracked per person with expiry.
- **UCO** — used cooking oil. Disposal to registered aggregators is a regulated register.
- **CAPA** — corrective and preventive action, raised against a non-conformity.
- **DPDP Act 2023** — India's data protection law. Relevant because we hold staff photographs and medical certificates.

**Local units (Assam)**

- **Bora** — sack, typically 25 or 50 kg. **Peti** — crate/carton, the usual unit for eggs.
- Commercial LPG cylinders are 19 kg; oil tins are 15 L; fish is handled by both piece and kg.
