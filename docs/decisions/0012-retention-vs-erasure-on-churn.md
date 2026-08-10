# 0012 — On churn: erase personal data, retain de-identified material records

**Status:** Accepted
**Date:** 2026-08-10

## Context

Two legal obligations collide, on the same rows.

**FSSAI** requires food businesses to retain material and inspection records — inward checks, temperature records, non-conforming material, traceability, waste and UCO disposal. A property that leaves Golai may still be asked about a batch it received while a customer.

**The DPDP Act 2023** grants erasure of personal data. Golai holds a substantial amount of it: staff photographs, medical fitness certificates, FoSTaC training records, driver names and phone numbers.

The same GRN line references both an inspection result (retained) and the inspector who took it (erasable). Deleting everything breaches one obligation; keeping everything breaches the other.

## Decision

On `PURGE`, the two are separated:

- **Personal data is erased** — staff photographs, medical certificates, FoSTaC records, driver names and phone numbers, and any free-text field known to carry them.
- **Material records are retained in de-identified form.** Each person is replaced by a **stable pseudonym**, so a trace still shows that one individual received these twelve issues, without identifying them.

Traceability survives. Personal data does not.

Preceding states matter too. **`SUSPENDED` is read-only, but devices keep capturing and syncing.** A billing dispute must never cause a hotel to lose gate records — that would be a data-loss event we caused.

On `CHURNED`, a full export bundle is generated in both machine- and human-readable form before anything is purged.

## Consequences

- Pseudonyms must be **stable within a property and meaningless across properties**, otherwise either the trace breaks or the pseudonym becomes a re-identifier.
- Any new field holding personal data must be registered as such when it is added, or purge will miss it. This needs to be part of the migration checklist, not tribal knowledge.
- Free-text fields are the hard case — remarks can contain names. Purge cannot fully solve this; the mitigation is to avoid free text where a structured field will do, which the inspection template engine already encourages.
- Retention periods are configurable per property, because FSSAI conditions vary and were amended in March 2026 (§7.4, still to be confirmed).
- All of this belongs in the **Data Processing Agreement**. A retention policy that exists only in code is not a policy.
