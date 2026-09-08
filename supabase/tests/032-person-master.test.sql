-- The staff master — PRD section 4 Gate 8, criteria 17 and 19.
--
-- Two things carry this file.
--
-- The first is the shared vectors. The Damm check digit is implemented twice — here in
-- SQL because only the server holds the sequence, and in packages/domain because a
-- device at the dock validates a scan with no network. A rule written twice needs both
-- copies tested against the same inputs, or the day they diverge is the day a
-- storekeeper meets a card the server minted and the app refuses. The vectors below are
-- the same ones asserted in person-code.test.ts.
--
-- The second is deactivation. Criterion 19 says a stopped card stops working
-- immediately, server-side. The test for that is not "the flag is false" — it is that
-- the flag is unreachable from a client, so nobody can set it back by writing the row.
--
-- Run as `authenticated` throughout, per the repo rule.

begin;
select plan(24);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000fd01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner.pa@person.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000fd02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.pa@person.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000fd03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner.pb@person.test', '', now(), now());

select system.provision_property('owner.pa@person.test', 'Group PA', 'PA', 'People A');
select system.provision_property('owner.pb@person.test', 'Group PB', 'PB', 'People B');
select system.grant_property_role('store.pa@person.test', 'PA', 'STOREKEEPER');

create temporary table ctx as
select
  (select id from public.property where code = 'PA') as prop,
  (select id from public.property where code = 'PB') as other;

-- ---------------------------------------------------------------------------
-- The check digit, against the vectors packages/domain also asserts
-- ---------------------------------------------------------------------------

select is(app.damm_check_digit('0001'), 3, 'vector 0001');
select is(app.damm_check_digit('0042'), 7, 'vector 0042');
select is(app.damm_check_digit('0427'), 0, 'vector 0427');
select is(app.damm_check_digit('9999'), 2, 'vector 9999');

select is(
  app.damm_check_digit('0001' || app.damm_check_digit('0001')::text),
  0,
  'a run carrying its own check digit validates to zero'
);

select throws_ok(
  $q$ select app.damm_check_digit('12a4') $q$,
  '22023',
  null,
  'a run that is not digits is refused rather than silently coerced'
);

-- ---------------------------------------------------------------------------
-- Minting cards
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000fd01"}', true);

select lives_ok(
  $q$ select public.create_person((select prop from ctx), 'Ranjit Gogoi') $q$,
  'an owner can add somebody to the staff master'
);

select is(
  (select person_code from public.person where full_name = 'Ranjit Gogoi'),
  'PA-EMP-00013',
  'the first card is the property code, the series, one, and its check digit'
);

select lives_ok(
  $q$ select public.create_person((select prop from ctx), 'Bhaskar Das') $q$,
  'a second person'
);

select is(
  (select person_code from public.person where full_name = 'Bhaskar Das'),
  'PA-EMP-00021',
  'the sequence advances and the check digit follows it'
);

select is(
  (select count(*)::integer from public.person where property_id = (select prop from ctx)),
  2,
  'both are on this property''s master'
);

select throws_ok(
  $q$ select public.create_person((select prop from ctx), '   ') $q$,
  '23514',
  null,
  'a card needs a name on it'
);

-- ---------------------------------------------------------------------------
-- Who may add, and to whose property
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000fd02"}', true);

select throws_ok(
  $q$ select public.create_person((select prop from ctx), 'Storekeeper''s Friend') $q$,
  '42501',
  null,
  'a storekeeper cannot add people — the staff master is master data'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000fd03"}', true);

select throws_ok(
  $q$ select public.create_person((select prop from ctx), 'Somebody Else''s Staff') $q$,
  '42501',
  null,
  'an owner of another property cannot add people here'
);

select is(
  (select count(*)::integer from public.person),
  0,
  'and that other owner cannot even see this property''s master'
);

-- ---------------------------------------------------------------------------
-- Deactivation — criterion 19
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000fd01"}', true);

select throws_ok(
  $q$
    select public.set_person_active(
      (select prop from ctx),
      (select id from public.person where full_name = 'Bhaskar Das'),
      false,
      null)
  $q$,
  '23514',
  null,
  'a revocation with no reason is refused, because it could never be reviewed'
);

select lives_ok(
  $q$
    select public.set_person_active(
      (select prop from ctx),
      (select id from public.person where full_name = 'Bhaskar Das'),
      false,
      'Left the property')
  $q$,
  'an owner can stop a card'
);

select is(
  (select is_active from public.person where full_name = 'Bhaskar Das'),
  false,
  'the card is stopped'
);

select isnt(
  (select deactivated_at from public.person where full_name = 'Bhaskar Das'),
  null,
  'and the stop is dated, so it can be audited'
);

select is(
  (select count(*)::integer from public.person where property_id = (select prop from ctx)),
  2,
  'the person is still on the master — accountability is not deleted with the card'
);

/*
  The part that makes criterion 19 a control rather than a flag.

  If a client could write the row, "stopped immediately, server-side" would be a
  suggestion: anyone holding the stopped card's session could set it back. The table
  carries SELECT and nothing else, so the only way in is the function above, which
  checks the role.
*/
select throws_ok(
  $q$
    update public.person set is_active = true
     where full_name = 'Bhaskar Das'
  $q$,
  '42501',
  null,
  'no client can turn a stopped card back on by writing the row'
);

select throws_ok(
  $q$ insert into public.person (property_id, person_code, person_seq, full_name)
      values ((select prop from ctx), 'PA-EMP-99999', 9999, 'Forged Card') $q$,
  '42501',
  null,
  'nor mint a card by writing the row'
);

-- ---------------------------------------------------------------------------
-- Reading the master
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from public.list_people((select prop from ctx))),
  2,
  'the cached master includes stopped cards, so a revoked one reads as stopped not unknown'
);

select is(
  (select is_active from public.list_people((select prop from ctx)) where full_name = 'Bhaskar Das'),
  false,
  'and says which are stopped'
);

select * from finish();
rollback;
