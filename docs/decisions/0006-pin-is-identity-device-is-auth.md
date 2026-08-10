# 0006 — The PIN is identity; the device is the authenticated party

**Status:** Accepted
**Date:** 2026-08-10

## Context

§4 Gate 0a requires **PIN login, not password**, for security staff — gloved hands, night shift, poor light — with fast user switching at shift change, and full offline operation.

A four-digit PIN is not an authentication credential. It has no meaningful entropy, it is shared and observed in practice, and it cannot be verified against a server that is not reachable.

Yet the record must still say *which guard* captured each entry, and that attribution has to be trustworthy enough to support the reconciliation control — the whole point of which is that Security and the storekeeper are different people.

## Decision

Split the two concerns:

- **The device is the authenticated party.** It enrols once against the property and holds a long-lived credential. Enrolment is an administrative act, revocable server-side.
- **The PIN selects which guard is currently active** on that device, and stamps `captured_by`. Switching users is a PIN entry, not a login.

The guard roster is cached, so PIN selection works offline. Deactivating a guard is server-side and propagates on next sync.

## Consequences

- Compromise of a PIN gets an attacker nothing without physical possession of an enrolled device. Compromise of a device is a revocation event, handled server-side, and is why enrolment is administrative rather than self-service.
- `captured_by` is an attribution, not a cryptographic assertion. This is honest and adequate: the control it supports is *separation between Security and the storekeeper*, which a PIN preserves. Do not describe it internally or to customers as authentication.
- Device enrolment state, last sync and lease depth are per-device facts and appear in the operator console.
- The same pattern is **not** used for storekeepers, chefs or administrators, who hold real credentials.
- Related: [0007](0007-qr-carries-id-only.md) applies the same principle to cards — identification is not authorisation.
