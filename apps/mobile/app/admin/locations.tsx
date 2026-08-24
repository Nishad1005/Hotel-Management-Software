import { Ionicons } from "@expo/vector-icons";
import type { StorageRegime } from "@golai/db";
import {
  fixturePrefix,
  LABEL_SIZES,
  MAX_RUN,
  planLabelSheet,
  planLocationRun,
  planZone,
  renderLabelSheetHtml,
  ZONE_SUFFIX_MAX,
  type LabelSizeId,
} from "@golai/domain";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  Card,
  ChoiceTile,
  Field,
  FieldError,
  Loading,
  Notice,
  PrimaryButton,
  Screen,
  Section,
  SelectRow,
  Text,
} from "../../components/ui";
import { printer } from "../../lib/print";
import {
  createLocationRun,
  createZone,
  deactivateLocation,
  listLocationTree,
  type LocationNode,
  type ZoneSummary,
} from "../../lib/location-admin";
import { useSession } from "../../lib/session";
import { radius, space, touch, usePalette } from "../../theme";

/**
 * Zones and locations — the store, laid out in its own words.
 *
 * Written on the assumption that standing a property up was our job — we take the layout
 * they send, build the tree, hand over the labels. The property does it themselves, and
 * the screen works either way: the write policy is OWNER/ADMIN, which their administrator
 * holds, and every name it asks for is asked in their words rather than ours.
 *
 * Nobody creates a hundred and twenty bins one at a time, so the work here is a generator
 * with a preview. The preview is the point. Codes are shown before anything is written,
 * because the alternative is discovering the naming was wrong after the stickers are
 * printed and stuck to shelves — and at that point the fix is a reprint and a walk round
 * the store.
 */
