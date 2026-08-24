import { Ionicons } from "@expo/vector-icons";
import { readItemSheet, type ItemSheet } from "@golai/domain";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View, type ViewStyle } from "react-native";
import {
  Card,
  FieldError,
  Loading,
  Notice,
  PrimaryButton,
  Screen,
  SelectRow,
  StatGrid,
  StatTile,
  StatusPill,
} from "../../components/ui";
import { fileTextPicker } from "../../lib/file-text";
import {
  importItems,
  listExistingItemCodes,
  resolveSheet,
  type ImportOutcome,
  type ResolutionSummary,
} from "../../lib/item-import";
import { listCategories, listUoms, type CategoryOption, type UomOption } from "../../lib/masters";
import { useSession } from "../../lib/session";
import { font, radius, space, tabular, type, usePalette } from "../../theme";

/**
 * Importing a property's item list.
 *
 * This is the longest-lead piece of any onboarding — several hundred rows nobody wants to
 * type twice — and it is the hard gate on everything else: nothing can be received against
 * an item that does not exist, which is a constraint in the schema rather than a gap in
 * the UI.
 *
 * Three stages, and the middle one is the point. Paste or choose a file; look at what it
 * will do; then commit. An importer that writes on the first click is one nobody trusts
 * with six hundred rows, and the row that matters is always the one they cannot see.
 */
