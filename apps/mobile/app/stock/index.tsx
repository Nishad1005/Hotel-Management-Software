import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Header, Notice, Page, PrimaryButton, StatusPill } from "../../components/ui";
import { useSession } from "../../lib/session";
import {
  groupByItem,
  listStockReport,
  STATE_LABELS,
  type ItemGroup,
  type StockRow,
} from "../../lib/stock-report";
import { elevation, font, radius, space, tabular, type, usePalette } from "../../theme";

/**
 * What is in the store, and where.
 *
 * The most-asked question of any stock system, and the one this app had no screen for.
 * The expiry watchlist looked like an answer to it and is not: it shows what is running
 * out, which is a different question from what is here.
 *
 * ## Every state, on purpose
 *
 * Quarantine, the reject cage, Terminal 2 and department-held stock are all listed
 * alongside what is issuable. Showing only AVAILABLE would make the screen tidier and
 * would be the reason a physical count comes out short with nothing to explain it — the
 * pallet is not missing, it is standing at the receiving bay, and this is the screen that
 * has to say so.
 *
 * Grouped by item because that is how the question is asked. Nobody walks up wanting to
 * know what is in bin DRY-R1-B4; they want to know where the rice is, and how much of it
 * they can actually use.
 */
export default function StockOnHand() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeProperty } = useSession();

  const [rows, setRows] = useState<StockRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);

  const propertyId = activeProperty?.propertyId ?? null;

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      // Searched server-side rather than filtered here. A property runs to a few hundred
      // lots and the whole list is cheap, but the search matches on batch and bin code
      // too, and those are not on the screen to filter against.
      setRows(await listStockReport(propertyId, search));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId, search]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const groups = useMemo(() => groupByItem(rows), [rows]);

  // The difference between these two is the whole reason the screen shows every state.
  const totals = useMemo(() => {
    let lots = 0;
    let notIssuable = 0;
    for (const r of rows) {
      lots += 1;
      if (r.state !== "AVAILABLE") notIssuable += 1;
    }
    return { lots, notIssuable };
  }, [rows]);

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
            title="In the store"
            subtitle={
              loading
                ? "Counting"
                : `${groups.length} item${groups.length === 1 ? "" : "s"} across ${totals.lots} lot${
                    totals.lots === 1 ? "" : "s"
                  }${totals.notIssuable > 0 ? ` · ${totals.notIssuable} not issuable yet` : ""}`
            }
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
            <Ionicons name="search" size={17} color={p.textFaint} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Item, batch or bin code"
              placeholderTextColor={p.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Search stock"
              style={
                {
                  flex: 1,
                  minHeight: 44,
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
                accessibilityLabel="Clear the search"
                hitSlop={10}
              >
                <Ionicons name="close-circle" size={17} color={p.textFaint} />
              </Pressable>
            ) : null}
          </View>
        </Page>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + 48 }}
        keyboardShouldPersistTaps="handled"
      >
        <Page>
          {loading ? (
            <View style={{ paddingVertical: space.xxxl, alignItems: "center" }}>
              <ActivityIndicator size="large" color={p.accent} />
            </View>
          ) : error ? (
            <Notice icon="cloud-offline-outline" title="Could not count" body={error} tone="bad" />
          ) : groups.length === 0 ? (
            <Notice
              icon="albums-outline"
              title={search ? "Nothing matches that" : "The store is empty"}
              body={
                search
                  ? "The search looks at item names and codes, batch numbers and bin codes."
                  : "Stock appears here once a delivery is received, or once opening balances are recorded."
              }
              {...(search
                ? {}
                : {
                    action: (
                      <PrimaryButton
                        label="Record opening stock"
                        onPress={() => router.push("/stock/opening")}
                      />
                    ),
                  })}
            />
          ) : (
            <Card padded={false}>
              {groups.map((g, i) => (
                <ItemRow
                  key={g.itemId}
                  group={g}
                  open={openItem === g.itemId}
                  divider={i < groups.length - 1}
                  onToggle={() => setOpenItem(openItem === g.itemId ? null : g.itemId)}
                />
              ))}
            </Card>
          )}
        </Page>
      </ScrollView>
    </View>
  );
}

