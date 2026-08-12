-- Demo data — a store with something in it.
--
-- `system.provision_property` gives a new property its units, categories and locations
-- and nothing else, which is correct: the item master is the property's own. But it
-- means the three screens worth showing — the item master, opening stock and the expiry
-- watchlist — all render a single grey empty-state box until something is in them.
-- An empty app demonstrates nothing.
--
-- This seeds a store that reads like an actual hotel in Tinsukia: rohu and hilsa by the
-- kilo, eggs by the peti, rice and onions by the bora, a nineteen-kilo LPG cylinder.
--
-- ---------------------------------------------------------------------------
-- Run this by hand in the Supabase SQL editor. It is NOT a migration.
-- ---------------------------------------------------------------------------
--
-- It lives in supabase/seed/ rather than supabase/migrations/ precisely so CI never
-- applies it. Demo data reaching production automatically is how a real store ends up
-- with somebody's test rice in it.
--
-- BEFORE RUNNING: create the demo login first, or the first statement raises.
--   Supabase dashboard -> Authentication -> Users -> Add user
--   Email: demo@golai.in   (change it below if you use another)
--   Password: whatever you will type in front of the MD
--   *** Tick "Auto Confirm User" *** — without it the sign-in screen rejects the
--   login and the message blames the credentials rather than the confirmation.
--
-- WHY A SEPARATE PROPERTY: this creates `SBD`, not `SB`. The MD sees their own hotel's
-- name, and the real property stays clean — so none of this has to be unpicked on the
-- day the property starts entering its actual items and counting its actual stock.
--
-- Every statement is idempotent. Running it twice changes nothing. Dates are relative
-- to `current_date`, so the watchlist looks correct whenever it is run rather than
-- going stale the day after it was written.
--
-- Removal is at the bottom of this file.

-- ---------------------------------------------------------------------------
-- 1. The property
-- ---------------------------------------------------------------------------
-- Same organisation as the real property, so it groups correctly. Different code, so
-- it is a different property.

select system.provision_property(
  'demo@golai.in',
  'Voyage Hotels & Resorts',
  'SBD',
  'Voyage The Solitaire Bliss'
);

-- ---------------------------------------------------------------------------
-- 2. The item master
-- ---------------------------------------------------------------------------
-- Categories and units are joined by code rather than by id, so this script needs no
-- ids pasted into it and cannot pick up another property's masters — the composite
-- foreign keys would refuse that anyway.
--
-- `is_batch_controlled` is derived from `is_perishable` rather than stated separately,
-- because the schema requires it: expiry attaches to a batch and has nowhere else to
-- live.

insert into public.item (
  property_id, code, name, category_id, base_uom_id,
  is_perishable, is_cold_chain, is_batch_controlled,
  shelf_life_days, storage_regime, temp_min_c, temp_max_c
)
select
  p.id, v.code, v.name, c.id, u.id,
  v.perishable, v.cold, v.perishable,
  v.shelf_life, v.regime::public.storage_regime, v.tmin, v.tmax
