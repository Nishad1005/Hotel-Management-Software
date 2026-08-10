# Database tests (pgTAP)

```bash
pnpm exec supabase test db     # requires Docker; runs in CI on every push
```

These do not run on the development machine — we work cloud-first without Docker
([ADR 0013](../../docs/decisions/0013-cloud-first-development.md)). GitHub Actions runners
have Docker, so the suite gates every push and pull request there. That is deliberate:
losing these locally is tolerable, losing them entirely is not.

## What belongs here

**The tenant isolation sweep is the important one.** It enumerates `information_schema`
and fails on any table that lacks RLS or lacks a policy. The realistic failure mode is
not a badly-written policy — it is a table added in month seven with none at all, which
is silent and which no feature test would ever catch. See
[ADR 0001](../../docs/decisions/0001-multi-tenant-from-day-one.md).

Also here:

- Cross-tenant reads: with tenant A's role, queries return none of tenant B's rows
- The four hard rules from PRD §8, which are enforced in the schema and not only in
  application code — an offline client cannot be trusted, and the app will be rewritten
  long before the schema is
- Trigger behaviour: GRN immutability, the `stock_lot` projection agreeing with a full
  replay of the ledger
- Constraint behaviour: segregation of duty, state-machine transitions

## Fixtures

**Every fixture seeds two organisations with two properties each.** No test runs in a
single-tenant world. This is what makes cross-tenant bugs surface by themselves instead
of having to be anticipated — do not "simplify" a test by seeding one property.
