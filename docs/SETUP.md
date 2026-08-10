# Setup guide

Everything that has to be configured outside the codebase. Part A is needed now, to
make the deployment pipeline work. Parts B and C have long lead times and should be
started in parallel with development.

---

## Part A — Deployment pipeline (do now, ~15 minutes)

### A1. Generate a Supabase access token

1. Go to **https://supabase.com/dashboard/account/tokens**
2. **Generate new token**
3. Name it `github-actions-deploy` — a name tied to its purpose, so it can be revoked later without guessing what it breaks
4. **Copy it immediately.** It is shown once and never again.

> Treat this like a password. It grants full API control of the project. Do not paste
> it into a chat, an issue, a commit, or a screenshot.

### A2. Find (or reset) the database password

This is the password set when the project was created — not the account password.

- If you have it, use it.
- If not: **Project Settings → Database → Database password → Reset**. Copy the new one.

> Resetting breaks anything already using the direct connection string. Nothing does yet,
> so now is the cheap moment.

### A3. Add both as GitHub Actions secrets

1. Go to **https://github.com/Nishad1005/Hotel-Management-Software/settings/secrets/actions**
2. **New repository secret**, twice:

| Name                    | Value                |
| ----------------------- | -------------------- |
| `SUPABASE_ACCESS_TOKEN` | the token from A1    |
| `SUPABASE_DB_PASSWORD`  | the password from A2 |

Names must match exactly — the workflow reads them by name.

The project ref (`dwnuxeeglkpsssissmuu`) is **not** a secret. It is in the app's public
URL and is hardcoded in the workflow.

### A4. Create the `production` environment and require approval

Without this the deploy job still runs, but unattended. With it, every production
migration needs a human click.

1. Go to **https://github.com/Nishad1005/Hotel-Management-Software/settings/environments**
2. **New environment**, named exactly `production` (the workflow references this string)
3. Tick **Required reviewers** and add yourself
4. Save

> For a database holding FSSAI records this is cheap insurance. It costs one click per
> deployment and prevents an unattended migration on a bad day.

### A5. Confirm Supabase auto-deploy stays OFF

1. Supabase → **Integrations → GitHub**
2. **"Deploy to production" must remain OFF**

This is deliberate, not an omission. That toggle applies migrations on merge
_regardless of whether CI passed_. The GitHub Actions deploy job does the same work but
refuses to run unless the pgTAP suite went green on that exact commit — including the
sweep that fails on any table without an RLS policy. See
[ADR 0013](decisions/0013-cloud-first-development.md).

Leave **Working directory** as `.` — it matches the repository layout.

### A6. Delete the old Sydney project

The original project was created in `ap-southeast-2`. Delete it so nothing can be
pointed at it by mistake.

**Sydney project → Project Settings → General → Delete project**

Confirm the surviving project is `dwnuxeeglkpsssissmuu`, region `ap-south-1`.

### A7. Decide repository visibility

The repository is currently **public** — anyone can read the schema, the RLS policies,
and the ADRs describing where the security boundaries are. Nothing sensitive is
committed, so this is a decision rather than an incident.

To make it private: **Settings → General → Danger Zone → Change visibility**.

One honest trade-off: **public repositories get unlimited GitHub Actions minutes;
private ones get 2,000 per month** on the free plan. A CI run here takes roughly 3–5
minutes because it starts a full Postgres stack, so 2,000 minutes is on the order of
400–600 runs a month. Almost certainly enough, but it is no longer free-and-unlimited.

Decide while the history is short. Making a repository private later does not un-index
what search engines already crawled.

---

## Part B — Long lead time (start this week)

These are the only items that can block a launch that is otherwise finished.

