import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Card,
  Field,
  FieldError,
  Header,
  Notice,
  Page,
  PrimaryButton,
  SelectRow,
} from "../../components/ui";
import { listItems, type ItemListRow } from "../../lib/masters";
import { useSession } from "../../lib/session";
import { listLocations, type LocationOption } from "../../lib/locations";
import { recordOpeningStock } from "../../lib/stock";
import { elevation, font, space, type, usePalette } from "../../theme";

/**
 * What is already in the store.
 *
 * Standard practice when any property starts using stock software, and not throwaway
 * scaffolding: this stays as the opening-balance and stock-take path. It is also the
 * only way batches exist before receiving (Gates 1–5) is built, which is what makes
 * the expiry watchlist real rather than a demo.
 */
export default function OpeningStock() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeProperty } = useSession();

  const [items, setItems] = useState<ItemListRow[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [qty, setQty] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [bestBefore, setBestBefore] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [i, l] = await Promise.all([listItems("", null), listLocations()]);
        if (!alive) return;
        setItems(i.filter((x) => x.isActive));
        setLocations(l);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const item = items.find((i) => i.id === itemId);
  const quantity = Number(qty);
  const dateLooksValid = /^\d{4}-\d{2}-\d{2}$/.test(bestBefore.trim());

  // A perishable without an expiry date would sit in the watchlist forever showing
  // nothing useful, which is worse than refusing the entry.
  const needsDate = item?.isPerishable === true;
  const problems: string[] = [];
  if (!itemId) problems.push("Choose an item.");
  if (!locationId) problems.push("Choose where it is stored.");
  if (!qty.trim() || !Number.isFinite(quantity) || quantity <= 0)
    problems.push("Enter a quantity greater than zero.");
  if (needsDate && !dateLooksValid)
    problems.push("This item is perishable, so it needs a best-before date (YYYY-MM-DD).");
  if (bestBefore.trim() && !dateLooksValid) problems.push("Write the date as YYYY-MM-DD.");

  async function save() {
    if (!activeProperty || !item || problems.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      await recordOpeningStock({
        propertyId: activeProperty.propertyId,
        itemId: item.id,
        uomId: item.uomId,
        locationId,
        qty: quantity,
        batchNo: batchNo.trim() || null,
        bestBefore: dateLooksValid ? bestBefore.trim() : null,
        shelfLifeTotalDays: item.shelfLifeDays,
      });
      setSaved(`${quantity} ${item.uomCode} of ${item.name} recorded.`);
      // Item and location stay put: opening stock is entered in runs, usually many
      // batches of the same thing into the same cold room.
      setQty("");
      setBatchNo("");
      setBestBefore("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background, justifyContent: "center" }}>
        <ActivityIndicator size="large" color={p.accent} />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background, justifyContent: "center" }}>
        <Notice
          icon="cube-outline"
          title="No items yet"
          body="Stock is recorded against an item, so the item master has to come first."
          action={<PrimaryButton label="Go to items" onPress={() => router.replace("/items")} />}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <View
        style={[
          {
            backgroundColor: p.surface,
            paddingTop: insets.top + space.lg,
            paddingHorizontal: space.lg,
            paddingBottom: space.md,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: p.border,
          },
          elevation(1, p),
        ]}
      >
        <Page>
          <Header
            title="Opening stock"
            subtitle="Record what is physically in the store"
            onBack={() => router.back()}
          />
        </Page>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl * 2 }}
        keyboardShouldPersistTaps="handled"
      >
        <Page>
          {saved ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: p.accentSurface,
                borderRadius: 10,
                padding: space.md,
                marginBottom: space.lg,
              }}
            >
              <Text
                style={{ fontSize: type.caption, color: p.accent, ...font("semibold"), flex: 1 }}
              >
                {saved}
              </Text>
            </View>
          ) : null}

          <Card>
            <SelectRow
              label="Item"
              value={itemId || null}
              placeholder="Choose an item"
              choices={items.map((i) => ({ id: i.id, label: i.name, sublabel: i.code }))}
              onSelect={setItemId}
            />

            <SelectRow
              label="Stored at"
              value={locationId || null}
              placeholder="Choose a location"
              choices={locations.map((l) => ({ id: l.id, label: l.name, sublabel: l.code }))}
              onSelect={setLocationId}
            />

            <Field
              label="Quantity"
              value={qty}
              onChangeText={setQty}
              placeholder="0"
              keyboardType="decimal-pad"
              {...(item ? { suffix: item.uomCode } : {})}
            />

            <Field
              label="Batch number"
              value={batchNo}
              onChangeText={setBatchNo}
              placeholder="Leave blank to generate one"
              autoCapitalize="characters"
              hint="A generated number is marked as such, so a trace can tell it from a supplier's."
            />

            <Field
              label={needsDate ? "Best before" : "Best before (optional)"}
              value={bestBefore}
              onChangeText={setBestBefore}
              placeholder="2026-09-30"
              keyboardType="numeric"
              {...(needsDate
                ? { hint: "Required: this item is marked perishable." }
                : { hint: "Leave blank if it does not expire." })}
            />

            {error ? <FieldError message={error} /> : null}
          </Card>

          {problems.length > 0 && (qty.trim() || itemId) ? (
            <View style={{ marginTop: space.md }}>
              {problems.map((msg) => (
                <FieldError key={msg} message={msg} />
              ))}
            </View>
          ) : null}

          <View style={{ marginTop: space.xl }}>
            <PrimaryButton
              label={saving ? "Recording…" : "Record stock"}
              icon="checkmark"
              onPress={save}
              disabled={saving || problems.length > 0}
            />
          </View>
        </Page>
      </ScrollView>
    </View>
  );
}
