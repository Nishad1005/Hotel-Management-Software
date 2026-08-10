# 0004 — A custom outbox, not a managed sync engine

**Status:** Accepted
**Date:** 2026-08-10

## Context

Full offline operation is a `[P1]` requirement (§4 Gate 0a, §13). The gate is described as the weakest network point on any property, and offline capacity must be sized for a full shift rather than a handful of entries.

The obvious answer is a managed bidirectional sync engine — PowerSync or similar — which keeps a local SQLite database in step with Postgres and handles conflicts. It is battle-tested and would be less code.

Against that: it is a paid third-party dependency in the critical path of the product's core control, it constrains schema evolution, and it solves a problem we largely do not have.

The decisive observation is what the writes actually are. Nearly every capture in this system is an **append** — a gate entry, a GRN line, an inspection result, a movement. Appends do not conflict. And the two operations that genuinely need server authority, **put-away confirmation and gate-out**, are precisely the two the PRD already excludes from offline operation (§13). The PRD author had already solved this.

## Decision

A custom outbox:

- **Read side** — local SQLite (`expo-sqlite` + Drizzle) caches what the device needs to work blind: party master with QR codes, staff master with photographs, item master, location tree, active inspection templates, rule config. Delta-synced and versioned.
- **Write side** — every capture appends to a local outbox with a client-generated UUID and an idempotency key. A drain worker posts in order when the network returns. Photos are written to device storage immediately, compressed under 400 KB, and uploaded as separate resumable jobs referenced by the outbox row.

No conflict resolution layer, because there is almost nothing to resolve.

## Consequences

- Idempotency keys are load-bearing, not decorative. The drain **will** retry, and the server must treat a repeated key as a no-op returning the original result.
- The outbox must survive the app being force-killed mid-drain. This is an explicit test, not an assumption.
- Offline storage needs sizing and an eviction policy: roughly 200 entries × 3 photos × 400 KB ≈ 240 MB for a full shift.
- Outbox backlog depth is exported as telemetry. A growing backlog means a device is failing silently — and silent failure at the gate is exactly what the product exists to prevent. It is the best early-warning signal available.
- If a future flow genuinely needs concurrent editing of the same record by two offline users, revisit this. Nothing in `[P1]`–`[P2]` does.
