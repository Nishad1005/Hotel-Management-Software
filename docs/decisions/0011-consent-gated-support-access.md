# 0011 — Support access is consent-gated, time-boxed and audited

**Status:** Accepted
**Date:** 2026-08-10

## Context

Golai staff will need to see tenant data to support it — a sync that will not drain, a template that behaves unexpectedly, a discrepancy a GM is asking about.

This is not an ordinary support-tooling question, because of what the system holds. Staff photographs, medical fitness certificates and FoSTaC training records are personal data under the **DPDP Act 2023** (§10 flags this explicitly). Golai is a processor. Unrestricted operator access to that data is difficult to defend, and it is the first thing any enterprise customer's security review will ask about.

The opposite extreme — metadata only, never records — is a genuinely strong privacy position but makes real debugging close to impossible.

## Decision

**Consent-gated, time-boxed, audited impersonation.**

- A tenant administrator grants access for a fixed window (default two hours).
- Every impersonated action carries `acting_as`, `on_behalf_of` and the grant ID.
- Those actions appear in the **tenant's own audit trail**, not only in ours. The customer can see what we did, without asking.
- Without a live grant, impersonation is rejected. There is no operator-only override.

The operator console additionally shows health and adoption metrics that require no grant, because they are aggregate and carry no personal data.

## Consequences

- Support is slower when no grant is active. Accepted. The alternative is asserting a processor's standing right of access, which some customers will refuse and which is harder to defend under DPDP.
- The audit path must be built in V1 even though the console UI stays thin until tenant #3 — retrofitting audit onto an access mechanism that already exists means a period with unaudited access, which is exactly what cannot be allowed.
- Operator accounts require MFA. The operator console is a separate app with a separate auth path from the tenant admin.
- The grant mechanism, its default window and the tenant's visibility of it go into the **Data Processing Agreement**, not just the code.
- Aggregate telemetry must stay genuinely aggregate. Do not let a "health" view quietly become a record browser.
