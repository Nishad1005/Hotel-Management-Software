# LFP-4 — the pin data contract

**Status: APPROVED 2026-09-24**, with two changes from the draft, both recorded in place:
the gate pin ships as "No reading yet" and the missing gate-out write path is a product gap
(§2.5); and colour is not dropped but restricted to states provable from data (§5).

What each pin on the Living Floor Plan reports, where the figure comes from, what it says
when there is nothing to report, and where a tap takes you. Written against the schema as
of migration `20260909040717` and the screens on `main` at `056be69`. Every claim below
about a table, a function or a screen was checked against the source, not recalled.

Spec: [`LIVING_FLOOR_PLAN_SPEC.md`](LIVING_FLOOR_PLAN_SPEC.md) §2 and §8 (LFP-4). Data
model: [ADR 0017](../../decisions/0017-living-floor-plan-as-spatial-engine.md).

---

## 1. Rules that apply to every pin

These were set when the contract was commissioned, and the sources below are shaped by
them.

1. **Real data or nothing.** A pin shows a figure the database holds, or the words
   "No reading yet". Never a placeholder, never a sample, never another location's figure.
2. **A pin aggregates its zone's subtree.** Stock sits in bins, not zones — put-away
   refuses anything that is not a `BIN`. So a zone pin sums the zone itself **and every
   active descendant** (racks and bins). The zone itself is included because opening
   stock may be recorded directly against a zone (`/stock/opening` offers every non-security
   location, not only bins), and a figure that skipped it would be wrong on the first day.
3. **A pin may fall back to its own stock count, never to another location's data.** Where
   a pin's configured source has nothing, and its own subtree holds stock, it may show that
   count instead, labelled as a count. It may never show a sibling's, a parent's or the
   property's figure in place of its own.
4. **Any property-scoped figure says so on the pin.** The word is "property-wide", in the
   caption where the source name sits today.
5. **Time on a pin is the server's.** `recorded_at`, `occurred_at`, `timestamp_in` — never a
   device timestamp (CLAUDE.md rule 19).
6. **Reads are ordinary reads.** Every source below is a `SECURITY INVOKER` function or a
   plain select under RLS. No pin needs a `SECURITY DEFINER` path, and none gets one.

### How the subtree is found

A location's subtree is every active row reachable through `parent_id` from it. The tree
is at most three deep (zone → rack → bin; `PARENTABLE` in `location-admin.ts` is ZONE,
RECEIVING, REJECT, DISPATCH, RACK; a bin cannot be a parent). One recursive CTE, scoped
to the property, serves every source below. It runs once per plan load, not once per pin.

---

## 2. The six sources

The behaviour is `plan_data_behavior`, or, where that is null, the registry's default for
the visual (ADR 0017 §"presentation never implies a rule"). The visual never decides the
source.

### 2.1 TEMPERATURE — chiller, freezer, wine

|             |                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source      | `public.temperature_reading`, latest row by `recorded_at` for any location in the subtree                                                                                                                                                                                                                                                                                                                                                     |
| Shows       | `3.8°C · 09:40` — the value and the server time it was recorded, as in the demo                                                                                                                                                                                                                                                                                                                                                               |
| Also        | The recorder's name is on the row (`recorded_by`) but there is no client-readable join from auth ids to names. The pin does not show a name. The spec asks for one; it is deferred with the same reason the temperature register gives at `temperature.ts` line 85.                                                                                                                                                                           |
| Empty       | "No reading yet"                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Fallback    | Own stock count, if the subtree holds stock: `12 lines · no reading`                                                                                                                                                                                                                                                                                                                                                                          |
| Aggregation | **Needed, and confirmed.** The temperature round lists _every_ active CHILLED or FROZEN location as a unit, and a bin copies its parent's regime at creation (`location-admin.ts` line 200). So a cold room with three bins can have readings against the zone, against any bin, or both. Without the subtree, a pin on the zone would say "No reading yet" over a bin that was read this morning — the exact false assertion rule 1 forbids. |
| Tie-break   | Newest wins across the subtree. Where two readings share a timestamp to the second, the one on the shallower location wins.                                                                                                                                                                                                                                                                                                                   |
| Tone        | **Attention when not read today**, in the property's own timezone (`property.timezone`, default Asia/Kolkata); neutral when read today. Whether the value is safe is a threshold and stays neutral until HACCP limits have an admin UI. See §5.                                                                                                                                                                                               |

