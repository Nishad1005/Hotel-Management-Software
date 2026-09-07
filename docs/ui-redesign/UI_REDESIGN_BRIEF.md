# UI Redesign Brief — "Estate Heritage" theme adoption

**Status:** Approved for implementation. Execute phases in order; do not start a phase until the previous one typechecks.
**Design source:** `docs/ui-redesign/stitch-export/` — a Google Stitch export containing `DESIGN.md` (the token system, authoritative for colors/components) and five reference screens, each with `code.html` (Tailwind HTML — reference only, never ported literally) and `screen.png` (the visual target).

---

## 1. Context and intent

The app is the Golai Material Flow mobile app (`apps/mobile`) — Expo / expo-router / react-native-web, one codebase for browser and store builds. It currently uses the warm terracotta theme in `apps/mobile/theme.ts`.

We are adopting a new visual identity from the Stitch export: **"Estate Heritage & Operational Luxury"** — deep forest green structure, brass accents, warm linen surfaces, sage for healthy/compliant states, saffron for urgency, and a serif (Playfair Display) for headers and hero metrics with Plus Jakarta Sans for everything functional.

This is philosophically continuous with the existing theme's stated intent (warm off-white ground, white cards raised above it, scarce colour that means something) — it replaces terracotta-as-accent with forest+brass and adds the serif layer. It is a **reskin and relayout of existing screens, not a rebuild**. All screen logic, data wiring, Supabase calls, and navigation stay exactly as they are.

## 2. Decisions already made (do not relitigate)

1. **Full theme adoption.** The new tokens replace the old palette app-wide, so all screens shift together. No screen may end up half-old, half-new.
2. **Field density survives.** `touch.field` (60) and the larger `field`-density sizing on gate/dock/receiving screens are non-negotiable — gloves, sunlight, night use. The Stitch screens are desk-scaled (10.5–11px caps labels); take their _identity and layout_, not their interactive sizing, on field screens. Desk screens (masters, lists, admin) may sit closer to the Stitch scale.
3. **Type ramp stays five sizes** (32/22/17/15/13 as in `theme.ts`). Do NOT import the Stitch eight-role ramp — the repo deliberately collapsed to five sizes and the comments in `theme.ts` explain why. Map serif/sans _families_ onto the existing roles instead (see §4).
4. **The dashboard facility schematic is kept as a concept, rebuilt as a local SVG.** See §6. It is one swappable asset; status pins are real RN overlays fed by real data (HACCP temperature rounds, open gate entries, staging dwell) — never fake "live telemetry".
5. **No remote/hosted images anywhere.** The Google-hosted image URLs in the Stitch HTML are temporary and expire. Every visual asset ships in `apps/mobile/assets/`.
6. **Fictional Stitch content is discarded.** "Pargolai", "Royal Palm Villa & Spa", "Elena Vance", Bali, WITA timestamps, LoRaWAN copy — all placeholder. Keep layout and style; render real app data and the real product/property naming already used in the app.

## 3. Screen mapping

| Stitch export folder                          | Repo route                                          | Density   |
| --------------------------------------------- | --------------------------------------------------- | --------- |
| `pargolai_enterprise_gateway_login`           | `app/sign-in.tsx` (+ `components/auth-layout.tsx`)  | desk      |
| `pargolai_executive_operations_facility_hub`  | `app/index.tsx` (dashboard)                         | desk      |
| `gatehouse_new_arrival_console_monaco_luxury` | `app/gate/new.tsx`                                  | **field** |
| `dock_receiving_inspection_monaco_luxury`     | `app/receive/index.tsx` + `app/receive/[entry].tsx` | **field** |
| `put_away_storage_logistics_monaco_luxury`    | `app/putaway/index.tsx`                             | **field** |

All other screens are restyled implicitly by Phase 1/2 and swept in Phase 4.

## 4. Token mapping (Stitch → `theme.ts`)