export default function Locations() {
  const p = usePalette();
  const router = useRouter();
  const { activeProperty, canEditMasters } = useSession();

  const [zones, setZones] = useState<ZoneSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openZone, setOpenZone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const [fixtureName, setFixtureName] = useState("Shelf");
  const [prefix, setPrefix] = useState("");
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("20");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setZones(await listLocationTree());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // useFocusEffect rather than useMemo: this is a side effect, and it has to re-run
  // when the screen is returned to — a run created and then a label printed elsewhere
  // should not leave a stale tree behind.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const zone = zones.find((z) => z.id === openZone) ?? null;

  // Recomputed on every keystroke, which is what makes it a preview rather than a
  // confirmation step.
  const plan = useMemo(
    () =>
      zone
        ? planLocationRun({
            parentCode: zone.code,
            fixtureName,
            ...(prefix.trim() ? { prefix } : {}),
            from: Number(from),
            to: Number(to),
          })
        : null,
    [zone, fixtureName, prefix, from, to],
  );

  async function addRun() {
    if (!activeProperty || !zone || !plan?.ok) return;
    setBusy(true);
    setResult(null);
    try {
      const outcome = await createLocationRun({
        propertyId: activeProperty.propertyId,
        parent: zone,
        fixtureName,
        ...(prefix.trim() ? { prefix } : {}),
        from: Number(from),
        to: Number(to),
      });
      setResult(
        outcome.revived > 0
          ? `${outcome.created} added, ${outcome.revived} restored from retired.`
          : `${outcome.created} added.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function retire(node: LocationNode) {
    if (!activeProperty) return;
    setBusy(true);
    try {
      await deactivateLocation(activeProperty.propertyId, node.id);
      setResult(`${node.code} retired.`);
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Zones & locations"
      subtitle="Lay out the store in its own words, then print the stickers"
      onBack={() => router.back()}
    >
      {result ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: p.accentSurface,
            borderRadius: radius.md,
            padding: space.md,
            marginBottom: space.lg,
          }}
        >
          <Ionicons name="checkmark-circle" size={17} color={p.accent} />
          <Text
            role="caption"
            tone="accent"
            weight="semibold"
            style={{ marginLeft: space.sm, flex: 1 }}
          >
            {result}
          </Text>
        </View>
      ) : null}

      {error ? (
        <View style={{ marginBottom: space.lg }}>
          <FieldError message={error} />
        </View>
      ) : null}

      {loading ? (
        <Loading />
      ) : zones.length === 0 ? (
        <Notice
          icon="map-outline"
          title="No zones yet"
          body="Zones are the areas of the store — dry store, cold room, freezer, and whatever else this property has. Seven are created when a property is set up; add the rest below."
        />
      ) : (
        zones.map((z) => (
          <Section key={z.id} title={`${z.code} · ${z.name}`}>
            <Card padded={false}>
              <Pressable
                onPress={() => {
                  setOpenZone(openZone === z.id ? null : z.id);
                  setResult(null);
                  setPrefix("");
                }}
                accessibilityRole="button"
                accessibilityLabel={`${z.name}, ${z.children.length} locations`}
                style={({ pressed }) =>
                  ({
                    flexDirection: "row",
                    alignItems: "center",
                    minHeight: touch.desk,
                    paddingHorizontal: space.lg,
                    paddingVertical: space.md,
                    backgroundColor: pressed ? p.surfaceSunken : "transparent",
                    cursor: "pointer",
                  }) as never
                }
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text weight="semibold">
                    {z.children.length === 0
                      ? "No locations inside yet"
                      : `${z.children.length} location${z.children.length === 1 ? "" : "s"}`}
                  </Text>
                  <Text role="caption" tone="muted" style={{ marginTop: 1 }}>
                    {z.regime.toLowerCase()} · {z.fixtureType}
                  </Text>
                </View>
                <Ionicons
                  name={openZone === z.id ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={p.textMuted}
                />
              </Pressable>

              {openZone === z.id ? (
                <View
                  style={{
                    padding: space.lg,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: p.border,
                  }}
                >
                  {z.children.length > 0 ? (
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: space.sm,
                        marginBottom: space.xl,
                      }}
                    >
                      {z.children.map((child) => (
                        <BinChip
                          key={child.id}
                          node={child}
                          disabled={busy || !canEditMasters}
                          onRetire={() => void retire(child)}
                        />
                      ))}
                    </View>
                  ) : null}

                  {z.children.length > 0 ? (
                    <LabelPrinter zone={z} propertyName={activeProperty?.propertyName ?? ""} />
                  ) : null}

                  {canEditMasters ? (
                    <>
                      <Text role="overline" tone="muted" style={{ marginBottom: space.md }}>
                        Add locations
                      </Text>

                      <Field
                        label="What does this property call them?"
                        value={fixtureName}
                        onChangeText={(next) => {
                          setFixtureName(next);
                          setPrefix("");
                        }}
                        placeholder="Shelf, Rack, Ghoda, Peti stack"
                        hint="Their word, not ours. It appears on every screen and every sticker."
                      />

                      <View style={{ flexDirection: "row", gap: space.md }}>
                        <View style={{ flex: 1 }}>
                          <Field
                            label="Code prefix"
                            value={prefix || fixturePrefix(fixtureName)}
                            onChangeText={setPrefix}
                            autoCapitalize="characters"
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Field
                            label="From"
                            value={from}
                            onChangeText={setFrom}
                            keyboardType="numeric"
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Field
                            label="To"
                            value={to}
                            onChangeText={setTo}
                            keyboardType="numeric"
                          />
                        </View>
                      </View>

                      {/*
                            The preview. Shown before anything is written, because the
                            alternative is finding the naming wrong after the labels are
                            printed and stuck.
                          */}
                      {plan?.ok ? (
                        <View
                          style={{
                            backgroundColor: p.surfaceSunken,
                            borderRadius: radius.md,
                            padding: space.md,
                            marginBottom: space.lg,
                          }}
                        >
                          <Text role="caption" tone="muted" style={{ marginBottom: space.xxs }}>
                            Will create {plan.count} location{plan.count === 1 ? "" : "s"}
                          </Text>
                          <Text weight="semibold" numeric>
                            {plan.first}
                            {plan.count > 1 ? `  …  ${plan.last}` : ""}
                          </Text>
                        </View>
                      ) : (
                        <View style={{ marginBottom: space.lg }}>
                          <FieldError message={explain(plan?.errors ?? [])} />
                        </View>
                      )}

                      <PrimaryButton
                        label={
                          busy
                            ? "Adding…"
                            : `Add ${plan?.ok ? plan.count : 0} location${plan?.count === 1 ? "" : "s"}`
                        }
                        icon="add"
                        onPress={() => void addRun()}
                        disabled={busy || !plan?.ok}
                      />
                    </>
                  ) : (
                    <Notice
                      icon="lock-closed-outline"
                      title="Read only"
                      body="Only an owner or administrator can change the location tree."
                    />
                  )}
                </View>
              ) : null}
            </Card>
          </Section>
        ))
      )}

      {canEditMasters && !loading ? (
        <NewZone
          propertyId={activeProperty?.propertyId ?? ""}
          propertyCode={activeProperty?.propertyCode ?? ""}
          busy={busy}
          onCreated={(code) => {
            setResult(`${code} added. Add the shelves inside it next.`);
            setError(null);
            void load();
          }}
          onError={setError}
        />
      ) : null}
    </Screen>
  );
}

/**
 * A new storage zone.
 *
 * Provisioning seeds seven — the two terminals, dispatch, security, dry, chilled, frozen —
 * and until now that was every zone a property could ever have. A resort has a pool bar
 * store and a spa store, and its own layout had nowhere to go.
 *
 * Last on the screen rather than first, because adding a zone is a once-a-quarter act and
 * filling one with shelves is a daily one. The code is previewed live for the same reason
 * the bin run previews its codes: the fix after stickers are printed and stuck is a
 * reprint and a walk round the store.
 */
function NewZone({
  propertyId,
  propertyCode,
  busy,
  onCreated,
  onError,
}: {
  propertyId: string;
  propertyCode: string;
  busy: boolean;
  onCreated: (code: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [suffix, setSuffix] = useState("");
  const [regime, setRegime] = useState<StorageRegime>("AMBIENT");
  const [fixture, setFixture] = useState("Shelf");
  const [saving, setSaving] = useState(false);

  const plan = useMemo(
    () => planZone({ propertyCode, name, ...(suffix.trim() ? { suffix } : {}) }),
    [propertyCode, name, suffix],
  );

  async function create() {
    if (!plan.ok || !propertyId) return;
    setSaving(true);
    try {
      const zone = await createZone({
        propertyId,
        propertyCode,
        name,
        ...(suffix.trim() ? { suffix } : {}),
        regime,
        fixtureType: fixture,
      });
      setName("");
      setSuffix("");
      setFixture("Shelf");
      setRegime("AMBIENT");
      setOpen(false);
      onCreated(zone.code);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <View style={{ marginTop: space.md }}>
        <PrimaryButton label="Add a zone" icon="add" tone="neutral" onPress={() => setOpen(true)} />
      </View>
    );
  }

  return (
    <Section title="New zone">
      <Card>
        <Field
          label="What is it called?"
          value={name}
          onChangeText={setName}
          placeholder="Pool bar store, Spa store, Banquet store"
          autoCapitalize="words"
          hint="The property's own name for the area. It appears on every screen and every sticker."
        />

        <Field
          label="Code"
          value={suffix || plan.suffix}
          onChangeText={setSuffix}
          placeholder="POOLBAR"
          autoCapitalize="characters"
          hint={
            plan.ok
              ? `Every location inside it will start ${plan.code}-`
              : "Derived from the name. Change it if the property already has a code for this area."
          }
        />

        {/*
          Chosen once, here, and inherited by every bin created inside. Asking again per
          run is how a chilled zone ends up with an ambient shelf in it, and put-away
          refuses a regime mismatch outright — so the mistake surfaces as a refusal at the
          dock rather than as a question here.
        */}
        <Text role="label" weight="semibold" style={{ marginBottom: space.xs }}>
          How is it stored?
        </Text>
        <View style={{ flexDirection: "row", gap: space.sm, marginBottom: space.lg }}>
          {(
            [
              { id: "AMBIENT", label: "Ambient", icon: "cube-outline" },
              { id: "CHILLED", label: "Chilled", icon: "snow-outline" },
              { id: "FROZEN", label: "Frozen", icon: "thermometer-outline" },
            ] as const
          ).map((r) => (
            <ChoiceTile
              key={r.id}
              icon={r.icon}
              label={r.label}
              selected={regime === r.id}
              onPress={() => setRegime(r.id)}
            />
          ))}
        </View>

        <Field
          label="What is inside it called?"
          value={fixture}
          onChangeText={setFixture}
          placeholder="Shelf, Rack, Ghoda, Peti stack"
          hint="Their word, not ours. A ghoda is a ghoda on every label."
        />

        {name.trim() && !plan.ok ? (
          <FieldError
            message={
              plan.errors.includes("SUFFIX_TOO_LONG")
                ? `A code is at most ${ZONE_SUFFIX_MAX} characters.`
                : "That name leaves no code behind it. Give the area a distinct word, or type a code."
            }
          />
        ) : null}

        <PrimaryButton
          label={saving ? "Adding…" : plan.ok ? `Add ${plan.code}` : "Add zone"}
          icon="checkmark"
          onPress={() => void create()}
          disabled={saving || busy || !plan.ok}
        />
        <View style={{ height: space.sm }} />
        <PrimaryButton label="Cancel" tone="neutral" onPress={() => setOpen(false)} />
      </Card>
    </Section>
  );
}

/**
 * Printing a zone's stickers.
 *
 * Where a run of a hundred and twenty bins becomes a stack of stickers, one press.
 *
 * The size choice is not cosmetic. Every thermal option is one label per page, because
 * sending an A4 grid to a thermal printer squeezes all ten onto a single sticker; that
 * was golaiv1's one genuine field failure here, found with a printer and a wasted roll.
 * The geometry and the page CSS both live in packages/domain with tests, so the failure
 * cannot come back quietly.
 */
function LabelPrinter({ zone, propertyName }: { zone: ZoneSummary; propertyName: string }) {
  const [sizeId, setSizeId] = useState<LabelSizeId>("thermal-100x50");
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    try {
      const plan = planLabelSheet(
        zone.children.map((c) => ({ code: c.code, name: c.name, zone: zone.name })),
        sizeId,
      );
      await printer.print(
        renderLabelSheetHtml(plan, propertyName ? { footer: propertyName } : {}),
        `${zone.code} labels`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!printer.available()) return null;

  return (
    <View style={{ marginBottom: space.xl }}>
      <Text role="overline" tone="muted" style={{ marginBottom: space.md }}>
        Print labels
      </Text>

      <SelectRow
        label="Label size"
        value={sizeId}
        placeholder="Choose"
        choices={LABEL_SIZES.map((s) => ({ id: s.id, label: s.label }))}
        onSelect={(id) => setSizeId(id as LabelSizeId)}
      />

      <PrimaryButton
        label={`Print ${zone.children.length} label${zone.children.length === 1 ? "" : "s"}`}
        icon="print-outline"
        tone="neutral"
        onPress={() => void run()}
      />

      <Text role="caption" tone="muted" style={{ marginTop: space.sm }}>
        Choose &ldquo;Save as PDF&rdquo; in the print dialog to send them to a print shop instead.
      </Text>

      {error ? <FieldError message={error} /> : null}
    </View>
  );
}

/** One bin. Tapping the cross retires it, which the server refuses while stock is on it. */
function BinChip({
  node,
  disabled,
  onRetire,
}: {
  node: LocationNode;
  disabled: boolean;
  onRetire: () => void;
}) {
  const p = usePalette();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: space.md,
        paddingRight: space.xs,
        paddingVertical: space.xs,
        borderRadius: radius.sm,
        backgroundColor: p.surfaceSunken,
      }}
    >
      <Text role="caption" weight="semibold" numeric>
        {node.code}
      </Text>
      {!disabled ? (
        <Pressable
          onPress={onRetire}
          accessibilityRole="button"
          accessibilityLabel={`Retire ${node.code}`}
          hitSlop={8}
          style={{ marginLeft: space.xs, padding: 2 }}
        >
          <Ionicons name="close-circle" size={15} color={p.textFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}

function explain(errors: readonly string[]): string {
  if (errors.includes("RANGE_NOT_WHOLE")) return "From and To must be whole numbers.";
  if (errors.includes("RANGE_BELOW_ONE")) return "Numbering starts at one.";
  if (errors.includes("RANGE_REVERSED")) return "To must not be lower than From.";
  if (errors.includes("RANGE_TOO_LARGE"))
    return `That is more than ${MAX_RUN} locations in one go. Split it into a few runs — it is easier to check, and easier to undo.`;
  return "Check the numbering.";
}
