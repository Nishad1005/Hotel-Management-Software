import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  Card,
  IconButton,
  Notice,
  PrimaryButton,
  Screen,
  SearchField,
  SkeletonList,
  StatusPill,
  Text,
} from "../../components/ui";
import {
  listCategories,
  listItems,
  type CategoryOption,
  type ItemListRow,
} from "../../lib/masters";
import { useSession } from "../../lib/session";
import { radius, space, usePalette } from "../../theme";

/**
 * The item master.
 *
 * Nothing can be received against an item that is not here — PRD section 4 Gate 2, one
 * of the four hard rules. Desk density throughout: this is used at a desk to enter
 * hundreds of rows, not at a gate in the dark, so it should show many at once.
 */
export default function ItemsList() {
  const router = useRouter();
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
    <Screen
      title="Items"
      {...(loading ? {} : { subtitle: `${items.length} item${items.length === 1 ? "" : "s"}` })}
      onBack={() => router.back()}
      {...(canEditMasters
        ? {
            actions: (
              <IconButton
                icon="cloud-upload-outline"
                label="Import items from a spreadsheet"
                tone="accent"
                onPress={() => router.push("/items/import")}
              />
            ),
            footer: (
              <PrimaryButton
                label="Add item"
                icon="add"
                onPress={() => router.push("/items/new")}
              />
            ),
          }
        : {})}
      band={
        <>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder="Name or code"
            label="Search items"
          />
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
        </>
      }
    >
      {loading ? (
        <SkeletonList />
      ) : error ? (
        <Notice icon="alert-circle-outline" tone="bad" title="Could not load items" body={error} />
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
    </Screen>
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
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {/*
            Muted rather than dimmed. `opacity: 0.5` on the row took this name to 3.30:1
            and its metadata line to 2.06:1 — a retired item became genuinely hard to
            read, when all it needs is to look quieter than a live one. The "Inactive"
            pill to the right is what actually carries the meaning.
          */}
          <Text weight="semibold" lines={1} tone={item.isActive ? "default" : "muted"}>
            {item.name}
          </Text>
          <Text role="caption" tone="muted" lines={1} style={{ marginTop: 1 }}>
            <Text role="caption" tone="muted" numeric>
              {item.code}
            </Text>
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
          <Ionicons name="chevron-forward" size={16} color={p.textMuted} />
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
      <Text role="label" weight="semibold" tone={active ? "accent" : "muted"}>
        {label}
      </Text>
    </Pressable>
  );
}
