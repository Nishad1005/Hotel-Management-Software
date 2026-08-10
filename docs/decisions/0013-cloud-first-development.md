# 0013 — Cloud-first development; migrations applied by the GitHub integration

**Status:** Accepted
**Date:** 2026-08-10

## Context

The standard Supabase workflow runs the whole stack locally in Docker: `supabase start`, `supabase db reset`, `supabase test db`. It gives instant iteration and a free, safe reset-and-replay loop.

Docker is not installed on the development machine, and installing it is a non-trivial step on Windows. The alternative — working against a hosted project — covers the entire day-to-day loop without it: `supabase migration new` only writes a file, and `db push`, `db pull` and `gen types --linked` all talk to the remote.

The repository has additionally been connected to Supabase through the **GitHub integration**, which changes the picture again: migrations are applied by the integration on push, so even `db push` becomes unnecessary.

The real question is therefore not "can we work without Docker" — we can — but **what is lost, and does it matter enough to block on.**

## Decision

Develop cloud-first. No local Docker.

- Migrations are written into `supabase/migrations/` and applied by the **GitHub integration**: a pull request creates a preview branch and runs them there; merging to `main` runs them against production.
- Types are generated from the linked project.
- **pgTAP runs in CI**, where GitHub Actions runners provide Docker at no cost. The tenant isolation sweep therefore still gates every push and pull request.

Docker can be installed later without changing anything about this setup.

## Consequences

- **Every push to `main` alters the production database.** There is no command to forget and no confirmation step. `main` must stay migration-clean, and work should reach it through pull requests so the preview branch fails first. This is the single most important thing to remember about the setup.
- **Reset-and-replay is lost locally.** That loop is how migration _ordering_ bugs get caught, and this project treats migrations as the source of truth. Mitigations: CI replays from empty on every run by construction, and preview branches are created data-less from migration history, which is itself a replay. `supabase db reset --linked` exists but is destructive — never point it at production.
- **Timestamp collisions become a live concern.** With several pull requests open, a migration whose timestamp predates one already applied to production will silently not run. Rebase and regenerate.
- Iteration is a network round trip rather than instant. Tolerable; it is the main thing that would justify installing Docker later.
- `supabase functions serve` is unavailable locally, so edge functions are tested by deploying to a preview branch. Worth revisiting when Phase 1 brings number leasing and the reconciliation sweep.
- The pgTAP suite cannot be run before pushing. Expect to learn about RLS failures from CI rather than locally — an argument for keeping those tests fast and their failure messages explicit.
