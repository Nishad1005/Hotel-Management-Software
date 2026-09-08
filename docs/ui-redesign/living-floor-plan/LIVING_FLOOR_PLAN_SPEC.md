# Living Floor Plan — Implementation Spec (LFP)

**Status:** Approved. This supersedes §6 (facility schematic) of `UI_REDESIGN_BRIEF.md` — the static SVG asset approach is retired. Append the amendment at the bottom of this file to the brief.
**Reference implementation:** `living-floor-plan-demo-v7.html` in this folder. It is a working single-file demo of the exact target behavior. Open it in a browser and interact with it before writing any code. Port its logic; do not invent alternatives to decisions it embodies.

## 1. What this is

A data-driven, interactive isometric map of the property's back-of-house, rendered live from the same rooms → locations hierarchy the app already tracks stock in. It is simultaneously: the dashboard hero, the navigation surface (tap a location → its stock), the compliance surface (HACCP readings pinned in space), and the onboarding wow-moment (the plan draws itself as the client types their rooms during setup).

## 2. Data model

Extend (do not fork) the existing location hierarchy. If the app already has rooms/areas containing storage locations, map onto it; add only what's missing:

- `facility_rooms`: id, site_id, name, sort_order.
- `facility_locations`: id, room_id, name, visual_type (string; one of the built-in renderers: chiller | freezer | dry | wine | kegs | linen | store | staging — but stored as a string, NOT a DB enum, so new types never need migration), data_behavior (enum: temperature | count | dwell | returnable — defaults derived from visual_type but independently settable), size (S|M|L), stock_location_code (nullable — links to the existing stock location entity when set).
- No pixel coordinates are stored. Layout is derived at render time (see §4). This is deliberate: layouts must survive room additions without migration.

Pin data sources (REAL data only — this rule is absolute):

- chiller/freezer/wine → latest HACCP temperature-round reading for the linked location: value, time, recorder name.
- dry/linen/store → stock line count (and % in-spec where the data exists) for the linked location.
- kegs → open returnables count.
- staging → current staging dwell (from receive flow timestamps).
- gate → count of open gate entries. dock → active bay state.
- Pin source is decided by `data_behavior`, never by visual_type: temperature → HACCP rounds; count → stock lines; dwell → staging timestamps; returnable → returnables count. A custom "Cheese Cave" with visual_type=chiller and data_behavior=temperature gets real HACCP pins with zero code.
- Any source empty → the pin renders a neutral "No reading yet". Never a placeholder value, never invented telemetry.
- Unlinked locations (no stock_location_code) fall back to type-level data for the site; link resolution beats type fallback when present.

Tap behavior: tapping a location in detail mode navigates to that location's stock screen (or the location detail screen if one exists). Tapping gate/dock pins → gate log / receiving. This drill-down is the point of the whole feature — do not ship the map without it.

## 3. Rendering architecture (the part that silently goes wrong)

Two strictly separated layers:

