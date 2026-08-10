# 0002 — Organisation → Property; the property is the data boundary

**Status:** Accepted
**Date:** 2026-08-10

## Context

Hotels are frequently owned in groups. The PRD assumes this: `DispatchNote.recipient_type` includes `SISTER_PROPERTY`, and §6 lists inter-property transfer as a category of outbound movement. A flat "one customer = one property" model cannot express that, and adding a group layer later means re-keying every user and subscription.

But the opposite mistake is worse. If the group were the tenant boundary, a storekeeper at Tinsukia would see a sister property's stock, because RLS would be scoped to `org_id`.

## Decision

```
organisation   billing, subscription, plan, DPA
  └── property ★ the data boundary
        └── locations
```

**The tenant key on every domain table is `property_id`, never `org_id`.** Group-level people — a group GM, a group auditor — get their breadth from additional `membership` rows, one per property they may see, or a row with `property_id IS NULL` meaning org-wide.

Cross-property movement never produces a row owned by two properties. A sister-property transfer is a `DispatchNote` in property A, a `GateEntry` in property B, and an `inter_property_link` row that both may read. Two records, two boundaries, one explicit bridge.

A single independent hotel is an organisation of one. There is no special case.

## Consequences

- **Never widen the RLS predicate to grant group access.** Widening the predicate is how one property's data ends up visible in another. Access breadth comes from membership rows; the predicate stays narrow.
- `membership` is queried on every request, so it is wrapped in a `STABLE SECURITY DEFINER` function (`auth.accessible_properties()`) — evaluated once per statement, not per row, and avoiding recursive RLS on `membership` itself.
- `property_id` leads every index.
- Billing, plans and the DPA attach to the organisation; operational data never does.
- Any future flow that appears to need a row spanning two properties is a design error. Add a bridge, not a nullable second tenant column.