export default function ImportItems() {
  const p = usePalette();
  const router = useRouter();
  const { activeProperty, canEditMasters } = useSession();

  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [uoms, setUoms] = useState<UomOption[]>([]);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fallbackCategoryId, setFallbackCategoryId] = useState("");
  const [fallbackUomId, setFallbackUomId] = useState("");

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  const propertyId = activeProperty?.propertyId ?? null;

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [c, u, codes] = await Promise.all([
          listCategories(),
          listUoms(),
          listExistingItemCodes(),
        ]);
        if (!alive) return;
        setCategories(c);
        setUoms(u);
        setExisting(codes);
        // Sensible defaults so a file with no category column still imports. Dry
        // provisions and kilograms are what most of a hotel store is.
        setFallbackCategoryId(c.find((x) => x.code === "PROVISIONS")?.id ?? c[0]?.id ?? "");
        setFallbackUomId(u.find((x) => x.code === "KG")?.id ?? u[0]?.id ?? "");
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

  const sheet: ItemSheet | null = useMemo(() => (text.trim() ? readItemSheet(text) : null), [text]);

  const resolution: ResolutionSummary | null = useMemo(() => {
    if (!sheet?.ok) return null;
    return resolveSheet({
      rows: sheet.rows,
      categories,
      uoms,
      existingCodes: existing,
      fallbackCategoryId: fallbackCategoryId || null,
      fallbackUomId: fallbackUomId || null,
    });
  }, [sheet, categories, uoms, existing, fallbackCategoryId, fallbackUomId]);

  async function choose() {
    try {
      const file = await fileTextPicker.pick(".csv,text/csv,text/plain");
      if (!file) return;
      setFileName(file.name);
      setText(file.text);
      setOutcome(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function run() {
    if (!propertyId || !resolution || resolution.rows.length === 0) return;
    setRunning(true);
    setError(null);
    setProgress(0);
    try {
      const result = await importItems(propertyId, resolution.rows, (pr) =>
        setProgress(Math.round((pr.done / pr.total) * 100)),
      );
      setOutcome(result);
      setExisting(await listExistingItemCodes());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  if (!canEditMasters) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background, justifyContent: "center" }}>
        <Notice
          icon="lock-closed-outline"
          title="Only an Administrator can import"
          body="The item master is what receiving is checked against, so recording stock must not require authority over it — and neither should hold the other."
          action={<PrimaryButton label="Back to items" onPress={() => router.replace("/items")} />}
        />
      </View>
    );
  }

  return (
    <Screen
      title="Import items"
      subtitle={`${existing.size} item${existing.size === 1 ? "" : "s"} in the master already`}
      onBack={() => router.back()}
    >
      {loading ? (
        <Loading />
      ) : outcome ? (
        <Outcome
          outcome={outcome}
          onAgain={() => {
            setOutcome(null);
            setText("");
            setFileName(null);
          }}
          onDone={() => router.replace("/items")}
        />
      ) : (
        <>
          <Card>
            <Text
              style={{
                fontSize: type.body,
                ...font("semibold"),
                color: p.text,
                marginBottom: 4,
              }}
            >
              Paste the rows, or choose the file
            </Text>
            <Text
              style={{
                fontSize: type.caption,
                color: p.textMuted,
                lineHeight: 18,
                marginBottom: space.md,
              }}
            >
              Open the spreadsheet, select everything including the heading row, and paste it here.
              Headings can say whatever they already say — Item Name, Particulars, Description all
              read the same. A <Text style={font("semibold")}>Shelf Life (days)</Text> column is
              what makes an item perishable and puts it in the expiry watchlist; without one,
              everything imports as non-perishable and has to be marked by hand.
            </Text>

            <TextInput
              value={text}
              onChangeText={(v) => {
                setText(v);
                setFileName(null);
                setOutcome(null);
              }}
              multiline
              numberOfLines={8}
              placeholder={
                "Item Code,Item Name,Category,UOM,Shelf Life (days)\nMILK-1L,Toned Milk 1L,Dairy,L,10"
              }
              placeholderTextColor={p.textFaint}
              accessibilityLabel="Paste the item rows"
              style={
                {
                  minHeight: 160,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: p.border,
                  borderRadius: radius.md,
                  backgroundColor: p.surfaceSunken,
                  padding: space.md,
                  fontSize: type.caption,
                  color: p.text,
                  textAlignVertical: "top",
                  outlineStyle: "none",
                } as never
              }
            />

            {fileTextPicker.available() ? (
              <View style={{ marginTop: space.md }}>
                <PrimaryButton
                  label={fileName ? `Chosen: ${fileName}` : "Choose a CSV file"}
                  icon="document-attach-outline"
                  tone="neutral"
                  onPress={() => void choose()}
                />
              </View>
            ) : null}
          </Card>

          {sheet && !sheet.ok ? (
            <View style={{ marginTop: space.lg }}>
              <FieldError message={sheet.problem ?? "That file could not be read."} />
            </View>
          ) : null}

          {sheet?.ok && resolution ? (
            <>
              <View style={{ height: space.xl }} />
              <Preview sheet={sheet} resolution={resolution} />

              <View style={{ height: space.xl }} />
              <Card>
                <Text
                  style={{
                    fontSize: type.body,
                    ...font("semibold"),
                    color: p.text,
                    marginBottom: space.md,
                  }}
                >
                  For rows that match nothing
                </Text>
                <SelectRow
                  label="Category"
                  value={fallbackCategoryId || null}
                  placeholder="Choose"
                  choices={categories.map((c) => ({
                    id: c.id,
                    label: c.name,
                    sublabel: c.code,
                  }))}
                  onSelect={setFallbackCategoryId}
                />
                <SelectRow
                  label="Unit"
                  value={fallbackUomId || null}
                  placeholder="Choose"
                  choices={uoms.map((u) => ({ id: u.id, label: u.name, sublabel: u.code }))}
                  onSelect={setFallbackUomId}
                />
              </Card>

              {error ? (
                <View style={{ marginTop: space.lg }}>
                  <FieldError message={error} />
                </View>
              ) : null}

              <View style={{ marginTop: space.xl }}>
                {running ? (
                  <View style={{ alignItems: "center" }}>
                    <ActivityIndicator color={p.accent} />
                    <Text
                      style={{
                        fontSize: type.caption,
                        color: p.textMuted,
                        marginTop: space.sm,
                      }}
                      accessibilityLiveRegion="polite"
                    >
                      {progress}% — writing in batches, so a bad row does not take the rest with it.
                    </Text>
                  </View>
                ) : (
                  <PrimaryButton
                    label={`Import ${resolution.rows.length} item${resolution.rows.length === 1 ? "" : "s"}`}
                    icon="cloud-upload-outline"
                    density="field"
                    onPress={() => void run()}
                    disabled={resolution.rows.length === 0 || !fallbackCategoryId || !fallbackUomId}
                  />
                )}
              </View>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

/**
 * What the import will do, before it does it.
 *
 * Ordered by how much it should worry somebody: skipped rows and duplicates first,
 * generated codes next, and the plain count last. An importer that leads with "600 rows
 * ready" and buries "12 duplicates" underneath is one that gets clicked through.
 */
function Preview({ sheet, resolution }: { sheet: ItemSheet; resolution: ResolutionSummary }) {
  const p = usePalette();
  const sample = resolution.rows.slice(0, 8);

  return (
    <>
      <StatGrid>
        <StatTile
          icon="cube-outline"
          label="Will import"
          value={resolution.rows.length}
          caption={`from ${sheet.rows.length} row${sheet.rows.length === 1 ? "" : "s"}`}
          tone="accent"
        />
        <StatTile
          icon="hourglass-outline"
          label="Perishable"
          value={resolution.perishable}
          caption={
            resolution.perishable > 0 ? "Have a shelf life" : "No shelf-life column in the file"
          }
          tone={resolution.perishable > 0 ? "neutral" : "warn"}
        />
        <StatTile
          icon="pricetag-outline"
          label="Codes generated"
          value={resolution.generated}
          caption="Rows with no code of their own"
          tone={resolution.generated > 0 ? "warn" : "neutral"}
        />
        <StatTile
          icon="remove-circle-outline"
          label="Skipped"
          value={sheet.skipped + resolution.alreadyPresent.length}
          caption="No name, or already in the master"
          tone={sheet.skipped + resolution.alreadyPresent.length > 0 ? "warn" : "neutral"}
        />
      </StatGrid>

      {sheet.duplicates.length > 0 ? (
        <View style={{ marginTop: space.lg }}>
          <Warn
            text={`The file uses ${sheet.duplicates.length} code more than once — ${sheet.duplicates.slice(0, 5).join(", ")}${sheet.duplicates.length > 5 ? "…" : ""}. The first one wins and the rest are refused; fix the sheet if that is not what you want.`}
          />
        </View>
      ) : null}

      {resolution.unknownCategories.length > 0 ? (
        <View style={{ marginTop: space.sm }}>
          <Warn
            text={`Not a category here: ${resolution.unknownCategories.slice(0, 6).join(", ")}${resolution.unknownCategories.length > 6 ? "…" : ""}. Those rows use the fallback below.`}
          />
        </View>
      ) : null}

      {resolution.unknownUoms.length > 0 ? (
        <View style={{ marginTop: space.sm }}>
          <Warn
            text={`Not a unit here: ${resolution.unknownUoms.slice(0, 6).join(", ")}${resolution.unknownUoms.length > 6 ? "…" : ""}. Those rows use the fallback below.`}
          />
        </View>
      ) : null}

      <View style={{ height: space.lg }} />
      <Card padded={false}>
        {sample.map((r, i) => (
          <View
            key={`${r.code}-${r.line}`}
            style={{
              paddingHorizontal: space.lg,
              paddingVertical: space.sm,
              borderBottomWidth: i < sample.length - 1 ? StyleSheet.hairlineWidth : 0,
              borderBottomColor: p.border,
            }}
          >
            <Text
              numberOfLines={1}
              style={{ fontSize: type.body, ...font("semibold"), color: p.text }}
            >
              {r.name}
            </Text>
            <Text
              numberOfLines={1}
              style={{ fontSize: type.caption, color: p.textMuted, marginTop: 1 }}
            >
              <Text style={tabular}>{r.code}</Text> · {r.categoryLabel} · {r.uomLabel}
              {r.shelfLifeDays !== null ? ` · ${r.shelfLifeDays} days` : ""}
            </Text>
            {r.codeWasGenerated ? (
              <View style={{ marginTop: space.xs }}>
                <StatusPill label="Code generated from the name" tone="warn" />
              </View>
            ) : null}
          </View>
        ))}
        {resolution.rows.length > sample.length ? (
          <View style={{ paddingHorizontal: space.lg, paddingVertical: space.sm }}>
            <Text style={{ fontSize: type.caption, color: p.textFaint }}>
              …and {resolution.rows.length - sample.length} more
            </Text>
          </View>
        ) : null}
      </Card>
    </>
  );
}

function Outcome({
  outcome,
  onAgain,
  onDone,
}: {
  outcome: ImportOutcome;
  onAgain: () => void;
  onDone: () => void;
}) {
  const p = usePalette();
  return (
    <>
      <Card>
        <View style={{ alignItems: "center", marginBottom: space.lg }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: radius.xl,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: outcome.failures.length > 0 ? p.warningSurface : p.successSurface,
            }}
          >
            <Ionicons
              name={outcome.failures.length > 0 ? "alert-circle" : "checkmark"}
              size={30}
              color={outcome.failures.length > 0 ? p.warning : p.success}
            />
          </View>
          <Text
            style={{
              fontSize: type.display,
              ...font("heavy"),
              color: p.text,
              marginTop: space.md,
              ...tabular,
            }}
          >
            {outcome.inserted}
          </Text>
          <Text style={{ fontSize: type.label, color: p.textMuted }}>
            item{outcome.inserted === 1 ? "" : "s"} added to the master
          </Text>
        </View>

        {outcome.failures.length > 0 ? (
          <>
            <Text
              style={{
                fontSize: type.label,
                ...font("semibold"),
                color: p.text,
                marginBottom: space.sm,
              }}
            >
              {outcome.failures.length} refused
            </Text>
            {outcome.failures.slice(0, 12).map((f) => (
              <Text
                key={f.code}
                style={{ fontSize: type.caption, color: p.textMuted, lineHeight: 18 }}
              >
                <Text style={{ ...font("semibold"), color: p.text }}>{f.code}</Text> {f.name} —{" "}
                {f.reason}
              </Text>
            ))}
            <Text
              style={{
                fontSize: type.caption,
                color: p.textMuted,
                marginTop: space.md,
                lineHeight: 18,
              }}
            >
              The rest are in. Fix these rows and paste them again — anything already imported is
              skipped rather than duplicated.
            </Text>
          </>
        ) : null}
      </Card>

      <View style={{ marginTop: space.xl }}>
        <PrimaryButton
          label="See the item master"
          icon="arrow-forward"
          density="field"
          onPress={onDone}
        />
      </View>
      <View style={{ marginTop: space.md }}>
        <PrimaryButton label="Import another sheet" tone="neutral" onPress={onAgain} />
      </View>
    </>
  );
}

function Warn({ text }: { text: string }) {
  const p = usePalette();
  return (
    <View
      style={
        {
          flexDirection: "row",
          alignItems: "flex-start",
          backgroundColor: p.warningSurface,
          borderRadius: radius.sm,
          padding: space.sm,
        } as ViewStyle
      }
    >
      <Ionicons name="alert-circle" size={15} color={p.warning} style={{ marginTop: 1 }} />
      <Text
        style={{
          flex: 1,
          fontSize: type.caption,
          color: p.warning,
          marginLeft: space.xs,
          lineHeight: 17,
        }}
      >
        {text}
      </Text>
    </View>
  );
}
