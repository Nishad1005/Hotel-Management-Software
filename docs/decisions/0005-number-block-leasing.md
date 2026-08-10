# 0005 — Document numbers are leased in blocks to devices

**Status:** Accepted
**Date:** 2026-08-10

## Context

Three `[P1]` requirements collide:

1. **§4 Gate 0** — the Gate Entry Number is generated, **sequential and immutable**.
2. **§4 Gate 0a** — **full offline operation**. The gate is the weakest network point on the property.
3. **§4 Gate 0a** — the number is **displayed immediately** and written by the officer onto the vendor's physical challan, bridging paper to app.

All three cannot hold with server-side sequencing. If the server allocates the number, an offline device cannot show one; if the device invents one, the series is neither sequential nor collision-free; if the number is assigned at sync time, it cannot have been written on the challan hours earlier.

## Decision

Devices **lease blocks of numbers** from the server while online and spend them offline.

```
number_sequence  property_id, doc_type, next_value
number_lease     property_id, doc_type, device_id, range_start, range_end,
                 issued_at, expires_at, consumed_upto
```

A gate device holds at least 200 unspent numbers and refills when it drops below 50. A number is **permanent from the moment the guard sees it** — it is on the vendor's challan and cannot be reassigned.

## Consequences

- **The series will contain gaps.** Numbers in an expired or abandoned lease are never reused. This is deliberate: an auditor accepts a gap with a documented reason far more readily than a renumbering, and manufacturing a gapless series would mean reassigning a number that is already written on a piece of paper somewhere — exactly the false assertion §2 warns against.
- Gaps must therefore be *explainable*. Leases are retained and queryable so any gap resolves to a device, a shift and a reason.
- Lease exhaustion is an operational failure: a device that cannot lease and has spent its block cannot capture. Alert on low remaining lease depth well before it happens.
- Applies to every sequential document type, not just gate entries — gate passes, GRNs, dispatch notes.
- Never generate a document number client-side outside a lease. Never renumber an issued document.
