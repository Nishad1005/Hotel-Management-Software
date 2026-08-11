-- Bring a property into existence. Run in the Supabase SQL editor.
--
-- Everything is done by system.provision_property, which lives in a migration and is
-- therefore versioned, deployed and testable. This file is only the call.
--
-- Idempotent: running it twice changes nothing. Re-run it freely.

-- ---------------------------------------------------------------------------
-- The first property
-- ---------------------------------------------------------------------------
--
-- Arguments: admin email, organisation name, property code, property name.
--
-- The user must already exist under Authentication -> Users, with "Auto Confirm
-- User" ticked — otherwise Supabase waits for an email confirmation and sign-in
-- fails without explaining why.

select system.provision_property(
  'userhms@test.com',
  'Voyage Hotels & Resorts',
  'SB',
  'Voyage The Solitaire Bliss'
);

-- ---------------------------------------------------------------------------
-- Adding more properties later
-- ---------------------------------------------------------------------------
--
-- Same organisation name puts a property in the same group, so a group GM's
-- organisation-wide membership reaches it automatically. A different organisation
-- name creates a separate customer with no visibility between them. That one
-- argument is the whole difference (ADR 0002).
--
--   -- Another property in the same group:
--   select system.provision_property(
--     'userhms@test.com', 'Voyage Hotels & Resorts', 'VD', 'Voyage Dibrugarh');
--
--   -- A resort in the same group:
--   select system.provision_property(
--     'userhms@test.com', 'Voyage Hotels & Resorts', 'VKR', 'Voyage Kaziranga Resort');
--
--   -- A completely separate customer:
--   select system.provision_property(
--     'other@example.com', 'Brahmaputra Hotels', 'BR', 'Brahmaputra Riverside');

-- ---------------------------------------------------------------------------
-- Adding people
-- ---------------------------------------------------------------------------
--
-- Create the user under Authentication -> Users first, then grant them a role.
-- Roles: OWNER, ADMIN, GM, SECURITY, STOREKEEPER, CHEF, FSO, PURCHASE, BANQUET,
-- AUDITOR.
--
-- Note that a STOREKEEPER can read the item master but not edit it. That is
-- deliberate: the master is what receiving gets checked against, so if anyone with a
-- login could change it, the rule that an item must exist before it can be received
-- would mean nothing.
--
--   select system.grant_property_role('storekeeper@example.com', 'SB', 'STOREKEEPER');
--   select system.grant_property_role('chef@example.com',        'SB', 'CHEF');

-- ---------------------------------------------------------------------------
-- Check it worked
-- ---------------------------------------------------------------------------

select p.code,
       p.name,
       p.lifecycle_state,
       o.name                                as organisation,
       (select count(*) from public.uom            u where u.property_id = p.id) as units,
       (select count(*) from public.item_category  c where c.property_id = p.id) as categories,
       (select count(*) from public.location       l where l.property_id = p.id) as locations,
       (select count(*) from public.membership     m where m.property_id = p.id) as memberships
  from public.property p
  join public.organisation o on o.id = p.org_id
 order by o.name, p.code;