### 2.2 COUNT — dry, linen, store (and the fallback for every other source)

|             |                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source      | `public.stock_lot` where `qty > 0`, over the subtree                                                                                                                                                   |
| Shows       | `142 lines` — the number of distinct (batch, location, state) lots, which is what "lines" means on the stock screen                                                                                    |
| Empty       | `0 lines`. **Not** "No reading yet": an empty store is a true reading, and the FSO reading "no reading" over an empty shelf would go looking for a missing round.                                      |
| Every state | Counted across every state, as the stock screen does. Quarantine cannot appear in a zone's subtree (it lives at T1) but `BLOCKED` and `ISSUED` can, and hiding them would make a count come out short. |
| Aggregation | Needed, confirmed: stock is held in bins.                                                                                                                                                              |
| Not shown   | The demo's `98% in-spec` on linen. There is no in-spec figure in the schema. It is not invented.                                                                                                       |

### 2.3 DWELL — staging

The commission asked whether per-location dwell is derivable from the ledger before
concluding it needs new data. **It is derivable.** For each lot in the subtree with
`qty > 0`, the arrival is the most recent movement whose `to_location_id` is that lot's
location and whose `batch_id` matches; dwell is `now() − occurred_at`. That is the same
construction `list_awaiting_putaway` uses for Terminal 1, generalised to any location.

|                           |                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source                    | `public.stock_lot` joined to the latest inbound `public.stock_movement` per lot, over the subtree                                                                                                                                                                                                                              |
| Shows                     | `24 min dwell` for the **longest** dwell in the subtree — the figure the zone exists to shrink, as at T1                                                                                                                                                                                                                       |
| Empty                     | Subtree holds no stock: `Empty`. (Not "No reading yet": nothing is waiting, which is the good state.)                                                                                                                                                                                                                          |
| Fallback                  | None needed; when there is stock the dwell always exists, because every lot got there by a movement.                                                                                                                                                                                                                           |
| Aggregation               | Needed, confirmed.                                                                                                                                                                                                                                                                                                             |
| Caveat, stated on the pin | None. But recorded here: a lot moved bin-to-bin inside the zone restarts its own clock, because the arrival is the last inbound movement to _that_ location. A `ZONE_TRANSFER` between two zones restarts it too, which is right. A future "dwell since it entered this zone" would need to walk the chain; not in this phase. |

**Quarantine dwell at Terminal 1 does NOT go here.** It goes on the dock pin (§2.6), as
directed.

### 2.4 RETURNABLE — kegs

|             |                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source      | `public.list_returnables(property)` — rows with `outstanding > 0`, summed                                                                                                                                                                                                                                                                                                               |
| Shows       | `16 returnable · property-wide`; with overdue promises, `16 returnable · 3 overdue · property-wide` (see §5)                                                                                                                                                                                                                                                                            |
| Empty       | `0 returnable · property-wide`                                                                                                                                                                                                                                                                                                                                                          |
| Fallback    | Own stock count, if the subtree holds stock. Shown **instead of** the property figure only when the property figure is zero and the subtree holds stock, because otherwise the more useful of the two is the register.                                                                                                                                                                  |
| Aggregation | **Not possible, and this is the known limitation.** `returnable_item` hangs off `dispatch_note`, whose `origin_location_id` is always Terminal 2 (`stage_for_dispatch` writes `v_t2`). The bin the kegs actually left is on the `stock_movement` rows behind the dispatch, but the returnable row does not point at them. So the register cannot say which keg store a crate came from. |

