-- Gates 9 and 10 — staging at Terminal 2, and the gate pass out.
--
-- The assertion the whole flow has been waiting for: rejected stock has a lawful exit.
-- Until this existed, a reject decision was a dead end — fifty kilos of bad fish in the
-- cage and no way to send it back — and a storekeeper facing that walks it out of a side
-- door, at which point every control upstream becomes decoration.
--
-- The second assertion is the one people will want relaxed: a gate pass cannot be
-- verified by whoever staged it. That is PRD section 11 segregation, and a pass signed by
-- the person who staged it is not a weaker control, it is the absence of one.

begin;
select plan(21);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000ab01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.dp@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000ab02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'store.dp@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000ab03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'guard.dp@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000ab04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit.dp@example.test', '', now(), now());

select system.provision_property('admin.dp@example.test', 'Group DP', 'DP', 'Property DP');
select system.grant_property_role('store.dp@example.test', 'DP', 'STOREKEEPER');
select system.grant_property_role('guard.dp@example.test', 'DP', 'SECURITY');
select system.grant_property_role('audit.dp@example.test', 'DP', 'AUDITOR');

create temporary table ctx as
select
  (select id from public.property where code = 'DP')                                  as prop,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'DP' and c.code = 'FISH')                                          as cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'DP' and u.code = 'KG')                                            as uom,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'DP' and l.code = 'DP-T1-RCV')                                     as rcv,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'DP' and l.code = 'DP-T1-REJ')                                     as rej,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'DP' and l.code = 'DP-T2-DSP')                                     as t2,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'DP' and l.code = 'DP-CHILL')                                      as chill;

grant select on ctx to authenticated;

insert into public.item (id, property_id, code, name, category_id, base_uom_id, storage_regime)
select '00000000-0000-0000-0000-0000000ab001', prop, 'ROHU', 'Rohu Fish', cat, uom, 'CHILLED' from ctx;

insert into public.party (id, property_id, code, name)
select '00000000-0000-0000-0000-0000000ab010', prop, 'DP-VEN-000001', 'Bhaskar Fish Supply' from ctx;

insert into public.gate_entry (id, property_id, gate_entry_no, party_id, bill, package_count)
select '00000000-0000-0000-0000-0000000ab020', prop, 'DP-GE-000001',
       '00000000-0000-0000-0000-0000000ab010', 'NONE', 4 from ctx;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ab02","role":"authenticated"}';

-- Received for real, so what leaves below is genuinely what a reject decision produces
-- rather than a row placed in the cage by hand.
select is(
  (select g.grn_no from public.post_grn(
     (select prop from ctx), '00000000-0000-0000-0000-0000000ab020',
     '00000000-0000-0000-0000-0000000ab010', 'dp-post-1',
     jsonb_build_array(jsonb_build_object(
       'item_id', '00000000-0000-0000-0000-0000000ab001',
       'uom_id', (select uom from ctx), 'batch_no', 'V-ROHU-1',
       'qty_physical', 50, 'qty_accepted', 0, 'qty_rejected', 50,
       'decision', 'REJECT', 'reject_reason', 'NOT_COLD_ENOUGH'))) g),
  'DP-GRN-000001',
  'a consignment is rejected outright and lands in the reject hold'
);

select is(
  (select qty from public.stock_lot
    where location_id = (select rej from ctx) and state = 'REJECT_HOLD'),
  50::numeric(14, 4),
  'fifty kilos of it, sitting in the cage with nowhere to go until now'
);

select is(
  (select array_agg(state::text order by ordinality)
     from public.list_dispatchable_stock((select prop from ctx)) with ordinality),
  array['REJECT_HOLD'],
  'and it is what the dispatch screen offers first, because the vendor is owed an answer'
);

-- ---------------------------------------------------------------------------
-- Gate 9 — staging
-- ---------------------------------------------------------------------------

select is(
  (select d.dispatch_no from public.stage_for_dispatch(
     (select prop from ctx), 'SUPPLIER_RETURN', '00000000-0000-0000-0000-0000000ab010',
     'Arrived at 11 degrees', false, null, 'dp-stage-1',
     jsonb_build_array(jsonb_build_object(
       'batch_id', (select id from public.batch where batch_no = 'V-ROHU-1'),
       'from_location_id', (select rej from ctx),
       'from_state', 'REJECT_HOLD',
       'qty', 49))) d),
  'DP-DN-000001',
  'rejected stock can be staged for return to the vendor'
);

-- The one transition out of REJECT_HOLD the ledger's own check constraint permits, which
-- is what makes dispatch the only exit rather than merely the intended one.
select is(
  (select qty from public.stock_lot
    where location_id = (select t2 from ctx) and state = 'STAGED_OUT'),
  49::numeric(14, 4),
  'it is at Terminal 2 in STAGED_OUT'
);

-- One kilo held back, because a part return is ordinary — the vendor collects what fits
-- in today's vehicle — and the remainder has to stay countable in the cage.
select is(
  (select qty from public.stock_lot
    where location_id = (select rej from ctx) and state = 'REJECT_HOLD'),
  1::numeric(14, 4),
  'and what was not staged is still in the cage, still rejected'
);

-- Staged is not gone. Still on the property, still counted, still the property's problem.
select is(
  (select count(*)::int from public.list_awaiting_gate_pass((select prop from ctx))),
  1,
  'the dispatch note is waiting for a gate pass — staging is not leaving'
);

-- ---------------------------------------------------------------------------
-- Gate 10 — and who may issue it
-- ---------------------------------------------------------------------------

