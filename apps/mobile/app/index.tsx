import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BigRow, PrimaryButton } from "../components/ui";
import { radius, space, type, usePalette } from "../theme";

/**
 * The security post's home screen.
 *
 * One primary action, sized so it can be hit without looking. Everything else on this
 * screen is a status the guard needs at handover: what is still open, and what is owed.
 */
export default function Home() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ backgroundColor: p.background }}
      contentContainerStyle={{
        padding: space.md,
        paddingTop: insets.top + space.lg,
        paddingBottom: insets.bottom + space.xl,
      }}
    >
      <Text style={{ fontSize: type.title, fontWeight: "800", color: p.text }}>Golai</Text>
      <Text style={{ fontSize: type.label, color: p.textMuted, marginBottom: space.lg }}>
        Security gate · Voyage The Solitaire Bliss
      </Text>

      <PrimaryButton
        label="New arrival"
        icon="add-circle"
        onPress={() => router.push("/gate/new")}
      />

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: p.surface,
          borderColor: p.border,
          borderWidth: 1,
          borderRadius: radius.md,
          padding: space.md,
          marginTop: space.lg,
        }}
      >
        <Ionicons name="cloud-offline-outline" size={24} color={p.textMuted} />
        <Text style={{ fontSize: type.label, color: p.textMuted, marginLeft: space.sm, flex: 1 }}>
          Not yet connected. Entries are not being saved — this is the capture flow only.
        </Text>
      </View>

      <Text
        style={{
          fontSize: type.caption,
          fontWeight: "700",
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: p.textMuted,
          marginTop: space.xl,
          marginBottom: space.sm,
        }}
      >
        Shift handover
      </Text>
      <BigRow
        icon="time-outline"
        label="Open gate entries"
        value="Not yet available"
        onPress={() => {}}
      />
      <BigRow
        icon="repeat-outline"
        label="Outstanding returnables"
        value="Not yet available"
        onPress={() => {}}
      />
    </ScrollView>
  );
}
