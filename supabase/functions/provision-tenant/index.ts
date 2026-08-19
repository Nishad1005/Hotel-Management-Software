// Golai — provision-tenant
//
// Onboards a customer from the vendor console: a login for their owner, an organisation,
// a property, and the seed masters that let it work on the first morning.
//
// This exists because the alternative is a person opening the Supabase SQL editor against
// the production database for every new customer. That is fine for tenant one and a
// liability by tenant five — it needs production credentials in somebody's hands, keeps no
// record of who onboarded whom, and the one time it happens at seven in the evening the
// property code has a typo in it that is printed onto every sticker in the store.
//
// Same shape as create-user, and for the same reason: minting a login needs the
// service-role key, and that key must never reach a browser (CLAUDE.md rule 3). What this
// function does NOT do is decide whether the caller is allowed — it asks the database, as
// the caller, so there is one answer to that question rather than two that drift.
//
// Deploy: supabase functions deploy provision-tenant

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Readable aloud, which is the entire requirement.
 *
 * Handed over the phone or across a table, so the alphabet excludes every character that
 * is ambiguous when spoken or written in a hurry: O and 0, I and l and 1.
 *
 * A deliberate duplicate of the same function in create-user. Deno cannot import from the
 * workspace, and one shared copy would mean a package neither function can reach.
 */
function tempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return "Golai-" + Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function normalisePhone(input: string): string | null {
  const trimmed = (input ?? "").trim();
  if (!trimmed || /[a-zA-Z@]/.test(trimmed)) return null;

  const explicit = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (explicit) return digits.length >= 8 && digits.length <= 15 ? "+" + digits : null;
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) return "+91" + digits;
  if (digits.length === 12 && digits.startsWith("91")) return "+" + digits;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { org_name, property_code, property_name, owner_name, owner_email, owner_phone } =
      await req.json();

    if (!org_name?.trim()) return json({ error: "The customer needs a name" }, 400);
    if (!property_name?.trim()) return json({ error: "The property needs a name" }, 400);
    if (!owner_name?.trim()) return json({ error: "The owner needs a name" }, 400);

    const code = (property_code ?? "").trim().toUpperCase();
    // Checked here and again in the database. Here so the caller is told before a login is
    // created; there because the database is the side that must not be wrong.
    if (!/^[A-Z][A-Z0-9]{1,7}$/.test(code)) {
      return json(
        { error: "A property code starts with a letter and is two to eight letters or digits" },
        400,
      );
    }

    // 1. Authority, asked of the database as the CALLER.
    //
    // This function holds the service-role key and could do anything, which is exactly why
    // it must not decide this for itself.
    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });

    const { data: caller } = await asCaller.auth.getUser();
    if (!caller.user) return json({ error: "Not signed in" }, 401);

    const { data: permitted, error: permissionError } = await asCaller.rpc("am_i_platform_admin");

    if (permissionError) return json({ error: permissionError.message }, 400);
    if (permitted !== true) {
      return json({ error: "Only a platform administrator can onboard a customer" }, 403);
    }

    // 2. An identifier for the owner. Either is fine; neither is not.
    const cleanEmail = (owner_email ?? "").trim() || null;
    const cleanPhone = owner_phone?.trim() ? normalisePhone(owner_phone) : null;

    if (owner_phone?.trim() && !cleanPhone) {
      return json(
        { error: "Enter a valid mobile number — ten digits, or with the country code" },
        400,
      );
    }
    if (!cleanEmail && !cleanPhone) {
      return json({ error: "The owner needs an email address or a mobile number" }, 400);
    }

    const admin = createClient(url, serviceKey);

    // 3. The owner's login.
    //
    // Reused where one already exists, rather than refused. A group opening its second
    // hotel has the same owner, and telling somebody "that email is taken" when the
    // correct action is to add them to another property is the kind of error that gets
    // worked around by inventing an address.
    let ownerId: string | null = null;
    let secret: string | null = null;

    const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const match = existing?.users?.find(
      (u) =>
        (cleanEmail && u.email?.toLowerCase() === cleanEmail.toLowerCase()) ||
        (cleanPhone && u.phone === cleanPhone.replace("+", "")),
    );

    if (match) {
      ownerId = match.id;
    } else {
      secret = tempPassword();
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        ...(cleanEmail ? { email: cleanEmail, email_confirm: true } : {}),
        ...(cleanPhone ? { phone: cleanPhone, phone_confirm: true } : {}),
        password: secret,
        user_metadata: { full_name: owner_name.trim() },
      });

      if (createError || !created.user) {
        return json({ error: createError?.message ?? "Could not create the owner's login" }, 400);
      }
      ownerId = created.user.id;
    }

    // 4. The tenant, created AS THE CALLER rather than with the service key. The RPC
    // re-checks platform admin, so the person's own authority is what creates the rows —
    // which keeps this inside CLAUDE.md rule 3 rather than writing tenant data with a key
    // that bypasses every policy.
    const { data: provisioned, error: provisionError } = await asCaller.rpc("provision_tenant", {
      p_org_name: org_name.trim(),
      p_property_code: code,
      p_property_name: property_name.trim(),
      p_owner_user_id: ownerId,
    });

    if (provisionError) {
      // Only a login this call created is cleaned up. Deleting a pre-existing owner
      // because a second property failed to provision would take away their access to the
      // first one.
      if (secret && ownerId) await admin.auth.admin.deleteUser(ownerId);
      return json({ error: provisionError.message }, 400);
    }

    const row = Array.isArray(provisioned) ? provisioned[0] : provisioned;

    // 5. The password is handed back once and never stored. If it is lost it is reset,
    // not looked up, because there is nowhere to look.
    return json({
      property_id: row?.property_id,
      property_code: row?.property_code,
      org_id: row?.org_id,
      was_new: row?.was_new ?? false,
      owner_login_id: cleanPhone ?? cleanEmail,
      owner_existed: !secret,
      temp_password: secret,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
