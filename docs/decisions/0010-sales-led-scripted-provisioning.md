# 0010 — Provisioning is sales-led, but scripted and idempotent

**Status:** Accepted
**Date:** 2026-08-10

## Context

Two questions, often conflated. *How does a customer arrive?* and *how does a property come into existence in the system?*

On the first: a property in this domain does nothing useful until it has an item master, a location tree, registered vendors with printed cards and trained staff. That is roughly two weeks of the property's own work. Public self-serve signup would therefore mostly create abandoned empty tenants, and would generate support load rather than revenue.

On the second: even with sales-led onboarding, provisioning must not be a human clicking through admin screens. It will be done dozens of times, it involves a dozen dependent steps, and a half-configured property produces garbage data that then gets blamed on the software.

## Decision

**No public signup in V1.** A Golai operator provisions a tenant from the operator console.

Provisioning is **one idempotent, versioned, tested job**:

```
provision_property(org_id, code, name, template_pack)
  1. create property, lifecycle = PROVISIONING
  2. seed location tree (SEC, T1-RCV, T1-REJ, T2-DSP + configurable zones)
  3. initialise number_sequence rows for every document type
  4. seed rule_config — every rule at RECORD_ONLY (§8)
  5. install the shipped inspection template pack
  6. create and invite the first admin user
  7. lifecycle → ONBOARDING
```

A **readiness checklist gates `ONBOARDING → LIVE`**: at least one security user with an enrolled device · item master above a threshold · at least one vendor registered with a card issued · at least one zone in the location tree · at least one storekeeper · templates resolving for the property's categories. Visible in both consoles.

## Consequences

- **A property cannot go LIVE without passing the checklist.** This is the control that stops a half-configured deployment producing data nobody trusts. Do not add a bypass.
- Running provisioning twice must change nothing. This is a test, not an aspiration — partial failure and re-run is the normal case.
- Template packs are **cloned in, not referenced.** A later update to the shipped library must never silently overwrite a property's edits.
- Every rule lands at `RECORD_ONLY`, per §8. Ratcheting is a dated management decision at `[P2]`, never a deployment default.
- Self-serve signup is not foreclosed. When onboarding is genuinely light enough to survive it, the same provisioning job serves it — only the trigger changes.
