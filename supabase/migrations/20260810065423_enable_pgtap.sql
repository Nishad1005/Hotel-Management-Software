-- pgTAP, for the database test suite in supabase/tests.
--
-- Enabled as a migration rather than inside the test files so that preview branches
-- and CI both get it from the ordinary migration replay. It installs functions only
-- and adds no tables, policies or data.

create extension if not exists pgtap with schema extensions;