| Item                                       | Why now                                                                                                                                                                                                 | Cost       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **D-U-N-S number**                         | Required for an Apple _organization_ developer account. Takes 1–2 weeks in India, sometimes longer. The classic launch blocker.                                                                         | Free       |
| **Apple Developer Program (Organization)** | Needs the D-U-N-S first. An individual account publishes under your personal name, not the company's.                                                                                                   | $99/yr     |
| **Google Play Console (Organization)**     | New _personal_ accounts must run 12 testers × 14 days of closed testing before production release. **Organization accounts are exempt.** Registering the wrong type costs two weeks at the finish line. | $25 once   |
| **Item master build**                      | Weeks of someone's time at the property, and on the critical path: nothing can be received against an item that does not exist in the master, by design. Assign an owner now.                           | Staff time |

---

## Part C — Before the pilot

### Legal and compliance

- Legal entity and GST registration — needed for both store accounts and for billing
- Privacy policy and terms, publicly hosted — mandatory for both stores
- **Data Processing Agreement** — you are a processor holding staff photographs, medical
  fitness certificates and training records. This is where the consent-gated support
  access ([ADR 0011](decisions/0011-consent-gated-support-access.md)) and the
  retention-versus-erasure policy on churn
  ([ADR 0012](decisions/0012-retention-vs-erasure-on-churn.md)) have to be written down
- DPDP Act 2023 — processing notice, consent mechanism, documented retention
- Confirm the **March 2026 FSSAI amendments** and the licence class: a hotel up to 4-star
  holds a **State Licence**, not Central
- CA consultation on the e-way bill threshold — held as configuration, never a constant

### Infrastructure still to set up

| Service            | Purpose                                           |
| ------------------ | ------------------------------------------------- |
| Expo EAS           | Builds, store submission, over-the-air updates    |
| Sentry             | Crashes and errors, tagged per tenant             |
| Domain name        | Both consoles, deep links, privacy policy hosting |
| Resend or Postmark | Alert emails and tenant invitations               |

Supabase Pro will eventually be needed for point-in-time-recovery backups before real
data exists, and would additionally unlock preview databases per pull request.

### Hardware — one property

| Item                      | Spec                                                                                                             | Approx  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------- |
| Gate device               | Android 11+, 4 GB RAM, good rear camera, bright screen for sun _and_ darkness, rugged case, charging dock        | ₹15–25k |
| Gate spare                | Same. Never run a single-device gate.                                                                            | ₹15–25k |
| Dock/T1 tablet            | 8–10", Android 11+, waterproof case                                                                              | ₹20–30k |
| 2D barcode scanner        | Bluetooth. Faster than the camera at volume.                                                                     | ₹6–12k  |
| Thermal printer           | 58/80 mm Bluetooth — gate passes must print                                                                      | ₹4–8k   |
| Label printer             | Thermal **transfer**, not direct thermal: bin labels live in cold rooms and condensation destroys direct-thermal | ₹15–30k |
| Probe thermometer         | Calibrated, ideally Bluetooth                                                                                    | ₹3–8k   |
| Card printer or laminator | Vendor and staff cards                                                                                           | ₹5–20k  |
| UPS / power bank at gate  | Upper Assam outages are routine, and the design assumes them                                                     | ₹5k     |
| Weighing scale            | Legal Metrology stamped. Long procurement — start early.                                                         | ₹25–60k |

**Roughly ₹1.2–2.2 lakh per property.**

### People — where these projects actually die

The software is the easy part. Each of these needs a name against it.

- **A named product owner at the property**, with authority to decide
- **Security agency buy-in, in writing.** The entire reconciliation control depends on an
  outsourced guard using the app, and the design constraint is attrition: it must be
  learnable in one shift by someone who has never seen it
- **Food Safety Officer identified** — owns inspection templates, waste and UCO records
- **Current FSSAI registers collected**, so we model the real ones rather than generic ones
- **A human translator** for Assamese and Hindi checklist labels who knows kitchen
  vocabulary. Machine translation produces something the dock ignores
- **Pilot protocol** — what success means, who measures it, over what period
