# Architecture Decision Records

One file per decision that was genuinely contested. Format: **context → decision → consequences.**

The value is in the _consequences_ section. Six months from now the question will not be "what did we decide" — it will be "why can't I just add a quantity column."

**Before proposing an architecture change, read the relevant ADR.** If a change contradicts one, that is not automatically wrong — but it needs a new ADR superseding the old one, not a silent departure.

| #                                               | Decision                                                             | Status   |
| ----------------------------------------------- | -------------------------------------------------------------------- | -------- |
| [0001](0001-multi-tenant-from-day-one.md)       | Multi-tenant from day one                                            | Accepted |
| [0002](0002-org-property-hierarchy.md)          | Organisation → Property; the property is the data boundary           | Accepted |
| [0003](0003-stock-as-a-ledger.md)               | Stock is an append-only ledger, not a mutable quantity               | Accepted |
| [0004](0004-outbox-over-sync-engine.md)         | A custom outbox, not a managed sync engine                           | Accepted |
| [0005](0005-number-block-leasing.md)            | Document numbers are leased in blocks to devices                     | Accepted |
| [0006](0006-pin-is-identity-device-is-auth.md)  | The PIN is identity; the device is the authenticated party           | Accepted |
| [0007](0007-qr-carries-id-only.md)              | QR codes carry an identifier only, never data or credentials         | Accepted |
| [0008](0008-async-chef-signoff.md)              | Chef acceptance is asynchronous sign-off, not a hard block           | Accepted |
| [0009](0009-domain-package-has-no-io.md)        | `packages/domain` has zero I/O                                       | Accepted |
| [0010](0010-sales-led-scripted-provisioning.md) | Provisioning is sales-led but scripted and idempotent                | Accepted |
| [0011](0011-consent-gated-support-access.md)    | Support access is consent-gated, time-boxed and audited              | Accepted |
| [0012](0012-retention-vs-erasure-on-churn.md)   | On churn: erase personal data, retain de-identified material records | Accepted |
| [0013](0013-cloud-first-development.md)         | Cloud-first development; production migrations gated on CI           | Accepted |
| [0014](0014-web-first-via-expo-web.md)          | Web first, from the same Expo codebase                               | Accepted |

## Template

```markdown
# NNNN — Title

**Status:** Proposed | Accepted | Superseded by NNNN
**Date:** YYYY-MM-DD

## Context

What forces are at play? What made this a real decision rather than an obvious one?

## Decision

What we are doing, stated so someone can act on it.

## Consequences

What this costs, what it forecloses, and what someone must never do as a result.
```
