# 0003 — Stock is an append-only ledger, not a mutable quantity

**Status:** Accepted
**Date:** 2026-08-10

## Context

The PRD's §9 data model specifies `StockLot(batch_id, location_id, qty, state)` — a row whose quantity is updated as material moves. That is the conventional shape and the obvious reading.

Three requirements sit badly with it:

- **Immutability and a full audit trail** are demanded throughout (§9; acceptance criterion 10). With a mutable quantity, history is a separate table someone must remember to write to, and "remember to" is not a control.
- **Forward and backward traceability** in one screen (§7.5; criterion 13) means reconstructing where a batch went. That is a history query, not a current-state query.
- **Offline replay.** The outbox will retry. Appending the same movement twice is caught by an idempotency key. Incrementing the same quantity twice is silent corruption that surfaces weeks later as an unexplainable discrepancy.

And one product claim: §7.1 asserts the FSSAI registers are populated by the flow itself, with nothing entered twice. That is only literally true if the registers are _views over the movement history_.

## Decision

`stock_movement` is an append-only ledger. Every gate that moves material appends to it. `stock_lot` remains as a **maintained projection** derived from the ledger, so stock reports stay fast and callers see no difference in the read API.

Movement rows are never updated or deleted. A correction is a compensating movement, not an edit.

## Consequences

- **Never add a mutable quantity column, anywhere.** This is the single most likely well-intentioned regression in the codebase — it will look like a simple performance fix. It is not.
- The FSSAI registers in §7.2 become filtered views over the ledger rather than separately written records. This is what makes the product claim true rather than aspirational.
- The projection needs maintaining (trigger or incremental refresh) and needs a test proving it agrees with a full replay of the ledger.
- Ledger growth is real but small at hospitality volumes. Partition by property and period if it ever matters; do not denormalise.
- A correction leaves both the original and the compensating movement visible. That is the point — an auditor sees what happened, not a tidied result.
