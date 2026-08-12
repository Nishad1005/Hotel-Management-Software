# 0016 — The web app is hosted on Cloudflare Pages

**Status:** Accepted
**Date:** 2026-08-12

## Context

[ADR 0014](0014-web-first-via-expo-web.md) makes web the first delivery target, and the app has been reachable only on `localhost` since it was written. Nobody at the property can open it, and one whole class of work is blocked: browsers refuse `getUserMedia` outside a secure context, so **neither the camera nor the QR scanner can be tested anywhere but localhost** until the app is served over HTTPS from a real host.

`app.json` sets `web.output: "single"`. The build is a pure static single-page app — no server rendering, no serverless functions, no API routes. Every candidate host could serve it, so the decision is not about capability.

## Decision

**Cloudflare Pages**, on a `pages.dev` subdomain until a domain is chosen.

The deciding factor is licensing, not performance:

- **Vercel's Hobby tier prohibits commercial use.** Golai is a commercial multi-tenant SaaS, so the free tier is not available to us and running on it invites suspension. That makes Vercel a $20-per-seat Pro subscription for features a static SPA does not use.
- **Netlify's free tier permits commercial use but stops serving.** Since April 2026 it is credit-based — roughly 15 GB and 20 deploys a month — and when the credits run out the site goes dark with no auto-recharge. A hotel losing the app mid-shift because a month's build credits ran out is not a failure mode worth accepting to save $9.
- **Cloudflare Pages is free, explicitly permits commercial use, and has no bandwidth limit** at any tier, with 500 builds a month. It also has the densest edge presence in India of the three, which matters for a product whose first customers are all here.

## Consequences

- Cost stays at zero from the pilot through several properties, and there is no tier at which the site silently stops serving.
- **Cloudflare runs the build**, because `dist/` is git-ignored. That is the behaviour we want: `EXPO_PUBLIC_*` values are inlined by Metro at export time, so they must be present in the build environment rather than at runtime. Pointing the app at a different Supabase project is a rebuild, not a settings change.
- `apps/mobile/public/_redirects` is required and is now part of the build. Without `/* /index.html 200`, a refresh on any client route is a 404 from the host, because no such file exists. It is a rewrite rather than a redirect, so real assets under `/_expo/` and `/assets/` still win.
- **The app must be served from the domain root.** Every asset path in the export is root-absolute, so a sub-path deployment breaks all of them.
- Preview deployments come per branch, which is worth having given there are no Supabase preview databases on the free plan (ADR 0013) — the web preview is the only per-branch environment we get.
- Moving hosts later is cheap. `_redirects` is the same file Netlify uses, and nothing else here is host-specific. That is a property of having chosen a static SPA, and it is worth keeping: no build step should acquire a dependency on one host's runtime.
- Not decided here: the custom domain, and whether the gate device eventually runs an installable PWA. ADR 0014 anticipates the PWA; nothing about this choice blocks it.
