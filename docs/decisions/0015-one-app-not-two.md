# 0015 — One app, not two

**Status:** Accepted
**Date:** 2026-08-10
**Supersedes part of:** [0014](0014-web-first-via-expo-web.md)

## Context

The build plan called for two front ends: an Expo app for the gate and dock, and a Next.js console for the back office. The reasoning was sound while the gate app was native — a security guard on a phone at night and a manager building a fifteen-field inspection template at a desk are different humans on different devices doing incomparable work, and a drag-and-drop form builder does not want react-native-web.

[ADR 0014](0014-web-first-via-expo-web.md) then made the gate app a web app too. That quietly destroyed most of the justification: the split stopped being "native versus web" and became "two web codebases", which is a much weaker reason. The second app was scaffolded anyway, carried forward from a plan written before the decision that undermined it.

## Decision

**One application.** `apps/mobile` is it — an Expo app serving web today and native later, covering every surface: gate capture, dock receiving, put-away, issue, and the administrative screens.

Administrative surfaces become routes (`/admin/templates`, `/admin/items`) that render desktop-appropriate layouts. Expo Router handles this; nothing about the router or the navigation model needs to change.

`apps/admin` is deleted rather than left dormant, because a scaffolded-but-unbuilt app accumulates configuration drift and answers "where does this go?" wrongly for months.

**The directory keeps the name `apps/mobile`.** It is inaccurate — the app serves web too — but renaming it costs a full reinstall on this machine for a cosmetic gain.

## Consequences

- One login, one deploy, one design system, one dependency tree. With a small team and no users, this is the dominant consideration.
- **Given up: server-side rendering, dense data-table ecosystems, straightforward CSV import and PDF generation** — the things Next.js does well and react-native-web does not. None are needed before the inspection template builder and the reporting screens, which are Phases 5 and 8.
- Desktop layouts inside a React Native app take deliberate work. Responsive breakpoints and hover states are not free the way they are in a normal web app. Budget for that when the admin screens arrive rather than being surprised.
- **Splitting later stays cheap, and that is what makes this safe.** `packages/domain` and `packages/db` do not move; only screens do. Revisit when the console genuinely outgrows the app — a template builder that fights the framework is the signal, not a general feeling that it would be tidier.
- The bundle now serves every role to every user. Once roles are enforced this needs code splitting so a security guard's device is not downloading the template builder.