function ItemRow({
  group,
  open,
  divider,
  onToggle,
}: {
  group: ItemGroup;
  open: boolean;
  divider: boolean;
  onToggle: () => void;
}) {
  const p = usePalette();
  const held = group.total - group.available;

  return (
    <View
      style={{
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: p.border,
      }}
    >
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${group.itemName}, ${group.available} ${group.uomCode} issuable of ${group.total}`}
        style={({ pressed }) =>
          ({
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            minHeight: 64,
            backgroundColor: pressed ? p.surfaceSunken : "transparent",
            cursor: "pointer",
          }) as ViewStyle
        }
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{ fontSize: type.body, ...font("semibold"), color: p.text }}
          >
            {group.itemName}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontSize: type.caption, color: p.textMuted, marginTop: 1 }}
          >
            {group.itemCode} · {group.categoryName} · {group.rows.length} lot
            {group.rows.length === 1 ? "" : "s"}
          </Text>
          {/*
            Shown only when the two figures differ. A property whose stock is all in bins
            does not need to be told that none of it is elsewhere, and a badge that is
            always present stops being read.
          */}
          {held > 0 ? (
            <View style={{ marginTop: space.xs }}>
              <StatusPill
                icon="alert-circle-outline"
                label={`${fmt(held)} ${group.uomCode} not issuable`}
                tone="warn"
              />
            </View>
          ) : null}
        </View>

        <View style={{ alignItems: "flex-end", marginRight: space.sm }}>
          <Text style={{ fontSize: type.heading, ...font("bold"), color: p.text, ...tabular }}>
            {fmt(group.available)}
            <Text style={{ fontSize: type.caption, ...font("medium"), color: p.textMuted }}>
              {" "}
              {group.uomCode}
            </Text>
          </Text>
          {held > 0 ? (
            <Text style={{ fontSize: type.micro, color: p.textFaint, ...tabular }}>
              {fmt(group.total)} in total
            </Text>
          ) : null}
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={p.textFaint} />
      </Pressable>

      {open ? (
        <View style={{ backgroundColor: p.surfaceSunken, paddingVertical: space.xs }}>
          {group.rows.map((row) => (
            <LotRow key={`${row.batchId}-${row.locationId}-${row.state}`} row={row} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** One lot: a batch, in a place, in a state. All three are needed to identify it. */
function LotRow({ row }: { row: StockRow }) {
  const p = usePalette();
  const state = STATE_LABELS[row.state];

  const expiry =
    row.daysRemaining === null
      ? null
      : row.daysRemaining < 0
        ? { label: `Expired ${Math.abs(row.daysRemaining)} d ago`, tone: "bad" as const }
        : row.daysRemaining <= 2
          ? { label: `${row.daysRemaining} d left`, tone: "bad" as const }
          : row.daysRemaining <= 7
            ? { label: `${row.daysRemaining} d left`, tone: "warn" as const }
            : { label: `${row.daysRemaining} d left`, tone: "neutral" as const };

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: type.caption, color: p.text, ...font("medium") }}
        >
          {row.locationCode}
          <Text style={{ color: p.textMuted, ...font("regular") }}> · {row.locationName}</Text>
        </Text>
        <Text numberOfLines={1} style={{ fontSize: type.micro, color: p.textMuted, marginTop: 1 }}>
          Batch {row.batchNo}
          {row.isSystemGenerated ? " (generated)" : ""}
        </Text>
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.xs }}
        >
          <StatusPill label={state.label} tone={state.tone} />
          {expiry ? <StatusPill label={expiry.label} tone={expiry.tone} /> : null}
          {/*
            A permanent fact about the consignment, not a status that improved once
            somebody finally moved it — which is why it is still shown here months later.
          */}
          {row.dwellBreach ? (
            <StatusPill icon="hourglass" label="Stood too long at T1" tone="warn" />
          ) : null}
        </View>
      </View>

      <Text
        style={{
          fontSize: type.body,
          ...font("semibold"),
          color: row.state === "AVAILABLE" ? p.text : p.textMuted,
          ...tabular,
        }}
      >
        {fmt(row.qty)}
        <Text style={{ fontSize: type.micro, ...font("regular"), color: p.textFaint }}>
          {" "}
          {row.uomCode}
        </Text>
      </Text>
    </View>
  );
}

/** Quantities read as 12 and 12.5, never 12.0000 — trailing zeros are noise. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}
