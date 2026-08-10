# 0013 — Cloud-first development; migrations applied by the GitHub integration

**Status:** Accepted
**Date:** 2026-08-10

## Context

The standard Supabase workflow runs the whole stack locally in Docker: `supabase start`, `supabase db reset`, `supabase test db`. It gives instant iteration and a free, safe reset-and-replay loop.

Docker is not installed on the development machine, and installing it is a non-trivial step on Windows. The alternative — working against a hosted project — covers the entire day-to-day loop without it: `supabase migration new` only writes a file, and `db push`, `db pull` and `gen types --linked` all talk to the remote.

The repository has additionally been connected to Supabase through the **GitHub integration**, which changes the picture again: migrations are applied by the integration on push, so even `db push` becomes unnecessary.

The real question is therefore not "can we work without Docker" — we can — but **what is lost, and does it matter enough to block on.**

A further constraint appeared once the project was actually connected. The Supabase plan is free, and on the free plan **branching is unavailable** — there are no preview databases per pull request. The GitHub integration's "Deploy to production" toggle is available, but it applies migrations on merge **unconditionally**: it has no view of whether CI passed.

That is the deciding detail. An automatic deploy that cannot be gated on tests is worse than an explicit one that can.

## Decision

Develop cloud-first. No local Docker.

- Migrations are written into `supabase/migrations/`.
- **Supabase's "Deploy to production" stays OFF.** Migrations are applied by a GitHub Actions job that `needs` the test jobs, so nothing reaches production unless the pgTAP suite passed on that exact commit.
- **Types are to be generated in CI from the replayed migrations** (`gen types --local`), not from the live project. This needs no access token and no database password, and makes the committed types provably a function of the migrations rather than of whatever was last changed by hand in the dashboard. Not yet wired — it lands with `packages/db`, and must fail on a missing file as well as a drifted one.
- **pgTAP runs in CI**, where GitHub Actions runners provide Docker at no cost, replaying every migration from an empty database.

Docker can be installed later without changing any of this.

## Consequences

- **The test suite is the deployment gate.** This is the main benefit and the main obligation: a weak test suite now means a weak production safeguard. Never make the deploy job independent of the test jobs to "unblock" a release.
- Deployment needs two GitHub Actions secrets — a Supabase access token and the database password. They live in GitHub, are never committed, and are never pasted into a chat or an issue.
- **Reset-and-replay is lost locally.** That loop is how migration _ordering_ bugs get caught, and this project treats migrations as the source of truth. Mitigation: CI replays from empty on every run by construction, which is the same check.
- **Timestamp collisions become a live concern.** With several pull requests open, a migration whose timestamp predates one already applied to production will silently not run. Rebase and regenerate.
- **No preview database per pull request** while on the free plan. CI's replayed stack substitutes for it — that catches schema and test failures, though not anything that depends on production data. Revisit if Pro is ever adopted; branching would then complement this rather than replace it.
- Iteration is a network round trip rather than instant. Tolerable; the main thing that would justify installing Docker later.
- `supabase functions serve` is unavailable locally. Worth revisiting when number leasing and the reconciliation sweep arrive.
- The pgTAP suite cannot be run before pushing. Expect to learn about RLS failures from CI — an argument for keeping those tests fast and their failure messages explicit.