**Known limitation, to record in HOW_IT_WORKS:** a property with two keg stores sees the
same returnables figure on both pins, each labelled "property-wide". Attributing returnables
to a location needs `returnable_item` (or `dispatch_note`) to carry the source location,
which is a migration and a change to `stage_for_dispatch`. Not in this phase.

### 2.5 GATE — the security gate (scenery pin)

The commission's definition: **"on site" means gate-in with no gate-out recorded.**

How gate-out links to the entry, checked: `gate_entry.timestamp_out`. It is the _only_
column an UPDATE may touch (`gate_entry_close` policy, column grant, and the
`gate_entry_is_append_only` trigger in `20260813093109`), it may be written once, and it
is a `[P1]` field. **Nothing in the app writes it yet** — no screen, no sync mapping, no
RPC; `packages/db/src/types.ts` merely knows the column. The outbound gate pass
(`gate_pass.timestamp_out`) is a different record for goods leaving, not the vehicle's
departure.

|                        |                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source, when it exists | `public.gate_entry` where `timestamp_out is null`, counted, for the property                                                                                                                                                                                                                                                                                               |
| Will show              | `3 on site`, or `1 on site`; `None on site` when empty                                                                                                                                                                                                                                                                                                                     |
| Aggregation            | Property-scoped by nature: the gate is the property's one gate. Labelled `property-wide` under rule 4? **No** — it is the gate's own figure, not a stand-in for something location-scoped, so the label would mislead. The caption stays "on site".                                                                                                                        |
| **In LFP-4**           | **"No reading yet", always.** Until a screen records vehicles leaving, an on-site count only ever grows, so the pin would show every vehicle that ever arrived. The source is not computed in this phase — a figure nobody can trust is not wired and hidden behind a switch, it is left out, and the phase that adds the exit action adds the column. Decided 2026-09-24. |

**Product gap, recorded in HOW_IT_WORKS (roadmap, not LFP-4):** `gate_entry.timestamp_out`
exists, is the one column the schema lets Security write, and nothing writes it. A resort
gatehouse has no way to record a vehicle leaving. The natural home is a gate log — arrivals
in, departures out, on site now — which is also the screen the gate pin would drill into.

Why not "no posted GRN", which `list_open_gate_entries` already computes: that is the
_receiving_ worklist, and it counts a rejected delivery or a courier who dropped a parcel
as open forever. The commission ruled it out, and the check above confirms the ruling.

### 2.6 DOCK — Terminal 1 (scenery pin)

Kept, as directed: **receipts in progress at T1, plus the longest quarantine dwell.**

|             |                                                                                                                                                                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source A    | `public.list_open_gate_entries(property)` — arrivals with no GRN, counted. This IS "receipts in progress": an arrival is on the worklist until it is posted. There is no draft state on the server (a receipt in progress is held in memory on `/receive/[entry]` until "Post receipt"), so nothing finer is possible. |
| Source B    | `public.list_awaiting_putaway(property)` — `max(hours_waiting)`                                                                                                                                                                                                                                                        |
| Shows       | `2 receiving · 3.5 h in quarantine`. Either half alone when the other is empty: `2 receiving`, or `3.5 h in quarantine`.                                                                                                                                                                                               |
| Empty       | Both empty: `Clear`                                                                                                                                                                                                                                                                                                    |
| Aggregation | Both are property-scoped by nature: one T1. Not labelled "property-wide", for the same reason as the gate.                                                                                                                                                                                                             |
| Tone        | Neutral. A dwell breach is recorded against the batch (`dwell_breach`) at RECORD_ONLY; that is the `MAX_DWELL_HOURS_AT_T1` threshold persisted, not a state of its own, so the pin does not turn it red. See §5.                                                                                                       |

---

## 3. Drill-down — where a tap lands

