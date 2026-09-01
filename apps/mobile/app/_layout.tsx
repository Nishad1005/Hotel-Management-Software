import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppShell } from "../components/shell";
import { SessionProvider, useSession } from "../lib/session";
import { initTelemetry } from "../lib/telemetry";
import { useSyncEngine } from "../lib/sync";
import { usePalette } from "../theme";

/**
 * Module scope, before anything renders: errors during the very first mount are the
 * ones nobody can reproduce from a description, so the net goes up before the show.
 */
initTelemetry();

export default function RootLayout() {
  /**
   * Fonts are loaded before anything renders.
   *
   * Rendering first and swapping later causes every label to reflow once the real face
   * arrives, which on a list of two hundred items is a visible lurch. The wait is a
   * few hundred milliseconds against a local cache.
   */
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="auto" />
        <Guard fontsLoaded={fontsLoaded} />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/**
 * Route guard: signed in, then a property chosen, then the app.
 *
 * Redirects run in an effect rather than during render — navigating mid-render causes
 * the "cannot update a component while rendering another" warning and, on web, a
 * history stack that traps the back button.
 */
function Guard({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { loading, session, activeProperty, properties, isPlatformAdmin } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const p = usePalette();

  const route = segments[0];
  const onSignIn = route === "sign-in";
  const onChooser = route === "choose-property";

  // Mounted here rather than on the capture screen: a guard records an arrival and
  // walks away from it, so the queue has to drain from wherever the app happens to be.
  useSyncEngine(!!session);

  useEffect(() => {
    if (loading || !fontsLoaded) return;

    if (!session) {
      if (!onSignIn) router.replace("/sign-in");
      return;
    }

    if (!activeProperty) {
      /*
        A platform admin holds no property membership by design — list_tenants() is
        SECURITY DEFINER guarded by the admin check precisely because "all tenants" is
        not a membership question. The old unconditional redirect therefore locked
        vendor staff out of the one screen that is theirs: an account without a
        property could never reach /platform, and landed on a chooser telling it to
        ask an administrator for a role it should not have.

        The flag resolves asynchronously, so a hard reload on /platform can still
        bounce to the chooser before it arrives — the chooser now carries a console
        affordance for exactly that case, at the cost of one extra press.
      */
      if (isPlatformAdmin && route === "platform") return;
      if (!onChooser) router.replace("/choose-property");
      return;
    }

    if (onSignIn || onChooser) router.replace("/");
  }, [
    loading,
    fontsLoaded,
    session,
    activeProperty,
    properties.length,
    isPlatformAdmin,
    route,
    onSignIn,
    onChooser,
    router,
  ]);

  if (loading || !fontsLoaded) {
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

  const stack = <Stack screenOptions={{ headerShown: false, animation: TRANSITION }} />;

  // Sign-in and the property chooser are outside the app: there is no property yet, so a
  // sidebar would have nothing true to say and its destinations would all be refused.
  const framed = !!session && !!activeProperty && !onSignIn && !onChooser;

  return framed ? <AppShell>{stack}</AppShell> : stack;
}

/**
 * `slide_from_right` is a phone idiom. On a desktop, where the content sits in a pane
 * beside a sidebar that does not move, sliding it horizontally reads as a rendering fault
 * rather than as navigation — so web gets no transition at all until there is a
 * cross-fade worth having.
 */
const TRANSITION = Platform.OS === "web" ? "none" : "slide_from_right";