select throws_like(
  $q$ select * from public.issue_gate_pass(
        (select prop from ctx),
        (select id from public.dispatch_note where dispatch_no = 'DP-DN-000001'),
        'Ramen Das', 'AS-23-C-4471', 4, 'dp-pass-storekeeper') $q$,
  '%Passing goods out of the gate is Security%',
  'a storekeeper cannot pass goods out of the gate'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ab04","role":"authenticated"}';

select throws_ok(
  $q$ select * from public.issue_gate_pass(
        (select prop from ctx),
        (select id from public.dispatch_note where dispatch_no = 'DP-DN-000001'),
        'Ramen Das', 'AS-23-C-4471', 4, 'dp-pass-auditor') $q$,
  '42501',
  null,
  'nor an auditor'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ab03","role":"authenticated"}';

select throws_like(
  $q$ select * from public.issue_gate_pass(
        (select prop from ctx),
        (select id from public.dispatch_note where dispatch_no = 'DP-DN-000001'),
        '   ', 'AS-23-C-4471', 4, 'dp-pass-nobody') $q$,
  '%Nothing leaves in nobody''s hands%',
  'and nothing leaves without a named carrier, whoever is at the gate'
);

select is(
  (select g.gate_pass_no from public.issue_gate_pass(
     (select prop from ctx),
     (select id from public.dispatch_note where dispatch_no = 'DP-DN-000001'),
     'Ramen Das', 'AS-23-C-4471', 4, 'dp-pass-1') g),
  'DP-GP-000001',
  'Security passes it out, and the gate pass carries the property''s own number'
);

select is(
  (select coalesce(sum(qty), 0)::numeric(14, 4) from public.stock_lot
    where property_id = (select prop from ctx) and qty > 0),
  1::numeric(14, 4),
  'the forty-nine kilos are off the property — only the kilo held back is still here'
);

select is(
  (select reason::text from public.stock_movement
    where idempotency_key = 'dp-pass-1:out:1'),
  'GATE_OUT',
  'and the departure is recorded as leaving rather than as staging for it'
);

-- Custody changed hands at the gate exactly as it does at Gate 8, and it is recorded the
-- same way — including what it does not claim.
select is(
  (select receiver_name || '/' || verified_by_scan::text from public.receipt_ack
     join public.dispatch_note d on d.id = receipt_ack.dispatch_note_id
    where d.dispatch_no = 'DP-DN-000001'),
  'Ramen Das/false',
  'the carrier acknowledged it, and the record does not claim a card was scanned'
);

select is(
  (select count(*)::int from public.list_awaiting_gate_pass((select prop from ctx))),
  0,
  'and the dispatch note has left the outbound worklist'
);

select throws_like(
  $q$ select * from public.issue_gate_pass(
        (select prop from ctx),
        (select id from public.dispatch_note where dispatch_no = 'DP-DN-000001'),
        'Somebody Else', null, 1, 'dp-pass-2') $q$,
  '%It cannot leave twice%',
  'a second gate pass for the same dispatch is refused'
);

select is(
  (select g.gate_pass_no from public.issue_gate_pass(
     (select prop from ctx),
     (select id from public.dispatch_note where dispatch_no = 'DP-DN-000001'),
     'Ramen Das', 'AS-23-C-4471', 4, 'dp-pass-1') g),
  'DP-GP-000001',
  'though a replay of the original submission returns the original pass'
);

-- ---------------------------------------------------------------------------
-- Segregation — the control people will ask to have relaxed
-- ---------------------------------------------------------------------------
--
-- The guard stages this one themselves, then tries to verify their own consignment out.

select is(
  (select d.dispatch_no from public.stage_for_dispatch(
     (select prop from ctx), 'EMPTIES', null, 'Crates back to the vendor', false, null,
     'dp-stage-2',
     jsonb_build_array(jsonb_build_object(
       'batch_id', (select id from public.batch where batch_no = 'V-ROHU-1'),
       'from_location_id', (select rej from ctx), 'from_state', 'REJECT_HOLD', 'qty', 1))) d),
  'DP-DN-000002',
  'anyone with dispatch authority can stage, including Security'
);

select throws_like(
  $q$ select * from public.issue_gate_pass(
        (select prop from ctx),
        (select id from public.dispatch_note where dispatch_no = 'DP-DN-000002'),
        'Ramen Das', null, 1, 'dp-pass-3') $q$,
  '%Someone else has to verify it out%',
  'but not verify their own consignment out — that separation is the whole point of the gate'
);

-- ---------------------------------------------------------------------------
-- Property boundaries and the ledger
-- ---------------------------------------------------------------------------

select throws_ok(
  $q$ select * from public.stage_for_dispatch(
        (select prop from ctx), 'SUPPLIER_RETURN', gen_random_uuid(), null, false, null,
        'dp-cross-1',
        jsonb_build_array(jsonb_build_object(
          'batch_id', (select id from public.batch where batch_no = 'V-ROHU-1'),
          'from_location_id', (select rej from ctx), 'from_state', 'REJECT_HOLD', 'qty', 1))) $q$,
  '42501',
  null,
  'a recipient that is not this property''s is refused'
);

select is_empty(
  $q$
    with replay as (
      select batch_id, location_id, state, sum(delta) as qty from (
        select batch_id, from_location_id as location_id, from_state as state, -qty as delta
          from public.stock_movement
         where from_location_id is not null and from_state is not null
        union all
        select batch_id, to_location_id, to_state, qty
          from public.stock_movement
         where to_location_id is not null and to_state is not null
      ) parts
      group by batch_id, location_id, state
    )
    select coalesce(r.batch_id, l.batch_id)::text
      from replay r
      full outer join public.stock_lot l
        on l.batch_id = r.batch_id and l.location_id = r.location_id and l.state = r.state
     where coalesce(r.qty, 0) <> coalesce(l.qty, 0)
  $q$,
  'and stock_lot still equals a full replay of the ledger, with stock that has left counted as gone'
);

reset role;
select * from finish();
rollback;
