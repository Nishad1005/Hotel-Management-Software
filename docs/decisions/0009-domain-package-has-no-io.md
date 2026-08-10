# 0009 — `packages/domain` has zero I/O

**Status:** Accepted
**Date:** 2026-08-10

## Context

Every rule in this system has to hold in two places at once: on a device that is offline and cannot ask the server, and on the server, which is the final authority.

If those are two implementations, they will diverge. Not immediately — a threshold changes on one side, a rounding rule differs, an edge case is handled in one place and not the other. The divergence does not announce itself. It surfaces weeks later as a stock discrepancy nobody can explain, in a system whose entire value proposition is explaining discrepancies.

## Decision

`packages/domain` is pure TypeScript with **no I/O of any kind** — no network, no filesystem, no database, no clock, no environment access. Inputs in, decisions out.

It holds:

- the stock state machine — which transitions are legal (`QUARANTINE → AVAILABLE` yes; `REJECT_HOLD → any zone` never)
- document number formats and check-digit computation
- shelf-life maths: remaining percentage, minimum-shelf-life rules, dwell timers
- the inspection template evaluator — visibility, mandatory, blocking, conditional expressions
- enforcement-mode resolution
- UOM conversion and wet/dry tare

The mobile app imports it for instant offline validation. Edge functions import it server-side. Postgres triggers independently enforce the subset that must never be bypassed regardless of which client is talking.

## Consequences

- **Time is an input, never read.** Anything time-dependent takes a timestamp parameter. The server passes its own clock; the device passes what it has and the server re-evaluates. This is also what makes the rules testable without freezing clocks.
- It has the highest test coverage in the repo and the fewest dependencies. Adding a dependency to this package should feel wrong.
- Some rules are expressed twice — once here, once as a Postgres constraint or trigger. That duplication is deliberate and narrow: the DB enforces the four hard rules (§8) because an offline client cannot be trusted and the app will be rewritten long before the schema is. Every such pair needs a test on both sides.
- Never import a Supabase client, a fetch wrapper, or `expo-*` anything into this package. If a rule seems to need data it does not have, pass the data in.
