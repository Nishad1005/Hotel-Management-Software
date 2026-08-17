// Golai — create-user
//
// Lets a property's administrator create a login from inside the app, without the
// service-role key ever reaching a browser.
//
// This exists because there is otherwise no way to add a person at all: the Supabase
// dashboard, by hand, which in practice means everybody shares one account. That is not
// an inconvenience — if Security and the storekeeper are the same login, the gate entry
// and the GRN are written by the same person, they agree by construction, and the
// reconciliation control the whole module rests on quietly stops existing.
//
// No email is ever sent. The temporary password is shown once, on screen, for the
// administrator to hand over. A storekeeper in Tinsukia, a guard on an agency contract
// and a commis in the kitchen mostly do not have an email address, and requiring one
// means inventing addresses — which is how a shared login gets created in the first
// place.
//
// Deploy: supabase functions deploy create-user

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROLES = [
  "OWNER",
  "ADMIN",
  "GM",
  "SECURITY",
  "STOREKEEPER",
  "CHEF",
  "FSO",
  "PURCHASE",
  "BANQUET",
  "AUDITOR",
];

/**
 * Readable aloud, which is the entire requirement.
 *
 * The administrator reads this to somebody across a counter, so the alphabet excludes
 * every character that is ambiguous when spoken or written down in a hurry: O and 0,
 * I and l and 1.
 */
function tempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return "Golai-" + Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/**
 * E.164, defaulting to +91.
 *
 * A deliberate duplicate of packages/domain/src/identity/phone.ts. Deno cannot import
 * from the workspace, so the choice is this copy or no normalisation at all on the
 * server — and the server is the side that must not be wrong, because a number stored
 * in the wrong shape is a login nobody can use. Keep the two in step.
 */
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

    const { property_id, full_name, role, email, phone, password } = await req.json();

    if (!property_id) return json({ error: "Which property?" }, 400);
    if (!full_name?.trim()) return json({ error: "A name is required" }, 400);
    if (!ROLES.includes(role)) return json({ error: "That is not a role" }, 400);

    // 1. Authority, asked of the database as the CALLER.
    //
    // This function holds the service-role key and could do anything; that is exactly
    // why it must not decide this for itself. `can_manage_users` runs under the
    // caller's JWT and is the same rule the RLS policies use, so there is one answer to
    // "may this person do this" rather than two that can drift apart.
    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });

    const { data: caller } = await asCaller.auth.getUser();
    if (!caller.user) return json({ error: "Not signed in" }, 401);

    const { data: permitted, error: permissionError } = await asCaller.rpc("can_manage_users", {
      p_property_id: property_id,
    });

    if (permissionError) return json({ error: permissionError.message }, 400);
    if (permitted !== true) {
      return json({ error: "Only an owner or administrator can create logins here" }, 403);
    }

    // 2. An identifier. Either is fine; neither is not.
    const cleanEmail = (email ?? "").trim() || null;
    const cleanPhone = phone?.trim() ? normalisePhone(phone) : null;

    if (phone?.trim() && !cleanPhone) {
      return json(
        { error: "Enter a valid mobile number — ten digits, or with the country code" },
        400,
      );
    }
    if (!cleanEmail && !cleanPhone) {
      return json({ error: "Enter an email address or a mobile number" }, 400);
    }

    const chosen = typeof password === "string" ? password.trim() : "";
    if (chosen && chosen.length < 6) {
      return json({ error: "A password needs at least six characters" }, 400);
    }
    const secret = chosen || tempPassword();

    // 3. The login. Pre-confirmed, because no message is ever sent — the administrator
    // hands the password over in person.
    const admin = createClient(url, serviceKey);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      ...(cleanEmail ? { email: cleanEmail, email_confirm: true } : {}),
      ...(cleanPhone ? { phone: cleanPhone, phone_confirm: true } : {}),
      password: secret,
      user_metadata: { full_name: full_name.trim() },
    });

    if (createError || !created.user) {
      return json({ error: createError?.message ?? "Could not create the login" }, 400);
    }

    // 4. The membership. If this fails the auth user is deleted rather than left
    // behind: an account that can sign in and belongs to no property is a support
    // ticket that looks like a bug in the app.
    // Granted AS THE CALLER, not with the service key. `grant_role` re-checks authority
    // and refuses self-grants, so the administrator's own permissions are what create
    // the membership — which keeps this inside CLAUDE.md rule 3 rather than writing
    // tenant data with a key that bypasses every policy.
    const { error: grantError } = await asCaller.rpc("grant_role", {
      p_property_id: property_id,
      p_user_id: created.user.id,
      p_role: role,
    });

    if (grantError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: grantError.message }, 400);
    }

    // 5. Handed back once, and never stored. If it is lost, an administrator resets it.
    return json({
      id: created.user.id,
      full_name: full_name.trim(),
      role,
      login_id: cleanPhone ?? cleanEmail,
      temp_password: secret,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
