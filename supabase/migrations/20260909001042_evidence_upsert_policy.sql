-- ---------------------------------------------------------------------------
-- Re-uploading the same photograph has to be allowed.
-- ---------------------------------------------------------------------------
--
-- The vault's storage policies granted SELECT and INSERT and nothing else. `upsert: true`
-- needs UPDATE, so the *second* upload of a given object was refused:
--
--   403 "new row violates row-level security policy"
--
-- Which is the one case content addressing exists to make safe. The key is the SHA-256 of
-- the bytes, so an upload interrupted and retried lands on the same key by design — and
-- that retry was the exact operation the policies forbade. A gate device on a flapping
-- connection would have failed on its second attempt at the same photograph, having
-- succeeded on the first.
--
-- Found against production, not in CI, and the reason is worth recording: CI replays onto
-- a fresh stack every run and therefore never uploads the same object twice. A test that
-- starts empty cannot see a conflict that only exists on the second write.
--
-- The predicate is the same as the other two: the first path segment is the property, and
-- a member may act inside their own prefix and nowhere else. Both USING and WITH CHECK,
-- so an update can neither read nor write its way outside the property it belongs to.

drop policy if exists evidence_update on storage.objects;
create policy evidence_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'evidence'
    and (storage.foldername(name))[1]::uuid in (select app.accessible_properties())
  )
  with check (
    bucket_id = 'evidence'
    and (storage.foldername(name))[1]::uuid in (select app.accessible_properties())
  );

-- Deliberately no DELETE policy. Nothing removes evidence today: retention is recorded as
-- a date and the sweep is unwritten, because it has to consider what the registers still
-- reference. When it is written it will run as a job with its own authority, not as a
-- client holding a session.
