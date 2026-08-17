-- Leaving the property is not staging for it.
--
-- Gate 9 moves stock to STAGED_OUT at Terminal 2: still on the property, still counted,
-- still the property's problem. Gate 10 takes it off. Recording both as DISPATCH_STAGING
-- would leave the ledger unable to answer "what actually left this week" without
-- inferring it from a null destination — and an inference is what a report gets wrong.
--
-- Alone in its own migration for the reason RACK, BIN and DEPARTMENT each got one: a new
-- enum value cannot be USED in the transaction that adds it, and Supabase runs each
-- migration in one. Referencing 'GATE_OUT' in the same file would fail at deploy time
-- with "unsafe use of new value of enum type" — in CI, having passed review.

alter type public.movement_reason add value if not exists 'GATE_OUT' after 'DISPATCH_STAGING';

comment on type public.movement_reason is
  'Why stock moved. DISPATCH_STAGING is the move to Terminal 2; GATE_OUT is the departure itself, which is the movement with no destination because there is nowhere on the property left to name.';
