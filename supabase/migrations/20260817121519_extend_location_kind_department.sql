-- A department is a place, so it is a location.
--
-- Gate 8 moves stock from a zone into ISSUED "against a department or event code" (PRD
-- section 4 Gate 8), and PRD section 4 also requires that department-held stock stays
-- visible without counting as store stock. Both fall out of modelling the department as
-- a location: stock_lot is already keyed on (batch, location, state), so issued stock is
-- simply a lot at a DEPARTMENT in state ISSUED — countable, attributable, and reversible
-- by the opposite movement when it comes back.
--
-- The alternative, a department table with a second foreign key beside to_location_id,
-- would give the ledger two ways to say where something is. That is the shape that ends
-- in a report which agrees with neither.
--
-- Alone in its own migration for the same reason as RACK and BIN: a new enum value cannot
-- be USED in the transaction that adds it, and Supabase runs each migration in one. A
-- seed row or a check constraint referencing 'DEPARTMENT' here would fail at deploy time
-- with "unsafe use of new value of enum type" — in CI, having passed review.

alter type public.location_kind add value if not exists 'DEPARTMENT' after 'DISPATCH';

comment on type public.location_kind is
  'Where a location sits in the tree and what it is for. RACK groups; BIN is the leaf that carries a scannable label and is the only lawful put-away destination (PRD section 4 Gate 6). DEPARTMENT is a consuming department, which holds issued stock without holding store stock.';