Colors — add these as the new palette (names may be adapted to the repo's existing color-key conventions, but keep the semantic grouping):

- Surfaces: `linen50 #FAF9F5` (page bg), `linen100 #F5F2EB` (recessed panels / input bg), `linen200 #EDE8DC`, `champagne #E8E3D7` (hairline borders), `white #FFFFFF` (cards).
- Structure/primary: `forest950 #061510`, `forest900 #081C15` (sidebar bg), `forest800 #0D2818` (primary buttons), `forest700 #143628` (pressed), `forest600 #1D4736`.
- Accent: `brass300 #DCB879`, `brass400 #D4AF37`, `brass500 #C5A059` (active nav / key icons), `brass600 #B8860B`, `brass700 #9A7B38`, `brass100 #F5EEDC` (brass chip bg).
- Status: sage `#F2F6F3 / #43654E / #2D4735` (ok/verified/compliant), saffron `#FEF7ED / #C87D28 / #9C5914` (expiring/urgent/warning), error `#ba1a1a` on `#ffdad6` (rejected/blocked).
- Text: `ink #191C1B` (on-surface), `inkMuted #555E58` (on-surface-variant), `outline #A39E93`.

Colour stays scarce: sage/saffron/error only where state genuinely differs. Resist the Stitch screens' tendency to badge everything.

Typography:

- Add fonts via `@expo-google-fonts/playfair-display` (600, and 700 if needed) and `@expo-google-fonts/plus-jakarta-sans` (400/500/600/700). Load in `app/_layout.tsx` alongside/replacing the current Inter loading. Remove `@expo-google-fonts/inter` only after nothing references it.
- Family mapping onto existing roles: `display` and `title` → Playfair Display 600; `heading` → Playfair Display 600 (or Jakarta 700 if serif at 17px renders poorly on Android — check on device and pick one, consistently); `body`, `label`, `caption` → Plus Jakarta Sans.
- Add ONE new role only: `labelCaps` — Jakarta 600, 11px equivalent, `letterSpacing` ~1.2, uppercase, used for section flags and technical badges. (11px, not the Stitch 10.5 — RN + field readability.)

Radii: existing `radius` object already fits (cards `radius.lg` 16 or `radius.md` 12, nested panels `radius.md`, pills `radius.pill`). Pills (`radius.pill`) are reserved for buttons, search inputs, and status chips — exactly as DESIGN.md prescribes.

Shadows/elevation: soft green-tinted shadows on cards — RN `shadowColor: '#143628'` with low opacity (web) + `elevation` 1–2 (Android). No `backdrop-blur` anywhere (unsupported/inconsistent in RN); the fixed header becomes solid `linen50` with a champagne bottom hairline.

Interaction: no CSS hover. Use `Pressable` pressed states — primary button `forest800 → forest700`, list rows `linen50 → linen100`. No translate-y lift effects.

## 5. Phases

### Phase 1 — Theme foundation

Files: `theme.ts`, `components/ui.tsx`, `app/_layout.tsx`, `package.json`.

- New palette + `labelCaps` role + font loading per §4.
- Restyle `ui.tsx` primitives: primary button (forest pill, linen text, subtle brass border), secondary button (linen100 pill, champagne border, forest text), Card (white, champagne hairline, soft tinted shadow, `radius.lg`), status chip variants (sage / saffron / brass / error per DESIGN.md "Badges & Status Chips"), inputs (linen100 pill for search-type, standard fields keep rectangular `radius.md` with champagne border and brass focus ring).
- Also touch `components/scan-field.tsx` and `components/date-field.tsx` so form controls match.
- **Done when:** `pnpm typecheck` passes and every screen renders in the new palette with no terracotta remnants (grep the old accent hexes — zero hits outside git history).

### Phase 2 — Shell

Files: `components/shell.tsx`.

- Dark rail: `forest900` bg, full-height, deep right shadow. Wordmark in serif with `labelCaps` product line under it.
- Nav grouped under `labelCaps` section headers — MAIN / THE FLOW / STOCK / COMPLIANCE / SYSTEM — matching the Stitch sidebar and the existing routes (Gate, Receive, Put-away, Issue, Dispatch, Gate-out / Stock, Perishables, Opening / Temperature, Registers, Receipts, Returnables / Admin, Setup).
- Active item: linen text + brass left indicator or brass icon tint; inactive: linen at ~60% opacity. Pressed state, no hover.
- Keep existing responsive behavior (whatever shell does today for narrow screens stays functionally identical).
- **Done when:** navigation works on web + narrow viewport, all routes reachable, typecheck passes.

### Phase 3 — The five screens

One screen per commit, in this order: `sign-in` → dashboard (`index`) → `gate/new` → `receive` → `putaway`. For each: open the matching `screen.png` and `code.html` for layout reference, then re-express in RN using theme tokens and ui primitives only — no inline hexes, no new one-off font sizes.

- **sign-in:** split layout on wide viewports (hero panel left, form card right), stacked on mobile. Hero = local asset (see §6, login placeholder). Form: serif heading, Jakarta body, forest pill CTA.
- **dashboard:** header block (serif page title, action pills), schematic block (§6), metric cards row (labelCaps header / serif metric / linen footer strip per DESIGN.md "Cards & Telemetry Blocks") fed by real queries the screen already makes, station cards (To Receive / To Put Away / To Gate Out) with 4px left status pillar, consignment list, expiring-watch panel (saffron), temperature panel (dark forest card) from real HACCP round data.
- **gate/new, receive, putaway:** Stitch layout structure (staged sections with numbered `labelCaps` stage headers, right-hand summary/routing panel on wide screens) but **field density**: `touch.field` targets, `body`/`heading` sizes for interactive text, chips readable at arm's length. Existing validation and submit logic untouched.
- **Done when (per screen):** visually matches the reference composition in the new tokens, all existing behavior works, typecheck + existing tests pass.

### Phase 4 — Consistency sweep

Walk every remaining screen under `app/`: fix any hard-coded old colors, dead token references, or primitives bypassed with local styles. Confirm `type` legacy aliases still have no new callers. Full `pnpm typecheck && pnpm test`.

## 6. Asset strategy

Create `apps/mobile/assets/illustrations/`.

**`facility-schematic.svg` (dashboard).** Bespoke 2.5D isometric vector of a generic back-of-house in the theme palette: security gate → receiving bay → cold rooms (walk-in chiller, deep freeze) → dry store → wine/beverage store, on a linen ground with forest/brass detailing. Requirements: (a) it is ONE file, swapped later for a property-accurate version with zero code changes; (b) pin anchor positions are defined in a single exported constant (percentage coordinates), so the real-data overlays (RN Views absolutely positioned over the image) survive an asset swap by editing that one constant; (c) pins show real data only — e.g. latest temperature-round reading per zone with time + recorder, count of open gate entries at the gate pin, staging dwell at the bay pin. If a data source is empty, the pin shows a neutral "no reading yet" state — never invented values. Render via `react-native-svg` or as a pre-rendered PNG @1x/@2x if SVG complexity fights RN — implementer's choice, but the swappability contract holds either way.

**`login-hero.png` (sign-in).** Until the client supplies a real photograph of the property, ship a designed placeholder: deep forest-950→900 gradient composition with subtle brass linework and the wordmark — intentional, not missing-image. Same swappability rule: one file, no code changes to replace.

## 7. Guardrails

- Never port Tailwind classes or copy HTML structure literally; the `code.html` files are wireframes to read, not code to translate mechanically.
- No new dependencies beyond the two font packages and (if chosen) `react-native-svg`.
- No `localStorage`/DOM APIs — everything must run in native builds, not just web.
- Respect existing architecture (outbox, offline, capabilities in `packages/domain`) — this brief authorizes visual changes only.
- Each phase = its own commit(s); do not batch phases.
