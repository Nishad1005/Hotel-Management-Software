import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Header, Notice, Page, PrimaryButton, StatusPill } from "../../components/ui";
import {
  listCategories,
  listItems,
  type CategoryOption,
  type ItemListRow,
} from "../../lib/masters";
import { useSession } from "../../lib/session";
import { elevation, radius, space, touch, type, usePalette, weight } from "../../theme";

/**
 * The item master.
 *
 * Nothing can be received against an item that is not here — PRD section 4 Gate 2, one
 * of the four hard rules. Desk density throughout: this is used at a desk to enter
 * hundreds of rows, not at a gate in the dark, so it should show many at once.
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
            title="Items"
            {...(loading
              ? {}
              : { subtitle: `${items.length} item${items.length === 1 ? "" : "s"}` })}
            onBack={() => router.back()}
          />

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: p.border,
              borderRadius: radius.md,
              backgroundColor: p.surfaceSunken,
              paddingHorizontal: space.md,
            }}
          >
            <Ionicons name="search" size={16} color={p.textFaint} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name or code"
              placeholderTextColor={p.textFaint}
              accessibilityLabel="Search items"
              style={
                {
                  flex: 1,
                  minHeight: touch.desk,
                  paddingHorizontal: space.sm,
                  fontSize: type.body,
                  color: p.text,
                  outlineStyle: "none",
                } as never
              }
            />
            {search ? (
              <Pressable
                onPress={() => setSearch("")}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={10}
              >
                <Ionicons name="close-circle" size={16} color={p.textFaint} />
              </Pressable>
            ) : null}
          </View>

          {categories.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingTop: space.md, gap: space.xs }}
            >
              <Chip label="All" active={categoryId === null} onPress={() => setCategoryId(null)} />
              {categories.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  active={categoryId === c.id}
                  onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
                />
              ))}
            </ScrollView>
          ) : null}
        </Page>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl * 2 }}>
        <Page>
          {loading ? (
            <ActivityIndicator style={{ marginTop: space.xxl }} color={p.accent} />
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
                  ? "Try a different search, or clear the category filter."
                  : canEditMasters
                    ? "Add the items this property receives. Nothing can be received against an item that does not exist here."
                    : "An administrator needs to add items before anything can be received."
              }
            />
          ) : (
            <Card padded={false}>
              {items.map((item, i) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  divider={i < items.length - 1}
                  onPress={() => router.push(`/items/${item.id}`)}
                />
              ))}
            </Card>
          )}
        </Page>
      </ScrollView>

      {canEditMasters ? (
        <View
          style={{
            position: "absolute",
            right: space.lg,
            bottom: insets.bottom + space.lg,
          }}
        >
          <PrimaryButton label="Add item" icon="add" onPress={() => router.push("/items/new")} />
        </View>
      ) : null}
    </View>
  );
}

function ItemRow({
  item,
  divider,
  onPress,
}: {
  item: ItemListRow;
  divider: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${item.code}`}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => ({
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: p.border,
        backgroundColor: pressed ? p.surfaceSunken : "transparent",
        borderWidth: focused ? 2 : 0,
        borderColor: p.focus,
        opacity: item.isActive ? 1 : 0.5,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{ fontSize: type.body, fontWeight: weight.semibold, color: p.text }}
          >
            {item.name}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontSize: type.caption, color: p.textMuted, marginTop: 1 }}
          >
            <Text style={{ fontVariant: ["tabular-nums"] }}>{item.code}</Text>
            {"  ·  "}
            {item.categoryName}
            {"  ·  "}
            {item.uomCode}
          </Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            marginLeft: space.sm,
          }}
        >
          {item.isPerishable ? (
            <StatusPill
              icon="hourglass-outline"
              label={item.shelfLifeDays ? `${item.shelfLifeDays}d` : "Perishable"}
              tone="warn"
            />
          ) : null}
          {item.isColdChain ? <StatusPill icon="snow-outline" label="Cold" tone="neutral" /> : null}
          {!item.isActive ? <StatusPill label="Inactive" tone="bad" /> : null}
          <Ionicons name="chevron-forward" size={16} color={p.textFaint} />
        </View>
      </View>
    </Pressable>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        paddingHorizontal: space.md,
        paddingVertical: space.xs + 2,
        borderRadius: radius.pill,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: active ? p.accent : p.border,
        backgroundColor: active ? p.accentSurface : pressed ? p.surfaceSunken : "transparent",
      })}
    >
      <Text
        style={{
          fontSize: type.caption,
          fontWeight: weight.semibold,
          color: active ? p.accent : p.textMuted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
