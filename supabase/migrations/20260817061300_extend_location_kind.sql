-- The location tree stopped at ZONE, and the PRD's codes have four levels.
--
-- `SB-{store}-{zone}-{rack}-{shelf}` — the leaf is where stock actually sits and where
-- the label goes. Without a kind for it, nothing can express the rule that matters
-- most: **only a bin may be a put-away destination**. That is hard rule 13, and until
-- there is a value to check against, `put_away` has nothing to refuse.
--
-- ---------------------------------------------------------------------------
-- Why this is a migration of its own
-- ---------------------------------------------------------------------------
--
-- A new enum value cannot be USED in the same transaction that adds it. Supabase runs
-- each migration in a transaction, so adding 'BIN' and then writing a check constraint
-- or a seed row referencing 'BIN' in one file fails at deploy time with
-- "unsafe use of new value of enum type" — and it fails in CI, having passed review,
-- which is the expensive way to learn it.
--
-- So the values land alone here, and everything that uses them lands next.

alter type public.location_kind add value if not exists 'RACK' after 'ZONE';
alter type public.location_kind add value if not exists 'BIN' after 'RACK';

comment on type public.location_kind is
  'Where a location sits in the tree and what it is for. RACK groups; BIN is the leaf that carries a scannable label and is the only lawful put-away destination (PRD section 4 Gate 6).';
