import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Notice, PrimaryButton, StatusPill } from "../../components/ui";
import {
  listCategories,
  listItems,
  type CategoryOption,
  type ItemListRow,
} from "../../lib/masters";
import { useSession } from "../../lib/session";
import { radius, space, touch, type, usePalette } from "../../theme";

/**
 * The item master.
 *
 * Nothing can be received against an item that is not here — PRD section 4 Gate 2, one
 * of the four hard rules. So this list is not a convenience screen; it is the gate on
 * everything downstream, which is why building it early lets the property start
 * entering real items while the rest is still being written.
 */
export default function ItemsList() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { canEditMasters } = useSession();

  const [items, setItems] = useState<ItemListRow[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        setLoading(true);
        try {
          const [rows, cats] = await Promise.all([listItems(search, categoryId), listCategories()]);
          if (!alive) return;
          setItems(rows);
          setCategories(cats);
          setError(null);
        } catch (e) {
          if (alive) setError(e instanceof Error ? e.message : String(e));
        } finally {
          if (alive) setLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [search, categoryId]),
  );

  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <View style={{ padding: space.md, paddingTop: insets.top + space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.sm }}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            style={{ minWidth: touch.min, minHeight: touch.min, justifyContent: "center" }}
          >
            <Ionicons name="chevron-back" size={30} color={p.text} />
          </Pressable>
          <Text style={{ fontSize: type.title, fontWeight: "700", color: p.text, flex: 1 }}>
            Items
          </Text>
        </View>

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or code"
          placeholderTextColor={p.textMuted}
          accessibilityLabel="Search items"
          style={{
            minHeight: touch.min,
            borderWidth: 1,
            borderRadius: radius.md,
            paddingHorizontal: space.md,
            fontSize: type.body,
            backgroundColor: p.surface,
            borderColor: p.border,
            color: p.text,
          }}
        />

        {categories.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingVertical: space.sm, gap: space.sm }}
          >
            <FilterChip
              label="All"
              active={categoryId === null}
              onPress={() => setCategoryId(null)}
            />
            {categories.map((c) => (
              <FilterChip
                key={c.id}
                label={c.name}
                active={categoryId === c.id}
                onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
              />
            ))}
          </ScrollView>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: space.xxl * 2 }}
      >
        {loading ? (
          <ActivityIndicator style={{ marginTop: space.xl }} color={p.accent} />
        ) : error ? (
          <Notice
            icon="alert-circle-outline"
            tone="bad"
            title="Could not load items"
            body={error}
          />
        ) : items.length === 0 ? (
          <Notice
            icon="cube-outline"
            title={search || categoryId ? "Nothing matches" : "No items yet"}
            body={
              search || categoryId
                ? "Try a different search or clear the category filter."
                : canEditMasters
                  ? "Add the items this property receives. Nothing can be received against an item that does not exist here."
                  : "An administrator needs to add items before anything can be received."
            }
          />
        ) : (
          items.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => router.push(`/items/${item.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.code}`}
              style={({ pressed }) => ({
                minHeight: touch.min,
                padding: space.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: p.border,
                backgroundColor: pressed ? p.surfaceSunken : p.surface,
                marginBottom: space.sm,
                opacity: item.isActive ? 1 : 0.55,
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: type.body, fontWeight: "600", color: p.text }}>
                    {item.name}
                  </Text>
                  <Text style={{ fontSize: type.caption, color: p.textMuted, marginTop: 2 }}>
                    {item.code} · {item.categoryName} · {item.uomCode}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color={p.borderStrong} />
              </View>

              <View
                style={{
                  flexDirection: "row",
                  gap: space.sm,
                  marginTop: space.sm,
                  flexWrap: "wrap",
                }}
              >
                {item.isPerishable ? (
                  <StatusPill
                    icon="hourglass-outline"
                    label={
                      item.shelfLifeDays ? `${item.shelfLifeDays} day shelf life` : "Perishable"
                    }
                    tone="warn"
                  />
                ) : null}
                {item.isColdChain ? (
                  <StatusPill icon="snow-outline" label="Cold chain" tone="neutral" />
                ) : null}
                {item.storageRegime !== "AMBIENT" ? (
                  <StatusPill
                    icon="thermometer-outline"
                    label={item.storageRegime}
                    tone="neutral"
                  />
                ) : null}
                {!item.isActive ? (
                  <StatusPill icon="eye-off-outline" label="Inactive" tone="bad" />
                ) : null}
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      {canEditMasters ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: space.md,
            paddingBottom: insets.bottom + space.md,
            backgroundColor: p.surface,
            borderTopWidth: 1,
            borderTopColor: p.border,
          }}
        >
          <PrimaryButton label="Add item" icon="add" onPress={() => router.push("/items/new")} />
        </View>
      ) : null}
    </View>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active ? p.accent : p.border,
        backgroundColor: active ? p.accent : pressed ? p.surfaceSunken : p.surface,
      })}
    >
      <Text
        style={{
          fontSize: type.label,
          fontWeight: "600",
          color: active ? p.accentText : p.text,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