The spec (§2): _"tapping a location in detail mode navigates to that location's stock
screen (or the location detail screen if one exists). Tapping gate/dock pins → gate log /
receiving. This drill-down is the point of the whole feature — do not ship the map without
it."_

Checked against every registered route in `nav.ts` and every file under `apps/mobile/app`.
**No screen in the app accepts a route parameter that would scope it to a location**, and
there is no location detail screen and no gate log. The table says what exists.

| Pin         | Spec's target           | What exists                                                                                                                                                         | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEMPERATURE | HACCP screen            | `/temperature` — the capture round, every cold unit, no params. `/registers` — the Storage tab holds the register, no params, tab chosen by state.                  | **Land on `/registers` with the Storage tab selected and the location's code pre-filled as the filter.** Needs two small additions: a `tab` param and a `location` filter on that screen. Both are additive.                                                                                                                                                                                                                                                                                         |
| COUNT       | location's stock screen | `/stock` — every location, free-text search, no params                                                                                                              | **Land on `/stock` with the search pre-filled to the location's code.** `list_stock_on_hand` already matches `l.code`. Needs a `q` param on the screen. Additive. **Gap, stated:** the search matches the zone's code, so bins named `TW-DRY-A1` match `TW-DRY` by prefix, which is right for provisioned codes and only by convention. A location filter by id over the subtree is the correct version and is one more parameter on `list_stock_on_hand`. Recommended, not required for this phase. |
| DWELL       | (spec silent)           | `/stock` as above                                                                                                                                                   | Same as COUNT. The dwell figure itself is not on the stock screen; the tap lands on what is there.                                                                                                                                                                                                                                                                                                                                                                                                   |
| RETURNABLE  | (spec silent)           | `/returnables` — the register, no params                                                                                                                            | **Land on `/returnables`.** Nothing to scope, because the register is property-wide (§2.4).                                                                                                                                                                                                                                                                                                                                                                                                          |
| GATE        | gate log                | **Does not exist.** `/gate/new` is the capture form; `/gate/recorded` is the one-number confirmation; `/gate-out` is goods leaving under a gate pass, not vehicles. | **No target. The gate pin is not tappable in LFP-4.** It says so in its accessibility label. A gate log — arrivals in, departures out, on site now — is a real screen, is the natural home for the "vehicle has left" action §2.5 needs, and is not invented here.                                                                                                                                                                                                                                   |
| DOCK        | receiving               | `/receive` — the worklist, no params                                                                                                                                | **Land on `/receive`.** The quarantine half of the pin has its own natural home at `/putaway`; a pin has one tap, and receiving is the spec's word.                                                                                                                                                                                                                                                                                                                                                  |

**Every tap that lands somewhere lands on a screen that exists today**, with at most a
query parameter added to it. No new screen is created by LFP-4.

---

## 4. Where the figures are computed

One new `SECURITY INVOKER` function, `public.floor_plan_readings(p_property_id uuid)`,
returning one row per location in the plan (kind ZONE, SECURITY, RECEIVING, DISPATCH,
active) with every source's figure as nullable columns. One round trip per plan load. It
has:

- the subtree CTE from §1, once;
- the temperature, count and dwell figures per subtree;
- the property figures (returnables, on-site count, receiving count, quarantine max) as
  scalars the client attaches to the pins that want them.

