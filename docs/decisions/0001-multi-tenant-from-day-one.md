# 0001 — Multi-tenant from day one

**Status:** Accepted
**Date:** 2026-08-10

## Context

The PRD names one reference deployment: Voyage The Solitaire Bliss, Tinsukia. It would be faster to build a single-property system and generalise later, and the pressure to do so is real — there is exactly one customer.

But Golai is intended as a product sold to hotels and restaurants, distributed through the Play Store and App Store. Multi-tenancy is not a feature that can be added to a working single-tenant system; it is a property of every table, every query, every index and every test. Retrofitting it means touching all of them at once, in a codebase that by then has real customer data in it.

## Decision

Every domain table carries `property_id` from the first migration, with row-level security enabled and a policy attached. Tinsukia is tenant #1, not the only tenant.

Two mechanisms enforce this rather than discipline alone:

1. A generated pgTAP test enumerates `information_schema` and **fails CI on any table without RLS enabled and at least one policy**.
2. Every test fixture seeds **two organisations with two properties each**. No test ever runs in a single-tenant world.

## Consequences

- Slightly more schema work up front, and every query carries a tenant predicate. This is the cost, and it is small.
- The realistic failure mode is not a badly-written policy but a table added months later with no policy at all. The generated sweep is the control for that, and it must never be disabled or allowlisted to unblock a build.
- Because every fixture is multi-tenant, cross-tenant bugs surface by themselves during ordinary development rather than needing to be anticipated. Do not "simplify" a test by seeding a single property.
- See [0002](0002-org-property-hierarchy.md) for which column is the tenant key, and why it is not `org_id`.
