import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PrimaryButton } from "../../components/ui";
import { radius, space, type, usePalette } from "../../theme";

/**
 * The gate entry number, immediately after capture.
 *
 * This screen exists for one physical act: the officer writes this number onto the
 * vendor's paper challan (PRD section 4 Gate 0a). That is the bridge between paper and
 * app, and it is why the number is the largest thing on the screen rather than a
 * confirmation tick. Everything else here is subordinate to reading six digits
 * correctly, at night, through a windscreen's worth of distraction.
 */
export default function GateEntryRecorded() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { number } = useLocalSearchParams<{ number?: string }>();

  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <ScrollView
        contentContainerStyle={{
          padding: space.md,
          paddingTop: insets.top + space.xl,
          flexGrow: 1,
        }}
      >
        <View style={{ alignItems: "center", marginBottom: space.xl }}>
          <Ionicons name="checkmark-circle" size={64} color={p.success} />
          <Text
            style={{
              fontSize: type.heading,
              fontWeight: "700",
              color: p.text,
              marginTop: space.sm,
            }}
          >
            Arrival recorded
          </Text>
        </View>

        <View
          style={{
            backgroundColor: p.surface,
            borderColor: p.border,
            borderWidth: 1,
            borderRadius: radius.lg,
            padding: space.lg,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              fontSize: type.caption,
              fontWeight: "700",
              letterSpacing: 1.2,
              textTransform: "uppercase",
              color: p.textMuted,
            }}
          >
            Gate entry number
          </Text>
          <Text
            selectable
            accessibilityLabel={`Gate entry number ${number ?? "unknown"}`}
            style={{
              fontSize: type.display,
              fontWeight: "800",
              color: p.text,
              marginTop: space.sm,
              letterSpacing: 1,
              fontVariant: ["tabular-nums"],
              textAlign: "center",
            }}
          >
            {number ?? "—"}
          </Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            backgroundColor: p.warningSurface,
            borderRadius: radius.md,
            padding: space.md,
            marginTop: space.lg,
          }}
        >
          <Ionicons name="create-outline" size={24} color={p.warning} />
          <Text style={{ color: p.warning, fontSize: type.body, marginLeft: space.sm, flex: 1 }}>
            Write this number on the vendor&apos;s bill or challan now, before the vehicle moves.
          </Text>
        </View>

        <View style={{ flex: 1 }} />

        <View style={{ paddingBottom: insets.bottom + space.md, gap: space.sm }}>
          <PrimaryButton
            label="Record another arrival"
            icon="add"
            onPress={() => router.replace("/gate/new")}
          />
          <PrimaryButton label="Done" onPress={() => router.replace("/")} />
        </View>
      </ScrollView>
    </View>
  );
}
