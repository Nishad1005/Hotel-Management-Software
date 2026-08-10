import { isIssuable, STOCK_STATES, type StockState } from "@golai/domain";
import { ScrollView, StyleSheet, Text, View } from "react-native";

/**
 * Scaffold smoke screen.
 *
 * It renders from `@golai/domain` on purpose. The thing worth proving in a scaffold
 * is not that a screen appears — it is that the workspace package holding the rules
 * resolves and runs inside the app, on web and on native, from one source. If this
 * screen renders, the linkage the whole architecture depends on is working.
 *
 * Replaced by the Gate 0 capture flow.
 */
export default function Index() {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Golai</Text>
      <Text style={styles.subtitle}>Quantity. Movement. Accountability.</Text>

      <Text style={styles.section}>Stock states</Text>
      <Text style={styles.note}>
        Resolved from @golai/domain. Only stock in a zone bin, free of holds, can be issued.
      </Text>

      {STOCK_STATES.map((state: StockState) => (
        <View key={state} style={styles.row}>
          <Text style={styles.rowLabel}>{state}</Text>
          <Text style={[styles.badge, isIssuable(state) ? styles.badgeYes : styles.badgeNo]}>
            {isIssuable(state) ? "issuable" : "not issuable"}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

// Touch targets stay large throughout this app: cold hands, gloves, night shift.
const styles = StyleSheet.create({
  page: { padding: 24, gap: 8 },
  title: { fontSize: 34, fontWeight: "700" },
  subtitle: { fontSize: 15, opacity: 0.6, marginBottom: 24 },
  section: { fontSize: 13, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  note: { fontSize: 13, opacity: 0.6, marginBottom: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 56,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "rgba(127,127,127,0.10)",
  },
  rowLabel: { fontSize: 16, fontWeight: "600" },
  badge: { fontSize: 13, fontWeight: "600" },
  badgeYes: { color: "#15803d" },
  badgeNo: { color: "#b45309" },
});
