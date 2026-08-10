# 0014 — Web first, from the same Expo codebase

**Status:** Accepted
**Date:** 2026-08-10

## Context

The product is intended for the Play Store and the App Store, and the PRD's primary users are at a security gate and a wet receiving dock — gloved hands, night shift, weak 4G. That argues for native.

But native has a slow feedback loop. Store accounts are not yet open (the D-U-N-S application alone is 1–2 weeks), device builds take minutes, and nothing can be shown to the property until a build is installed on a phone. For a product whose largest risk is human — whether an outsourced guard with high churn will actually use it — waiting months to put anything in front of anyone is the expensive choice.

The naive resolution is to build a throwaway web version first and rewrite it native later. That is two implementations of the same flows, and the second one is always written under deadline.

**Expo removes the dilemma.** React Native renders to the web through react-native-web, so one codebase serves a browser today and produces store builds later. This was already a reason for choosing Expo over Flutter.

## Decision

**Web is the first delivery target. The code is not web-specific.**

- `apps/mobile` is an Expo app with **web enabled from day one**, covering the Security and Storekeeper flows. It runs in a browser now and builds for Android and iOS later, from the same source.
- `apps/admin` stays Next.js. It is a data-dense desktop product for managers — template builder, item master import, dashboards — and shares an audience and device class with nothing on the dock.
- Native store builds move to Phase 9. They are deferred, not abandoned: the product is still designed within store constraints.

## Consequences

- **The offline layer is the one place web and native genuinely diverge**, and it is the layer the entire reconciliation control depends on. Native uses SQLite; web uses IndexedDB or OPFS. **The outbox must sit behind a storage interface with two drivers from the first commit.** Retrofitting that once the outbox has callers is the expensive version of this decision, and the only part of it that cannot be deferred safely.
- Camera and QR scanning work in the browser through `getUserMedia`, but with less control than native over focus, torch and continuous scanning. Expect the dock's scanning experience to be measurably better on native. Do not treat the web numbers as evidence for the four-minute and sixty-second acceptance criteria — those must be re-measured on a real device.
- The gate device is Android, and Android PWAs are capable: installable, service workers, background sync, persistent storage. This path would be far weaker if the gate device were an iPhone. The PRD's Android-first stance (§13) is what makes it viable.
- Web bundles from Expo are heavier than a hand-written web app would be. For an internal tool on property Wi-Fi this is not worth optimising.
- **The property can be shown the real flow within weeks, on a laptop.** That is the point of the decision, and the reason it is worth the storage-driver work.
- Nothing here changes the schema, the domain rules or the tenancy model. Those were always platform-agnostic, which is why `packages/domain` has no I/O ([ADR 0009](0009-domain-package-has-no-io.md)).
