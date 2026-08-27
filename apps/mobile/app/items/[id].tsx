import {
  normaliseItemCode,
  validateItemDraft,
  type ItemError,
  type StorageRegime,
} from "@golai/domain";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import {
  ChoiceTile,
  Field,
  FieldError,
  Loading,
  Notice,
  PrimaryButton,
  Screen,
  SelectRow,
  Text,
  Toggle,
} from "../../components/ui";
import {
  createItem,
  getItem,
  listCategories,
  listUoms,
  updateItem,
  type CategoryOption,
  type UomOption,
} from "../../lib/masters";
import { useSession } from "../../lib/session";
import { space, usePalette } from "../../theme";

const ERROR_TEXT: Record<ItemError, string> = {
  CODE_REQUIRED: "Give the item a code.",
  NAME_REQUIRED: "Give the item a name.",
  CATEGORY_REQUIRED: "Choose a category.",
  BASE_UOM_REQUIRED: "Choose the unit this item is counted in.",
  PERISHABLE_NEEDS_SHELF_LIFE:
    "A perishable item needs a shelf life, or its expiry cannot be worked out.",
  PERISHABLE_NEEDS_BATCH_CONTROL: "A perishable item must be batch controlled.",
  SHELF_LIFE_INVALID: "Shelf life must be a whole number of days, at least one.",
  COLD_CHAIN_NEEDS_RANGE: "A cold-chain item needs a temperature range.",
  TEMP_RANGE_INVERTED: "The minimum temperature must not be above the maximum.",
  MIN_SHELF_LIFE_PCT_INVALID: "Minimum shelf life must be between 0 and 100 percent.",
};

const REGIMES: {
  value: StorageRegime;
  label: string;
  icon: "sunny-outline" | "snow-outline" | "cube-outline";
}[] = [
  { value: "AMBIENT", label: "Ambient", icon: "sunny-outline" },
  { value: "CHILLED", label: "Chilled", icon: "snow-outline" },
  { value: "FROZEN", label: "Frozen", icon: "cube-outline" },
];

