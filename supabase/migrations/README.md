# Migrations

**This directory is the source of truth for the data model.** Not the TypeScript types, not the ORM — these files.

## How they get applied

The GitHub integration watches this directory.

- **Open a PR** → Supabase creates a preview branch and runs these migrations against it. Failures appear on the Check Run.
- **Merge to `main`** → the same migrations run against **production**.

So a bad migration merged to `main` reaches the production database without anyone typing a command. Treat `main` accordingly.

No Docker is needed for any of this. See [ADR 0013](../../docs/decisions/0013-cloud-first-development.md).

## Conventions

```bash
pnpm exec supabase migration new add_tenancy
```

- **Forward-only.** Never edit a migration that has been merged. Write another one.
- **Expand/contract**, backwards-compatible for at least one release. Offline devices are running older code and will sync against a newer schema — see rule 20 in [CLAUDE.md](../../CLAUDE.md).
- **Timestamps must increase.** With several PRs open at once, a migration whose timestamp predates one already applied to production will not run. Rebase and regenerate rather than hand-editing the prefix.
- **Every table gets `property_id`, RLS enabled, and a policy — in the same migration that creates it.** Not a follow-up. A table that reaches `main` without a policy is a cross-tenant data leak, and the generated sweep in `../tests/` exists to fail CI before that happens.
- Reversibility is not assumed. If a migration is genuinely risky, say so in its header comment and describe the manual recovery.

## Naming

`<timestamp>_<verb>_<subject>.sql` — `20260810120000_create_organisation_and_property.sql`. The verb matters: `create`, `add`, `alter`, `backfill`, `drop`.
