import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Notice, PrimaryButton, Row } from "../components/ui";
import { useSession } from "../lib/session";
import { font, space, type, usePalette } from "../theme";

/**
 * Which property am I working in?
 *
 * Shown only when a user has access to more than one. The property is the tenancy
 * boundary, not a preference: every query is scoped to it, so guessing would silently
 * show one hotel's stock to someone who believed they were looking at another's.
 *
 * A user with exactly one property never sees this screen.
 */
export default function ChooseProperty() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { properties, setActiveProperty, signOut } = useSession();

  if (properties.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background, justifyContent: "center" }}>
        <Notice
          icon="business-outline"
          tone="bad"
          title="No property assigned"
          body={
            "Your account exists but has no membership, so there is nothing to show. An " +
            "administrator needs to grant you a role:\n\n" +
            "select system.grant_property_role('your@email', 'SB', 'STOREKEEPER');"
          }
        />
        <View style={{ padding: space.lg }}>
          <PrimaryButton label="Sign out" icon="log-out-outline" onPress={() => void signOut()} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: p.background }}
      contentContainerStyle={{ padding: space.md, paddingTop: insets.top + space.xl }}
    >
      <Text style={{ fontSize: type.title, ...font("bold"), color: p.text }}>Choose property</Text>
      <Text style={{ fontSize: type.label, color: p.textMuted, marginBottom: space.lg }}>
        Everything you see and record belongs to the property you pick.
      </Text>

      {properties.map((prop) => (
        <Row
          key={prop.propertyId}
          icon="business"
          label={prop.propertyName}
          value={`${prop.propertyCode} · ${prop.organisationName}`}
          onPress={() => setActiveProperty(prop.propertyId)}
        />
      ))}
    </ScrollView>
  );
}
