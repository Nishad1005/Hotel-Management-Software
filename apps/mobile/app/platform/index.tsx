import { Ionicons } from "@expo/vector-icons";
import type { PropertyLifecycle } from "@golai/db";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import {
  Card,
  Field,
  FieldError,
  Loading,
  Notice,
  PrimaryButton,
  Screen,
  StatGrid,
  StatTile,
  StatusPill,
  Text,
} from "../../components/ui";
import {
  listTenants,
  provisionTenant,
  readiness,
  setPropertyLifecycle,
  type ProvisionedTenant,
  type Tenant,
} from "../../lib/platform";
import { radius, space, usePalette } from "../../theme";

/**
 * The vendor console.
 *
 * Our side of the product, not a customer's. Every other screen answers a question about
 * one property; this one answers "who are our customers and how far has each got", which
 * cannot be asked from inside a tenancy boundary — that being the entire point of the
 * boundary.
 *
 * Before this existed, onboarding meant opening the Supabase SQL editor against the
 * production database. Fine for tenant one, a liability by tenant five: production
 * credentials in somebody's hands, no record of who onboarded whom, and the property code
 * typed at seven in the evening printed onto every sticker in the store.
 *
 * The readiness column is the part that earns its place. A tenant created six weeks ago
 * with no items and no movements is a stalled onboarding, and on every other column it
 * looks exactly like a healthy one.
 */