It is a read over rows the caller may already see, so RLS is the whole answer to who may
call it. pgTAP: one test per source, each in the two-orgs-two-properties fixture, each
proving a figure from property A never appears on property B's plan, and one proving the
subtree sum (a reading on a bin surfaces on its zone's pin).

**No client computation of figures.** The client formats and places; it does not add.

---

## 5. Colour — provable state only

The rule, set at approval: **colour may encode a state that can be proved from data, never
a threshold judgement.** A threshold is a number somebody sets — a safe temperature, a
maximum dwell, a minimum shelf life — and every one of those ships RECORD_ONLY with no UI
to change it, so a colour keyed to one would be an enforcement the property cannot turn
off. A provable state is a fact the rows already hold.

Two tones: **neutral**, and **attention** (the demo's saffron). The text on the pin always
says what the attention is for; the colour never carries a meaning the words do not.

| Source      | Provable state                                                                                                                                                                                                                   | Threshold, stays neutral                    | Shipped                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEMPERATURE | **Not read today**, in the property's timezone. Either the last reading is from an earlier day or there has never been one; both are the fact the round exists to change.                                                        | Whether the reading is within HACCP limits. | **Yes.** Attention until a reading is recorded today.                                                                                                                                                                                                                                                                                                                                                                |
| COUNT       | Holds stock in `BLOCKED` (an FSO hold — a recorded human decision). Holds stock past its printed best-before (a date fact, not a limit).                                                                                         | None; a count has no threshold.             | **No.** `BLOCKED` is in the enum and **nothing writes it** — no RPC, no screen — so the state cannot occur; it is the same class of gap as gate-out and is listed with it. Expiry is provable but the product's stance on it is witness-only (`EXPIRED_STOCK_CANNOT_ISSUE` at RECORD_ONLY) and the expiring screen owns the question; a red store would read as an enforcement the property has not chosen. Neutral. |
| DWELL       | None. "How long" against any figure is `MAX_DWELL_HOURS_AT_T1` or a cousin of it.                                                                                                                                                | Dwell length.                               | Neutral.                                                                                                                                                                                                                                                                                                                                                                                                             |
| RETURNABLE  | **Outstanding past its promised return date.** The date is one the property itself recorded at dispatch, and `list_returnables` already ages against it (`days_overdue`). Overdue is a fact about a promise, not a limit we set. | None.                                       | **Yes.** Attention when any outstanding returnable is overdue; the text says `3 overdue`.                                                                                                                                                                                                                                                                                                                            |
| GATE        | None while there is no reading.                                                                                                                                                                                                  | —                                           | Neutral.                                                                                                                                                                                                                                                                                                                                                                                                             |
| DOCK        | None. The receiving count is the figure itself. A recorded `dwell_breach` is the T1 threshold persisted, not a separate fact.                                                                                                    | Quarantine dwell.                           | Neutral.                                                                                                                                                                                                                                                                                                                                                                                                             |

So two of the six sources carry a provable state and ship with it; the other four are
colourless, and the reason for each is above.

---

## 6. What this phase deliberately does not do

- **No threshold colour.** §5.
- **No recorder name on temperature pins.** No client-readable name join exists; the
  register has the same gap and states it.
- **No "% in-spec".** No such figure exists.
- **No per-location returnables.** §2.4.
- **No gate log, no vehicle-out action, no FSO block action.** §2.5, §5. Three write paths
  the schema allows for and nothing provides; all three are roadmap and recorded as product
  gaps in HOW_IT_WORKS.
- **No location filter on `list_stock_on_hand`.** The COUNT drill-down pre-fills the search
  with the zone's code, which matches its bins by prefix because bin codes are generated
  from the parent's code (`planLocationRun`). Correct by construction for every bin the app
  creates; a filter by id over the subtree is the stricter version, deferred.
- **No dashboard.** LFP-5.
- **No native run.** Still the case since LFP-3.

---

## 7. Decisions taken at approval (2026-09-24)

1. The six sources as specified, including COUNT's `0 lines` and DWELL's `Empty`.
2. The gate pin ships as "No reading yet"; the missing gate-out write path is a product gap
   on the roadmap, recorded in HOW_IT_WORKS.
3. The gate pin is not tappable in LFP-4.
4. Drill-down is by additive route parameters: `/registers?tab=STORAGE&location=`,
   `/stock?q=`.
5. Colour: provable state only, per §5. Two sources qualify and ship with it.
6. The subtree location filter on `list_stock_on_hand` is deferred.
