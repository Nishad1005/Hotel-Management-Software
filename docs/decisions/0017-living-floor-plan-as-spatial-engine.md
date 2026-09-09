# 0017 — The Living Floor Plan is a spatial view of the location tree, not a second model of the property

**Status:** Accepted
**Date:** 2026-09-09

## Context

The dashboard needs a picture of the back-of-house. [The UI redesign brief §6](../ui-redesign/UI_REDESIGN_BRIEF.md) originally answered that with a drawn illustration — one generic isometric SVG of a plausible hotel store, with real readings pinned over it at percentage coordinates. The pins would have been true; the building underneath them would have been a stock photograph. A property with two chillers and no wine store would have looked at a picture of somebody else's premises.

[`LIVING_FLOOR_PLAN_SPEC.md`](../ui-redesign/living-floor-plan/LIVING_FLOOR_PLAN_SPEC.md) replaces it with a plan drawn from the property's own rooms and locations, and that raised the question this ADR settles: **where do those rooms and locations live?** The spec names two new tables, `facility_rooms` and `facility_locations`, the latter carrying a nullable `stock_location_code` linking each drawn location back to the storage location it represents.

The decisive observation is that the app already has the locations. Provisioning seeds seven rows in `public.location` for every property ([`20260811063029_create_provisioning.sql`](../../supabase/migrations/20260811063029_create_provisioning.sql)) — a security gate, a receiving terminal, a reject hold, a dispatch terminal, a dry store, a cold room and a freezer — and `storage_regime` on each already distinguishes ambient from chilled from frozen. That is the demo's entire location set, including the gate and dock the spec treats as fixed scenery, and the regime already predicts which visual each one wants. Everything a pin needs is keyed to the same table: `temperature_reading.location_id` for HACCP rounds, `stock_lot.location_id` for line counts, `stock_movement` for staging dwell.

So the two-table reading would have created a second list of the property's storage places beside the one that already exists. A property would type "Walk-in Chiller" once as a storage zone and again as a plan location, and `stock_location_code` would be the hand-maintained thread between them. The product's central claim is that nothing is entered twice; this would have broken it in the onboarding flow, which is the first thing a client ever sees. And the two lists drift — the link goes stale, the spec's own fallback ("unlinked locations fall back to type-level data for the site") kicks in, and a pin shows _a_ chiller's reading rather than _this_ chiller's. That is the invented telemetry the same spec forbids absolutely, arriving through a side door.

What the app genuinely lacks is the level above: "Main Kitchen Store" grouping a chiller, a freezer and a dry store. Zones today are flat — every one has `parent_id is null`.

## Decision

**The Living Floor Plan renders `public.location`. It does not model the property a second time.** One new table is added for the level that genuinely does not exist, and the drawn attributes become columns on the locations themselves.

```
facility_room     id, property_id, name, sort_order, created_at
                  unique (property_id, id)          -- composite tenant FK target, rule 4
                  RLS: read via accessible_properties(), write OWNER/ADMIN

public.location  += facility_room_id      composite FK (property_id, facility_room_id)
                 += plan_visual_type      text,  nullable
                 += plan_data_behavior    enum,  nullable
                 += plan_size             enum,  nullable  (S | M | L)
```

**A location appears on the plan when `plan_visual_type` is set.** No extra flag: the attribute that says how to draw something is also the statement that it is drawn. Bins never carry one, so a property's two hundred shelves cannot flood the map.

**No pixel coordinates are stored, ever.** Layout is derived at render time by the spec's `layoutAll()` — rooms as bays off a corridor, locations filling two lanes within a room. This is what lets a property add a room without a migration and without anyone re-drawing anything. `plan_size` is a layout _input_ (the S .78 / M 1 / L 1.22 footprint factor), not a coordinate.

**`plan_visual_type` is text, not an enum.** New visuals are registry entries in TypeScript, and a new visual must never require a database migration. Unknown values fall back to the generic `store` renderer with the location's name, so data written by an older or newer client can never fail to render.

**`plan_data_behavior` is a real enum** (`TEMPERATURE`, `COUNT`, `DWELL`, `RETURNABLE`) because each value names a specific source the code must already know how to read — adding one is code work regardless, so the closed set costs nothing and catches typos. **What a pin shows is decided by behaviour, never by visual.** A "Cheese Cave" drawn as a chiller with `COUNT` behaviour shows stock lines, not temperatures, and that separation is the whole reason a property can invent its own location types without us shipping anything.

### Presentation never implies a rule

**`storage_regime` is operational truth and carries the rules. `plan_visual_type` is presentation and carries none.** Nothing may read `plan_visual_type` to decide whether stock may be put somewhere, whether a cold chain applies, or what a temperature threshold is — those questions are answered by `regime`, `item.is_cold_chain` and `rule_config`, exactly as they are today.