export default function PlatformConsole() {
  const p = usePalette();
  const router = useRouter();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<ProvisionedTenant | null>(null);

  const load = useCallback(async () => {
    try {
      setTenants(await listTenants());
      setError(null);
      setDenied(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // A refusal is not an error. Somebody who reached this screen without the access is
      // told plainly rather than shown a red box that reads as a broken app.
      if (message.includes("platform administrators")) setDenied(true);
      else setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const summary = useMemo(() => {
    const live = tenants.filter((t) => t.propertyLifecycle === "LIVE").length;
    const stalled = tenants.filter(
      (t) => t.propertyLifecycle === "ONBOARDING" && t.lastActivity === null,
    ).length;
    const orgs = new Set(tenants.map((t) => t.orgId)).size;
    return { live, stalled, orgs };
  }, [tenants]);

  if (denied) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background, justifyContent: "center" }}>
        <Notice
          icon="lock-closed-outline"
          title="Not your console"
          body="Onboarding customers is a platform administrator's job — that is us, not a property. Everything you run your own hotel with is on the home screen."
          action={<PrimaryButton label="Back" onPress={() => router.replace("/")} />}
        />
      </View>
    );
  }

  return (
    /*
      The one screen carrying the brand band rather than the page surface. It is a
      different product from the one below it, and looking different is how somebody with
      both kinds of access knows which they are in.
    */
    <Screen
      title="Customers"
      subtitle={
        loading
          ? "Loading"
          : `${tenants.length} propert${tenants.length === 1 ? "y" : "ies"} across ${summary.orgs} customer${summary.orgs === 1 ? "" : "s"}`
      }
      onBack={() => router.back()}
      onBrand
      wide
    >
      {created ? (
        <View style={{ marginBottom: space.xl }}>
          <Onboarded result={created} onDone={() => setCreated(null)} />
        </View>
      ) : null}

      {loading ? (
        <Loading />
      ) : error ? (
        <Notice icon="cloud-offline-outline" title="Could not load" body={error} tone="bad" />
      ) : (
        <>
          <StatGrid>
            <StatTile
              icon="business-outline"
              label="Live"
              value={summary.live}
              caption="Running on it"
              tone="accent"
            />
            <StatTile
              icon="hourglass-outline"
              label="Onboarding"
              value={tenants.length - summary.live}
              caption="Not yet live"
              tone="neutral"
            />
            <StatTile
              icon="alert-circle-outline"
              label="Stalled"
              value={summary.stalled}
              caption="Created, nothing has moved"
              tone={summary.stalled ? "bad" : "neutral"}
            />
          </StatGrid>

          <View style={{ height: space.xl }} />

          {adding ? (
            <NewTenantForm
              onCancel={() => setAdding(false)}
              onCreated={(r) => {
                setAdding(false);
                setCreated(r);
                void load();
              }}
            />
          ) : (
            <PrimaryButton
              label="Onboard a customer"
              icon="add"
              density="field"
              onPress={() => {
                setAdding(true);
                setCreated(null);
              }}
            />
          )}

          <View style={{ height: space.xl }} />

          {tenants.length === 0 ? (
            <Notice
              icon="business-outline"
              title="No customers yet"
              body="Onboarding one creates their organisation, their property, their owner's login and the seed masters that let them work on the first morning."
            />
          ) : (
            tenants.map((t) => (
              <TenantCard
                key={t.propertyId}
                tenant={t}
                onLifecycle={async (state) => {
                  try {
                    await setPropertyLifecycle(t.propertyId, state);
                    await load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              />
            ))
          )}
        </>
      )}
    </Screen>
  );
}

function TenantCard({
  tenant,
  onLifecycle,
}: {
  tenant: Tenant;
  onLifecycle: (state: PropertyLifecycle) => void | Promise<void>;
}) {
  const checks = readiness(tenant);
  const ready = checks.filter((c) => c.done).length;
  const live = tenant.propertyLifecycle === "LIVE";
  const stalled = !live && tenant.lastActivity === null;

  return (
    <View style={{ marginBottom: space.lg }}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text role="heading" lines={1}>
              {tenant.propertyName}
            </Text>
            <Text role="caption" tone="muted" lines={1} style={{ marginTop: 1 }}>
              <Text role="caption" tone="muted" numeric>
                {tenant.propertyCode}
              </Text>{" "}
              · {tenant.orgName}
            </Text>
            <Text role="caption" tone="muted" lines={1} style={{ marginTop: 1 }}>
              Created {new Date(tenant.createdAt).toLocaleDateString()}
              {tenant.lastActivity
                ? ` · last movement ${new Date(tenant.lastActivity).toLocaleDateString()}`
                : " · nothing has moved yet"}
            </Text>
          </View>
          <StatusPill
            icon={live ? "checkmark-circle" : stalled ? "alert-circle" : "hourglass-outline"}
            label={live ? "Live" : tenant.propertyLifecycle.toLowerCase()}
            tone={live ? "good" : stalled ? "bad" : "warn"}
          />
        </View>

        <View style={{ height: space.md }} />

        {/*
          Derived, never stored. Storing the answer would mean storing something that goes
          stale the moment somebody imports an item, and a checklist that lies is worse
          than none — this is ADR 0010's readiness in the smallest honest form.
        */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
          {checks.map((c) => (
            <StatusPill
              key={c.label}
              icon={c.done ? "checkmark" : "ellipse-outline"}
              label={c.label}
              tone={c.done ? "good" : "neutral"}
            />
          ))}
        </View>

        <View style={{ height: space.md }} />

        <Text role="caption" tone="muted" numeric>
          {tenant.items} items · {tenant.bins} bins · {tenant.vendors} vendors · {tenant.people}{" "}
          people · {tenant.receipts} receipts
        </Text>

        {!live && ready === checks.length ? (
          <View style={{ marginTop: space.md }}>
            <PrimaryButton
              label="Mark live"
              icon="checkmark"
              onPress={() => void onLifecycle("LIVE")}
            />
          </View>
        ) : !live ? (
          <Text role="caption" tone="muted" style={{ marginTop: space.sm }}>
            {checks.length - ready} thing{checks.length - ready === 1 ? "" : "s"} still to do before
            this property is live. A property goes live when it can actually receive, not when it
            was created.
          </Text>
        ) : null}
      </Card>
    </View>
  );
}

function NewTenantForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (result: ProvisionedTenant) => void;
}) {
  const [orgName, setOrgName] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [code, setCode] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanCode = code.trim().toUpperCase();
  const codeOk = /^[A-Z][A-Z0-9]{1,7}$/.test(cleanCode);

  const problems: string[] = [];
  if (!orgName.trim()) problems.push("The customer needs a name.");
  if (!propertyName.trim()) problems.push("The property needs a name.");
  if (!codeOk)
    problems.push(
      "A code starts with a letter, then two to eight letters or digits, with no spaces or dashes.",
    );
  if (!ownerName.trim()) problems.push("The owner needs a name.");
  if (!ownerEmail.trim() && !ownerPhone.trim())
    problems.push("The owner needs an email address or a mobile number to sign in with.");

  async function create() {
    if (problems.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      const result = await provisionTenant({
        orgName: orgName.trim(),
        propertyCode: cleanCode,
        propertyName: propertyName.trim(),
        ownerName: ownerName.trim(),
        ...(ownerEmail.trim() ? { ownerEmail: ownerEmail.trim() } : {}),
        ...(ownerPhone.trim() ? { ownerPhone: ownerPhone.trim() } : {}),
      });
      onCreated(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <Field
        label="Customer"
        value={orgName}
        onChangeText={setOrgName}
        placeholder="Solitaire Hotels"
        autoCapitalize="words"
        hint="The group. Typing the same name again puts a second hotel under the same customer; a different name creates a new one."
      />

      <Field
        label="Property"
        value={propertyName}
        onChangeText={setPropertyName}
        placeholder="Voyage The Solitaire Bliss"
        autoCapitalize="words"
      />

      <Field
        label="Property code"
        value={code}
        onChangeText={setCode}
        placeholder="SB"
        autoCapitalize="characters"
        hint="Two to eight letters or digits. It starts every location code, every document number and every printed label at this property — and changing it later is a reprint and a walk round the store."
        {...(code.trim() && !codeOk
          ? { error: "Starts with a letter. Two to eight letters or digits." }
          : {})}
      />

      <View style={{ height: space.sm }} />
      <Text role="overline" tone="muted" style={{ marginBottom: space.sm }}>
        Their first login
      </Text>

      <Field
        label="Owner's name"
        value={ownerName}
        onChangeText={setOwnerName}
        placeholder="The person who runs the property"
        autoCapitalize="words"
      />

      <Field
        label="Email"
        value={ownerEmail}
        onChangeText={setOwnerEmail}
        placeholder="Optional if a mobile number is given"
        keyboardType="email-address"
      />

      <Field
        label="Mobile"
        value={ownerPhone}
        onChangeText={setOwnerPhone}
        placeholder="Ten digits, or with the country code"
        keyboardType="numeric"
        hint="Either is enough. They get one login as OWNER and ADMIN, and add their own people from inside the app."
      />

      {error ? <FieldError message={error} /> : null}
      {problems.slice(0, 2).map((msg) => (
        <FieldError key={msg} message={msg} />
      ))}

      <PrimaryButton
        label={saving ? "Onboarding…" : "Create the customer"}
        icon="checkmark"
        density="field"
        onPress={() => void create()}
        disabled={saving || problems.length > 0}
      />
      <View style={{ height: space.sm }} />
      <PrimaryButton label="Cancel" tone="neutral" onPress={onCancel} />
    </Card>
  );
}

/**
 * The password, once.
 *
 * Stored nowhere and never retrievable — if it is lost it is reset rather than looked up,
 * because there is nowhere to look. Which means this panel is the only chance to write it
 * down, and it says so.
 */
function Onboarded({ result, onDone }: { result: ProvisionedTenant; onDone: () => void }) {
  const p = usePalette();
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.md }}>
        <Ionicons name="checkmark-circle" size={22} color={p.success} />
        <Text weight="semibold" style={{ marginLeft: space.sm, flex: 1 }}>
          {result.propertyCode} is ready to be set up
        </Text>
      </View>

      <View
        style={{
          backgroundColor: p.surfaceSunken,
          borderRadius: radius.md,
          padding: space.md,
        }}
      >
        <Text role="caption" tone="muted">
          Signs in with
        </Text>
        <Text selectable role="heading" weight="bold">
          {result.ownerLoginId}
        </Text>

        {result.tempPassword ? (
          <>
            <Text role="caption" tone="muted" style={{ marginTop: space.md }}>
              Temporary password
            </Text>
            <Text selectable role="heading" weight="bold" numeric>
              {result.tempPassword}
            </Text>
            <Text role="caption" tone="warning" style={{ marginTop: space.sm }}>
              Shown once and stored nowhere. Write it down now — if it is lost it has to be reset,
              not looked up.
            </Text>
          </>
        ) : (
          <Text role="caption" tone="muted" style={{ marginTop: space.sm }}>
            They already had a login, so their existing password still works. This property has been
            added to it.
          </Text>
        )}
      </View>

      <Text role="caption" tone="muted" style={{ marginTop: space.md }}>
        Their units, categories, storage zones and departments are seeded. What they still need is
        their item list, their bins and their vendors — all of which they do themselves from inside
        the app.
      </Text>

      <View style={{ marginTop: space.md }}>
        <PrimaryButton label="Done" tone="neutral" onPress={onDone} />
      </View>
    </Card>
  );
}
