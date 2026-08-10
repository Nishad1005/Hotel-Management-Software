# 0008 — Chef acceptance is asynchronous sign-off, not a hard block

**Status:** Accepted
**Date:** 2026-08-10

## Context

§15 open question 3 asks it directly: should chef acceptance on perishables be a hard block or an asynchronous sign-off? The PRD notes the tension and does not resolve it — a hard block is correct for control but will stall the dock during service.

The stall is not hypothetical. Fresh deliveries arrive during preparation hours; the chef is on the line. A hard block means the storekeeper waits, the vehicle waits, and the dwell clock runs on chilled goods that should already be in a cold room.

Principle 2 of the PRD (§2) settles it. An unenforceable rule produces click-through, and click-through is worse than no rule — the record then carries a false assertion instead of an honest gap. A block the dock cannot honour will be worked around, most likely by the chef handing their credentials to the storekeeper, which destroys the control entirely rather than weakening it.

## Decision

Chef acceptance on perishables is **asynchronous sign-off with a timer**. Receiving proceeds; the line is posted and put away. The sign-off is a separate outstanding item against the GRN line, and unsigned lines escalate after a configured window.

Revisit at `[P2]`, when enforcement modes become adjustable from the dashboard and the property can ratchet this to `BLOCK` as a dated management decision if it finds it can honour one.

## Consequences

- Material can reach a zone and be issued before a chef has signed for its quality. That is a real weakening of control, accepted deliberately, and it must be visible: unsigned lines appear on a dashboard and escalate rather than sitting quietly.
- The sign-off carries its own timestamp, distinct from the receipt timestamp. Never backdate it to the receipt — the gap between the two is exactly what a reviewer needs to see.
- Because the rule ships with an `enforcement_mode`, moving to `BLOCK` later is configuration rather than a code change. This is why [the field exists from day one](../PRD_PAR_Golai_Material_Flow_Rev02.md) even with no UI to change it.
- Do not implement this as a blocking modal with a "skip" button. That is click-through with extra steps.
