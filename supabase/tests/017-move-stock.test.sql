-- app.move_stock — the primitive every part of the flow will route through.
--
-- Two things are proved here that nothing else can prove later: that it refuses an id
-- belonging to another property, and that it refuses to take more than exists. Both are
-- invisible from the callers, and both are the failures that end as a stock
-- discrepancy nobody can explain months afterwards.
--
-- Run as postgres, because this function is deliberately unreachable from a client —
-- `app` is not exposed to PostgREST and EXECUTE is revoked. The RPCs that wrap it are
-- what get tested as `authenticated`, and they come next.

begin;
select plan(10);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000b701', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.m@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-00000000b702', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.n@example.test', '', now(), now());

select system.provision_property('admin.m@example.test', 'Group M1', 'M1', 'Property M');
select system.provision_property('admin.n@example.test', 'Group N1', 'N1', 'Property N');

create temporary table ctx as
select
  (select id from public.property where code = 'M1')                                  as prop,
  (select id from public.property where code = 'N1')                                  as other,
  (select c.id from public.item_category c join public.property p on p.id = c.property_id
     where p.code = 'M1' and c.code = 'DAIRY')                                        as cat,
  (select u.id from public.uom u join public.property p on p.id = u.property_id
     where p.code = 'M1' and u.code = 'L')                                            as uom,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'M1' and l.code = 'M1-CHILL')                                     as chill,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'M1' and l.code = 'M1-DRY')                                       as dry,
  (select l.id from public.location l join public.property p on p.id = l.property_id
     where p.code = 'N1' and l.code = 'N1-CHILL')                                     as other_chill;

insert into public.item (id, property_id, code, name, category_id, base_uom_id)
select '00000000-0000-0000-0000-0000000b7001', prop, 'MILK', 'Toned Milk', cat, uom from ctx;

insert into public.batch (id, property_id, item_id, batch_no, source)
select '00000000-0000-0000-0000-0000000b7002', prop, '00000000-0000-0000-0000-0000000b7001',
       'OPEN-M', 'OPENING_STOCK' from ctx;

-- ---------------------------------------------------------------------------
-- Moving stock in, then around
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select app.move_stock(
       (select prop from ctx), '00000000-0000-0000-0000-0000000b7002',
       '00000000-0000-0000-0000-0000000b7001',
       null, null, (select chill from ctx), 'AVAILABLE',
       50, (select uom from ctx), 'OPENING_STOCK', 'm-open-1') $$,
  'stock can be brought in'
);

select is(
  (select qty from public.stock_lot
    where batch_id = '00000000-0000-0000-0000-0000000b7002' and state = 'AVAILABLE'),
  50::numeric(14, 4),
  'and the projection follows'
);

select lives_ok(
  $$ select app.move_stock(
       (select prop from ctx), '00000000-0000-0000-0000-0000000b7002',
       '00000000-0000-0000-0000-0000000b7001',
       (select chill from ctx), 'AVAILABLE', (select dry from ctx), 'AVAILABLE',
       20, (select uom from ctx), 'ZONE_TRANSFER', 'm-move-1') $$,
  'and moved somewhere else'
);

select is(
  (select qty from public.stock_lot
    where batch_id = '00000000-0000-0000-0000-0000000b7002'
      and location_id = (select chill from ctx)),
  30::numeric(14, 4),
  'leaving the right amount behind'
);

-- ---------------------------------------------------------------------------
-- Sufficiency
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select app.move_stock(
       (select prop from ctx), '00000000-0000-0000-0000-0000000b7002',
       '00000000-0000-0000-0000-0000000b7001',
       (select chill from ctx), 'AVAILABLE', null, 'ISSUED',
       999, (select uom from ctx), 'ISSUE', 'm-over-1') $$,
  '23514',
  null,
  'more than exists is refused'
);

-- The message is the point: a constraint name tells a storekeeper nothing, and the
-- constraint on stock_lot is only a backstop for this same condition.
select throws_like(
  $$ select app.move_stock(
       (select prop from ctx), '00000000-0000-0000-0000-0000000b7002',
       '00000000-0000-0000-0000-0000000b7001',
       (select chill from ctx), 'AVAILABLE', null, 'ISSUED',
       999, (select uom from ctx), 'ISSUE', 'm-over-2') $$,
  '%Only 30 available on M1-CHILL%',
  'and says how much there is and where'
);

select throws_ok(
  $$ select app.move_stock(
       (select prop from ctx), '00000000-0000-0000-0000-0000000b7002',
       '00000000-0000-0000-0000-0000000b7001',
       (select dry from ctx), 'ISSUED', null, 'AVAILABLE',
       1, (select uom from ctx), 'RETURN_TO_STORE', 'm-none-1') $$,
  '23514',
  null,
  'and taking from a lot that does not exist is refused rather than invented at minus one'
);

select throws_ok(
  $$ select app.move_stock(
       (select prop from ctx), '00000000-0000-0000-0000-0000000b7002',
       '00000000-0000-0000-0000-0000000b7001',
       null, null, (select chill from ctx), 'AVAILABLE',
       0, (select uom from ctx), 'OPENING_STOCK', 'm-zero-1') $$,
  '23514',
  null,
  'a movement of nothing is not a movement'
);

-- ---------------------------------------------------------------------------
-- Property boundaries, which RLS is not there to enforce inside a definer function
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select app.move_stock(
       (select prop from ctx), '00000000-0000-0000-0000-0000000b7002',
       '00000000-0000-0000-0000-0000000b7001',
       null, null, (select other_chill from ctx), 'AVAILABLE',
       1, (select uom from ctx), 'OPENING_STOCK', 'm-cross-1') $$,
  '42501',
  null,
  'a destination at another property is refused'
);

select is(
  (select count(*)::int from public.stock_movement
    where idempotency_key in ('m-over-1', 'm-over-2', 'm-none-1', 'm-zero-1', 'm-cross-1')),
  0,
  'and not one of the refused attempts left a movement behind'
);

select * from finish();
rollback;