from public.property p
cross join (values
  -- code,        name,                        cat,          uom,    perish, cold,  days, regime,    tmin,  tmax
  ('MILK-1L',    'Toned milk 1 L',            'DAIRY',      'L',    true,  true,     5, 'CHILLED',  0.0,   4.0),
  ('PANEER',     'Paneer',                    'DAIRY',      'KG',   true,  true,     4, 'CHILLED',  0.0,   4.0),
  ('BUTTER',     'Butter, salted',            'DAIRY',      'KG',   true,  true,    60, 'CHILLED',  0.0,   4.0),
  ('CURD',       'Curd',                      'DAIRY',      'KG',   true,  true,     5, 'CHILLED',  0.0,   4.0),
  ('CHEESE-SL',  'Cheese slices',             'DAIRY',      'PC',   true,  true,    45, 'CHILLED',  0.0,   4.0),
  ('EGG',        'Eggs, table',               'DAIRY',      'PETI', true,  false,   21, 'AMBIENT',  null,  null),

  ('FISH-ROHU',  'Rohu, whole',               'FISH',       'KG',   true,  true,     2, 'CHILLED',  0.0,   2.0),
  ('FISH-HILSA', 'Hilsa',                     'FISH',       'KG',   true,  true,     2, 'CHILLED',  0.0,   2.0),
  ('PRAWN',      'Prawns, medium',            'FISH',       'KG',   true,  true,     2, 'CHILLED',  0.0,   2.0),

  ('CHK-BRL',    'Chicken broiler, dressed',  'MEAT',       'KG',   true,  true,     3, 'CHILLED',  0.0,   4.0),
  ('MUTTON',     'Mutton, curry cut',         'MEAT',       'KG',   true,  true,     3, 'CHILLED',  0.0,   4.0),

  ('TOMATO',     'Tomato',                    'PRODUCE',    'KG',   true,  false,    7, 'AMBIENT',  null,  null),
  ('ONION',      'Onion',                     'PRODUCE',    'BORA', false, false, null, 'AMBIENT',  null,  null),
  ('POTATO',     'Potato',                    'PRODUCE',    'BORA', false, false, null, 'AMBIENT',  null,  null),
  ('CORIANDER',  'Coriander leaves',          'PRODUCE',    'KG',   true,  true,     3, 'CHILLED',  0.0,   4.0),
  ('CHILLI-G',   'Green chilli',              'PRODUCE',    'KG',   true,  false,    7, 'AMBIENT',  null,  null),
  ('LEMON',      'Lemon',                     'PRODUCE',    'KG',   true,  false,   10, 'AMBIENT',  null,  null),

  ('RICE-BAS',   'Basmati rice',              'PROVISIONS', 'BORA', false, false, null, 'AMBIENT',  null,  null),
  ('DAL-TOOR',   'Toor dal',                  'PROVISIONS', 'KG',   false, false, null, 'AMBIENT',  null,  null),
  ('OIL-REF',    'Refined sunflower oil 15 L','PROVISIONS', 'TIN',  true,  false,  365, 'AMBIENT',  null,  null),
  ('SUGAR',      'Sugar',                     'PROVISIONS', 'KG',   false, false, null, 'AMBIENT',  null,  null),
  ('SALT',       'Iodised salt',              'PROVISIONS', 'KG',   false, false, null, 'AMBIENT',  null,  null),
  ('ATTA',       'Wheat atta',                'PROVISIONS', 'BORA', true,  false,   90, 'AMBIENT',  null,  null),

  ('BREAD',      'Sandwich bread',            'BAKERY',     'PC',   true,  false,    4, 'AMBIENT',  null,  null),
  ('BUN-BRG',    'Burger buns',               'BAKERY',     'PC',   true,  false,    4, 'AMBIENT',  null,  null),

  ('KETCHUP',    'Tomato ketchup 1 kg',       'PACKAGED',   'PC',   true,  false,  540, 'AMBIENT',  null,  null),
  ('PINE-TIN',   'Pineapple slices, tinned',  'PACKAGED',   'TIN',  true,  false,  730, 'AMBIENT',  null,  null),

  ('PEAS-FRZ',   'Green peas, frozen',        'FROZEN',     'KG',   true,  true,   180, 'FROZEN',  -22.0, -18.0),
  ('FRIES-FRZ',  'French fries, frozen',      'FROZEN',     'KG',   true,  true,   365, 'FROZEN',  -22.0, -18.0),

  ('WATER-1L',   'Packaged water 1 L',        'BEVERAGE',   'PC',   true,  false,  180, 'AMBIENT',  null,  null),
  ('TEA-ASSAM',  'Assam CTC tea',             'BEVERAGE',   'KG',   false, false, null, 'AMBIENT',  null,  null),

  ('BEER-650',   'Beer 650 ml',               'BAR',        'PC',   true,  false,  180, 'AMBIENT',  null,  null),

  ('FLR-CLN',    'Floor cleaner',             'CHEMICAL',   'L',    false, false, null, 'AMBIENT',  null,  null),
  ('TOWEL-BT',   'Bath towel',                'LINEN',      'PC',   false, false, null, 'AMBIENT',  null,  null),
  ('LPG-19',     'LPG cylinder 19 kg',        'ENGSPARE',   'CYL',  false, false, null, 'AMBIENT',  null,  null)
) as v(code, name, cat_code, uom_code, perishable, cold, shelf_life, regime, tmin, tmax)
join public.item_category c on c.property_id = p.id and c.code = v.cat_code
join public.uom u on u.property_id = p.id and u.code = v.uom_code
where p.code = 'SBD'
on conflict (property_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. What is physically in the store
-- ---------------------------------------------------------------------------
-- The expiry offsets are the point of this whole file. They are chosen so all four
-- watchlist buckets have something in them — three already expired, three inside two
-- days, five inside the week, the rest ahead. Without an expired batch there is
-- nothing to write off, and the write-off is the strongest thirty seconds of the demo.
--
-- One temporary table rather than repeating the list, because batches and movements
-- both need it and two copies would drift.

-- Dropped and recreated rather than declared `on commit drop`, because the SQL editor
-- does not guarantee that the whole script runs inside one transaction — and if it does
-- not, an `on commit drop` table disappears between this statement and the two that
-- need it.
drop table if exists demo_stock;

create temporary table demo_stock (
  item_code text,
  batch_no  text,
  expires_in_days integer,   -- null for anything that does not expire
  qty       numeric(14, 4),
  loc       text             -- suffix; the property code is prepended
);

insert into demo_stock values
  -- Expired. Sitting in the cold room right now, which is exactly the point.
  ('FISH-ROHU', 'OPEN-7K2M4',  -1,  18, '-CHILL'),
  ('CURD',      'OPEN-3P8N1',  -2,  15, '-CHILL'),
  ('BREAD',     'OPEN-9Q4R7',  -1,  40, '-DRY'),

  -- Use today
  ('FISH-HILSA','OPEN-2T6V3',   1,   6, '-CHILL'),
  ('PANEER',    'OPEN-8W5X9',   2,   8, '-CHILL'),
  ('CORIANDER', 'OPEN-4Y1Z6',   1,   3, '-CHILL'),

  -- Use this week
  ('MILK-1L',   'OPEN-5A3B8',   4,  60, '-CHILL'),
  ('CHK-BRL',   'OPEN-1C7D2',   3,  25, '-CHILL'),
  ('PRAWN',     'OPEN-6E9F4',   5,   9, '-CHILL'),
  ('MUTTON',    'OPEN-3G2H7',   6,  14, '-CHILL'),
  ('BUN-BRG',   'OPEN-8J5K1',   3,  60, '-DRY'),

  -- Fresh, dated
  ('BUTTER',    'OPEN-2L6M9',  40,  12, '-CHILL'),
  ('CHEESE-SL', 'OPEN-7N4P3',  25, 200, '-CHILL'),
  ('EGG',       'OPEN-9R1S5',  16,  12, '-CHILL'),
  ('TOMATO',    'OPEN-4T8U2',   9,  40, '-DRY'),
  ('PEAS-FRZ',  'OPEN-6V3W7',  150, 20, '-FREEZE'),
  ('FRIES-FRZ', 'OPEN-1X9Y4',  300, 35, '-FREEZE'),
  ('OIL-REF',   'OPEN-5Z2A8',  300, 10, '-DRY'),
  ('KETCHUP',   'OPEN-3B7C1',  400, 24, '-DRY'),
  ('WATER-1L',  'OPEN-8D4E6',  120, 200,'-DRY'),

  -- No expiry. A store of nothing but perishables would look invented.
  ('RICE-BAS',  'OPEN-2F9G5', null,   8, '-DRY'),
  ('ONION',     'OPEN-7H3J8', null,   6, '-DRY'),
  ('POTATO',    'OPEN-1K6L4', null,   5, '-DRY'),
  ('SUGAR',     'OPEN-9M2N7', null,  50, '-DRY'),
  ('LPG-19',    'OPEN-4P8Q3', null,   8, '-DRY');

-- Batches. `is_system_generated` is true because this is counted opening stock with no
-- vendor batch number, which is the same thing the app writes when the field is left
-- blank — so a trace can tell these apart from a number a supplier actually supplied.
insert into public.batch (
  property_id, item_id, batch_no, is_system_generated,
  best_before, shelf_life_total_days, source
)
select
  p.id, i.id, s.batch_no, true,
  case when s.expires_in_days is null then null else current_date + s.expires_in_days end,
  i.shelf_life_days,
  'OPENING_STOCK'
from public.property p
join demo_stock s on true
join public.item i on i.property_id = p.id and i.code = s.item_code
where p.code = 'SBD'
on conflict (property_id, item_id, batch_no) do nothing;

-- Stock, through the ledger.
--
-- Never insert into stock_lot directly. It is a projection maintained by the
-- app.apply_stock_movement() trigger, and writing it by hand would make it disagree
-- with the movements it is supposed to summarise — which is the exact failure ADR 0003
-- exists to prevent, and which pgTAP 007 asserts against on every push.
insert into public.stock_movement (
  property_id, batch_id, item_id, to_location_id, to_state,
  qty, uom_id, reason, idempotency_key
)
select
  p.id, b.id, i.id, l.id, 'AVAILABLE',
  s.qty, i.base_uom_id, 'OPENING_STOCK',
  'demo-open:' || s.batch_no
from public.property p
join demo_stock s on true
join public.item i on i.property_id = p.id and i.code = s.item_code
join public.batch b on b.property_id = p.id and b.item_id = i.id and b.batch_no = s.batch_no
join public.location l on l.property_id = p.id and l.code = p.code || s.loc
where p.code = 'SBD'
on conflict (property_id, idempotency_key) do nothing;

drop table if exists demo_stock;

-- ---------------------------------------------------------------------------
-- 4. Check it
-- ---------------------------------------------------------------------------

select
  (select count(*) from public.item i
     join public.property p on p.id = i.property_id where p.code = 'SBD')       as items,
  (select count(*) from public.batch b
     join public.property p on p.id = b.property_id where p.code = 'SBD')       as batches,
  (select count(*) from public.stock_lot sl
     join public.property p on p.id = sl.property_id
    where p.code = 'SBD' and sl.qty > 0)                                        as stock_lines,
  (select count(*) from public.stock_lot sl
     join public.property p on p.id = sl.property_id
     join public.batch b on b.id = sl.batch_id
    where p.code = 'SBD' and sl.qty > 0 and b.best_before < current_date)       as expired_now;

-- Expect: 34 items, 25 batches, 25 stock lines, 3 expired.
--
-- If stock_lines is 0 but batches is 25, the movement insert was refused rather than
-- skipped — check that you are running this as the service role or in the SQL editor,
-- not as an ordinary signed-in user.

-- ---------------------------------------------------------------------------
-- To remove all of it
-- ---------------------------------------------------------------------------
-- Deleting the property cascades to memberships, masters, items, batches, movements
-- and stock lots. The organisation and the auth user survive, which is what you want —
-- the real property hangs off the same organisation.
--
--   delete from public.property where code = 'SBD';
--
-- The demo login is removed separately, in Authentication -> Users.