export default function ItemForm() {
  const p = usePalette();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeProperty, canEditMasters } = useSession();

  const isNew = id === "new";

  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [uoms, setUoms] = useState<UomOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [baseUomId, setBaseUomId] = useState("");
  const [isPerishable, setIsPerishable] = useState(false);
  const [isColdChain, setIsColdChain] = useState(false);
  const [isBatchControlled, setIsBatchControlled] = useState(false);
  const [storageRegime, setStorageRegime] = useState<StorageRegime>("AMBIENT");
  const [shelfLifeDays, setShelfLifeDays] = useState("");
  const [minShelfLifePct, setMinShelfLifePct] = useState("");
  const [tempMinC, setTempMinC] = useState("");
  const [tempMaxC, setTempMaxC] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [cats, units] = await Promise.all([listCategories(), listUoms()]);
        if (!alive) return;
        setCategories(cats);
        setUoms(units);

        if (!isNew && id) {
          const row = await getItem(id);
          if (!alive || !row) return;
          setCode(row.code);
          setName(row.name);
          setCategoryId(row.category_id);
          setBaseUomId(row.base_uom_id);
          setIsPerishable(row.is_perishable);
          setIsColdChain(row.is_cold_chain);
          setIsBatchControlled(row.is_batch_controlled);
          setStorageRegime(row.storage_regime);
          setShelfLifeDays(row.shelf_life_days?.toString() ?? "");
          setMinShelfLifePct(row.min_shelf_life_pct_at_receipt?.toString() ?? "");
          setTempMinC(row.temp_min_c?.toString() ?? "");
          setTempMaxC(row.temp_max_c?.toString() ?? "");
          setIsActive(row.is_active);
        }
      } catch (e) {
        if (alive) setSaveError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, isNew]);

  /**
   * Turning on "perishable" turns on "batch controlled" and holds it there.
   *
   * The database refuses the combination anyway, but a rejected save is a worse way to
   * learn a rule than a control that moves and explains itself. Selecting a category
   * also adopts its storage regime and minimum shelf life, which is where those
   * defaults are meant to come from.
   */
  function onPerishableChange(next: boolean) {
    setIsPerishable(next);
    if (next) setIsBatchControlled(true);
  }

  function onCategoryChange(nextId: string) {
    setCategoryId(nextId);
    const cat = categories.find((c) => c.id === nextId);
    if (!cat) return;
    setStorageRegime(cat.defaultStorageRegime);
    if (cat.defaultMinShelfLifePct !== null && minShelfLifePct.trim() === "") {
      setMinShelfLifePct(String(cat.defaultMinShelfLifePct));
    }
  }

  const draft = {
    code: normaliseItemCode(code),
    name: name.trim(),
    categoryId,
    baseUomId,
    isPerishable,
    isColdChain,
    isBatchControlled,
    storageRegime,
    shelfLifeDays: shelfLifeDays.trim() ? Number(shelfLifeDays) : undefined,
    minShelfLifePctAtReceipt: minShelfLifePct.trim() ? Number(minShelfLifePct) : undefined,
    tempMinC: tempMinC.trim() ? Number(tempMinC) : undefined,
    tempMaxC: tempMaxC.trim() ? Number(tempMaxC) : undefined,
  };

  const result = validateItemDraft(draft);
  const shown = submitted ? result.errors : [];
  const has = (e: ItemError) => shown.includes(e);

  async function save() {
    setSubmitted(true);
    setSaveError(null);
    if (!validateItemDraft(draft).ok || !activeProperty) return;

    setSaving(true);
    try {
      const write = {
        code: draft.code,
        name: draft.name,
        categoryId,
        baseUomId,
        isPerishable,
        isColdChain,
        isBatchControlled,
        storageRegime,
        shelfLifeDays: draft.shelfLifeDays ?? null,
        minShelfLifePctAtReceipt: draft.minShelfLifePctAtReceipt ?? null,
        tempMinC: draft.tempMinC ?? null,
        tempMaxC: draft.tempMaxC ?? null,
        isActive,
      };
      if (isNew) await createItem(activeProperty.propertyId, write);
      else if (id) await updateItem(id, write);
      router.back();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!canEditMasters) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background, justifyContent: "center" }}>
        <Notice
          icon="lock-closed-outline"
          title="Read only"
          body={
            "Editing the item master needs an Administrator. This is deliberate: the master is what " +
            "receiving is checked against, so if anyone could change it the rule that an item must " +
            "exist before it can be received would mean nothing."
          }
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background, justifyContent: "center" }}>
        <Loading />
      </View>
    );
  }

  return (
    <Screen
      onSubmit={save}
      title={isNew ? "New item" : "Edit item"}
      onBack={() => router.back()}
      footer={
        <PrimaryButton
          label={isNew ? "Create item" : "Save changes"}
          icon="checkmark"
          onPress={save}
          loading={saving}
        />
      }
    >
      <Field
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Toned Milk 1L"
        autoCapitalize="words"
        {...(has("NAME_REQUIRED") ? { error: ERROR_TEXT.NAME_REQUIRED } : {})}
      />
      <Field
        label="Code"
        value={code}
        onChangeText={setCode}
        placeholder="MILK-1L"
        autoCapitalize="characters"
        hint="Uppercased automatically. Spaces and symbols become dashes, so one item cannot become two."
        {...(has("CODE_REQUIRED") ? { error: ERROR_TEXT.CODE_REQUIRED } : {})}
      />

      <SelectRow
        label="Category"
        value={categoryId || null}
        placeholder="Choose a category"
        choices={categories.map((c) => ({ id: c.id, label: c.name, sublabel: c.code }))}
        onSelect={onCategoryChange}
        {...(has("CATEGORY_REQUIRED") ? { error: ERROR_TEXT.CATEGORY_REQUIRED } : {})}
      />
      <SelectRow
        label="Counted in"
        value={baseUomId || null}
        placeholder="Choose a unit"
        choices={uoms.map((u) => ({ id: u.id, label: u.name, sublabel: u.code }))}
        onSelect={setBaseUomId}
        {...(has("BASE_UOM_REQUIRED") ? { error: ERROR_TEXT.BASE_UOM_REQUIRED } : {})}
      />

      <Text role="label" weight="semibold" style={{ marginBottom: space.xs }}>
        Stored at
      </Text>
      <View style={{ flexDirection: "row", gap: space.sm, marginBottom: space.md }}>
        {REGIMES.map((r) => (
          <ChoiceTile
            key={r.value}
            icon={r.icon}
            label={r.label}
            selected={storageRegime === r.value}
            onPress={() => setStorageRegime(r.value)}
          />
        ))}
      </View>

      <Toggle
        label="Perishable"
        hint="Has a best-before date and appears on the expiry watchlist."
        value={isPerishable}
        onValueChange={onPerishableChange}
      />
      <Toggle
        label="Batch controlled"
        hint={
          isPerishable
            ? "Required for a perishable item — expiry belongs to a batch, not to an item."
            : "Track this item by batch, so individual deliveries stay distinguishable."
        }
        value={isBatchControlled}
        onValueChange={setIsBatchControlled}
        disabled={isPerishable}
      />

      {isPerishable ? (
        <>
          <Field
            label="Shelf life (days)"
            value={shelfLifeDays}
            onChangeText={setShelfLifeDays}
            placeholder="5"
            keyboardType="numeric"
            hint="Total life from manufacture. Used to work out how much is left."
            {...(has("PERISHABLE_NEEDS_SHELF_LIFE")
              ? { error: ERROR_TEXT.PERISHABLE_NEEDS_SHELF_LIFE }
              : has("SHELF_LIFE_INVALID")
                ? { error: ERROR_TEXT.SHELF_LIFE_INVALID }
                : {})}
          />
          <Field
            label="Minimum shelf life at receipt (%)"
            value={minShelfLifePct}
            onChangeText={setMinShelfLifePct}
            placeholder="60"
            keyboardType="numeric"
            hint="Defaulted from the category. Recorded on receipt, not enforced yet."
            {...(has("MIN_SHELF_LIFE_PCT_INVALID")
              ? { error: ERROR_TEXT.MIN_SHELF_LIFE_PCT_INVALID }
              : {})}
          />
        </>
      ) : null}

      <Toggle
        label="Cold chain"
        hint="Needs a probe temperature and photograph at receiving."
        value={isColdChain}
        onValueChange={setIsColdChain}
      />

      {isColdChain ? (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Field
              label="Min °C"
              value={tempMinC}
              onChangeText={setTempMinC}
              placeholder="0"
              keyboardType="numeric"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Max °C"
              value={tempMaxC}
              onChangeText={setTempMaxC}
              placeholder="4"
              keyboardType="numeric"
            />
          </View>
        </View>
      ) : null}
      {has("COLD_CHAIN_NEEDS_RANGE") ? (
        <FieldError message={ERROR_TEXT.COLD_CHAIN_NEEDS_RANGE} />
      ) : null}
      {has("TEMP_RANGE_INVERTED") ? <FieldError message={ERROR_TEXT.TEMP_RANGE_INVERTED} /> : null}

      {!isNew ? (
        <Toggle
          label="Active"
          hint="Inactive items stay in history but cannot be received or issued."
          value={isActive}
          onValueChange={setIsActive}
        />
      ) : null}

      {saveError ? (
        <View style={{ marginTop: space.md }}>
          <FieldError message={saveError} />
        </View>
      ) : null}
    </Screen>
  );
}
