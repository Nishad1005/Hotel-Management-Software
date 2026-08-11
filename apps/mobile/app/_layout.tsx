import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "../lib/session";
import { usePalette } from "../theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="auto" />
        <Guard />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/**
 * Route guard.
 *
 * Three gates, in order: signed in, a property chosen, then the app. Redirects happen
 * in an effect rather than during render, because navigating mid-render is what
 * produces the "cannot update a component while rendering another" warning and, on
 * web, a history stack that traps the back button.
 */
function Guard() {
  const { loading, session, activeProperty, properties } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const p = usePalette();

  const route = segments[0];
  const onSignIn = route === "sign-in";
  const onChooser = route === "choose-property";

  useEffect(() => {
    if (loading) return;

    if (!session) {
      if (!onSignIn) router.replace("/sign-in");
      return;
    }

    // Signed in but no property selected. A single property is chosen automatically
    // by the session provider, so reaching here means there are none or several.
    if (!activeProperty) {
      if (!onChooser) router.replace("/choose-property");
      return;
    }

    if (onSignIn || onChooser) router.replace("/");
  }, [loading, session, activeProperty, properties.length, onSignIn, onChooser, router]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: p.background,
        }}
      >
        <ActivityIndicator size="large" color={p.accent} />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