Where `plan_visual_type` is null, **the visual is derived from `storage_regime` at render time** — `FROZEN` → freezer, `CHILLED` → chiller, `AMBIENT` → dry, with `location.kind` distinguishing the scenery (`SECURITY` → gate, `RECEIVING`/`DISPATCH` → dock and staging). A property that never opens the Floor Plan step still gets a correct plan of its seeded seven locations. The derivation runs one way only: setting a visual never writes back a regime.

### Real data or nothing

A pin shows a real reading for the location it sits on, or it shows "No reading yet". There is no third state. No placeholder values, no invented telemetry, and — because there is no link to go stale — no fallback to some other location's data. An empty pin is information: it says this chiller has not been read today, which is exactly what a Food Safety Officer needs to see.

### Labels live in screen space

The scene is two strictly separated layers. The **world** is isometric SVG in scene units, transformed as one unit by the gesture state. The **overlays** — room plates and reading pins — are absolutely-positioned native views in screen space, placed by projecting their scene anchors through the current transform. Label text is never drawn inside the scaled SVG. A name plate is ~11pt at every zoom level on every device, because a label that scales with the world is illegible at one end of the range and absurd at the other.

### The engine is vertical-agnostic

Location visuals are entries in a single registry — `LOCATION_TYPES[key] = { label, footprint, draw, defaultBehavior, icon }` — and the layout, gesture, level-of-detail, focus and pin machinery reads only that interface. Swapping the registry swaps the vertical: a FACTORY build (racks, bins, dispatch) or a PARTS build (shelves, counters) reuses the entire engine. **The registry module therefore imports nothing hotel-specific**, and neither does anything under the renderer that consumes it.

### Three departures from the spec's §2

Recorded because the spec stays in the tree and a later reader will otherwise implement it literally. **This ADR wins where they differ.**

1. **`facility_room` plus columns on `location`, not `facility_rooms` + `facility_locations`.** The spec's §2 opens with "extend (do not fork) the existing location hierarchy... map onto it; add only what's missing" — this is that instruction followed, with the table names read as illustrative.
2. **The columns are `plan_`-prefixed.** Eight tables depend on `location`; the prefix is what stops a future reader assuming `visual_type` gates a storage rule.
3. **`stock_location_code` does not exist, and neither does the type-level fallback.** The drawn location _is_ the stock location, so there is nothing to link and nothing that can come unlinked.

## Consequences

- **Never add a parallel table of the property's storage places.** If a future feature seems to need one, it needs a column on `location` or a table that references it. Two lists of the same shelves will disagree within a month, and the disagreement surfaces as a map showing stock somewhere it is not.
- **Never store a layout coordinate.** The moment one is persisted, adding a room becomes a migration and a re-draw, and the plan stops being able to assemble itself as somebody types.
- **Never read `plan_visual_type` in a rule.** It is a picture. `storage_regime` is the truth. A chiller icon on an ambient location is a data-entry mistake to surface in the setup screen, not a cold chain to enforce.
- **The three plan columns are nullable and stay nullable.** Making any of them `NOT NULL` would require a backfill and would break offline clients running older code that does not write them (rule 20). Null is meaningful in each case: no visual means derive from regime, no behaviour means derive from visual at render time, no size means M.
- **`plan_data_behavior` is filled by the client, not defaulted in SQL.** Its default is derived from `plan_visual_type`, whose meaning lives in the TypeScript registry — a SQL default would be a second copy of that registry in the database, and the two would diverge. The setup screen always sets it; the column only stores the answer.
- **The Floor Plan setup step creates zones, it does not only annotate them.** Writing to `location` normally, through the same OWNER/ADMIN policy the location admin screen uses. **It never creates bins** — a bin is a scanned put-away destination under hard rule 13, and a screen whose purpose is drawing a picture must not be a way to conjure somewhere stock can be dumped.
- **The Floor Plan step and the location admin screen are two views of one dataset.** That is the point, and it is also the maintenance cost: a change to what a zone is must be considered in both. The alternative was two datasets, which is worse.
- Retiring a location still goes through `deactivate_location`, which refuses while stock is on it (ADR 0003). A retired location leaves the plan; its history does not leave the ledger.
- **v1 caps a property at 4 rooms and 10 plan locations**, enforced in the setup UI, because `layoutAll()` is a corridor-and-bays algorithm that has not been tested beyond that. The cap is a UI rule, not a constraint — raising it is layout work, and a database constraint would make that work a migration for no benefit.
- Not decided here: the per-client type catalogue the spec floats for later (a table of named types appearing in the setup dropdown). Nothing above forecloses it — it would be a table of registry _presets_, not a second location model.