1. **World layer** — the isometric scene, drawn in scene units via `react-native-svg`, transformed as one unit by the gesture state (the demo's viewBox engine). Rebuild only when data changes; memoize by a hash of rooms+locations+env mode.
2. **Overlay layer** — room name plates and reading pins. These live in **screen space**: absolutely-positioned RN Views over the SVG, placed by projecting each anchor (scene coords) through the current transform each frame (reanimated shared values → useAnimatedStyle). They NEVER inherit the world's scale — a label is ~11pt on screen at every zoom, on every device. The demo achieves this by counter-scaling SVG groups against measured pixels; in RN, native Views in screen space are the cleaner equivalent and give better text rendering. Do not draw label text inside the scaled SVG.

Gestures: `react-native-gesture-handler` pan + pinch + double-tap, driving a viewBox-equivalent {x,y,w,h} in reanimated shared values. Wheel zoom on web (react-native-web) with cursor-anchored zoom, exactly as the demo. Clamp zoom to [0.16, 1.15] × fit width. Fly-to animations ≈ 420ms ease-in-out cubic; respect reduced-motion.

## 4. Auto-layout (port from demo verbatim)

`layoutAll()` in the demo is the algorithm: rooms are laid left→right as bays off a shared corridor; within a room, locations fill two lanes (front/back), assigned to whichever lane is currently shorter; room width derives from lane extents; building width derives from total room widths; the receiving dock is pinned near the right end of the back wall; gate, drive, pool and grounds are fixed scenery. Footprints per type and size factors (S .78 / M 1 / L 1.22) are in `footprint()`. Limits for v1: 4 rooms / 10 locations per site, enforced in setup UI with a friendly note (raise later only with layout work).

## 4b. Type registry & extensibility (build this shape in LFP-1/LFP-2)

Location types are entries in a single renderer registry, not scattered switch cases:
`LOCATION_TYPES[key] = { label, footprint(size), draw(props), defaultBehavior, icon }` — the demo's `footprint()` and `drawLoc()` switches are the raw material; formalize them into this registry when porting.
Rules:

- **Unknown visual_type always falls back** to the generic `store` renderer with the location's name — old or third-party data can never fail to render.
- Adding a new visual = adding one registry entry (footprint rule + draw function + default behavior). Layout, gestures, LOD, focus, pins, and drill-down require no changes.
- Custom, property-specific locations need NO new types: users compose a custom name + an existing visual + a data_behavior at setup time ("Cigar Humidor" = store visual + count behavior; "Cheese Cave" = chiller visual + temperature behavior). Expose behavior in the setup UI as a simple "Readings come from" selector, pre-filled from the visual.
- Future (not in v1): a per-client type catalog table (label, visual_type, behavior, accent) whose entries appear in the setup dropdown — schema may be stubbed now but no UI.
- The registry is vertical-agnostic by design: alternative registries (FACTORY: racks/bins/dispatch; PARTS: shelves/counters) reuse the entire engine. Keep the registry file free of hotel-specific imports.

## 5. Interaction model — the LOD ladder

Three levels, each defined by view width vs fit width:

- **Overview** (default, w ≥ 0.6×fit): scene + room name plates only. No pins of any kind. Plates anchor to the corridor in front of each room (never over contents). Plate tap → fly-to that room.
- **Detail** (w < 0.6×fit): plates hide; reading pins appear for locations inside the viewport (plus gate/dock when visible). Pins respect the user's "show readings" preference.
- **Focus** (automatic whenever in detail): the room nearest the viewport center holds the spotlight — everything outside its isometric silhouette is dimmed by an even-odd cutout overlay (day rgba(16,36,26,0.78), night rgba(2,8,6,0.86)). Focus follows the center as the user pans between rooms; zooming out releases it. Tapping the dimmed area = zoom back to overview. A "← Whole property" pill shows whenever zoomed (w < 0.92×fit).

The silhouette cutout is the hexagonal hull of the room's box (footprint padded 0.7 units, height 4.3) — see `focusHexPath()`.

## 6. Day/night environment

The scene follows the device clock: day palette 06:00–17:59, night otherwise, with a ☾/☀ control for manual override (auto until first tap). All environment-dependent colors live in one `computeEnv()` token set — both palettes are fully enumerated in the demo (`EV` object): grounds, drive, pool water + glow, gate window glass + glow, lamps on/off, building halo, flora tones, dim strengths. Night is the signature look (glowing lit building on dark grounds, path lamps, luminous pool); day is the calm working look. The interior (building floor, rooms, locations) does NOT change between modes — only the environment. Sync the surrounding dashboard card chrome to the mode (dark card frame at night).

## 7. Setup experience

A "Floor Plan" step in property setup mirroring the demo's left panel: rooms as cards (serif name header on forest), locations nested inside with name / type / size / optional stock-location link (a picker over existing stock locations, not free text, in the real app), reorder and delete, with the live plan rendering beside/below and updating on every keystroke. Selecting a location card flies the preview to its room. This screen is desk density.

## 8. Phases

- **LFP-1 Data + setup:** tables/migrations (visual_type as string + data_behavior enum per §2/§4b), CRUD, setup screen with live preview using a static (non-gesture) render, including the "Readings come from" behavior selector. Done when: a property's rooms/locations round-trip and the preview redraws on edit; typecheck passes.
- **LFP-2 World renderer:** full scene port (iso math, boxes, all 8 location visuals, grounds, day/night env). Done when: demo-parity screenshots in both modes on web + one native platform.
- **LFP-3 Gestures + LOD + focus:** viewBox engine, overlays in screen space, plate/pin LOD, auto-focus dim, fly-to, back pill, day/night toggle. Done when: the demo's full interaction loop works on touch and web, labels hold ~11pt at all zooms.
- **LFP-4 Live data + drill-down:** wire all pin sources per §2, empty states, tap-through navigation to stock/HACCP screens. Done when: every pin shows real data or "No reading yet", and every tap lands on the right screen.
- **LFP-5 Dashboard embed:** replace the dashboard schematic block, mode-synced card chrome, performance pass (memoized scene, 60fps gestures on a mid-range Android), reduced-motion.

One phase per session/commit. Read the demo file at the start of every phase.

## 9. Guardrails

- The demo is the spec for look and behavior; the app's `theme.ts` tokens are the source of truth where they overlap — extend `theme.ts` with the env token sets rather than hardcoding hexes in components.
- Never fake pin data. Never store layout pixels. Never let labels scale with the world.
- Field-density rules from the main brief are untouched — this feature is desk/dashboard surface; gate/dock/receive screens are unaffected.
- No new heavy dependencies beyond react-native-svg / gesture-handler / reanimated (all standard; check what's already installed first).

## Amendment to append to UI_REDESIGN_BRIEF.md

> Amendment (LFP): §6's static facility-schematic asset is superseded by the Living Floor Plan — a data-driven interactive isometric map spec'd in docs/ui-redesign/living-floor-plan/LIVING_FLOOR_PLAN_SPEC.md with reference implementation living-floor-plan-demo-v7.html. The facility-schematic.svg asset and pins.json contract are retired. Phase 3's dashboard screen embeds the Living Floor Plan (phase LFP-5) in place of the schematic block.
