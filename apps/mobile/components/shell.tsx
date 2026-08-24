import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDocumentTitle } from "../lib/document-title";
import { useEscape } from "../lib/escape";
import { activeHref, navigationFor, type NavGroup, type NavItem } from "../lib/nav";
import { useIsExpanded } from "../lib/responsive";
import { useSession } from "../lib/session";
import { radius, space, touch, usePalette } from "../theme";
import { IconButton, SCRIM, Text } from "./ui";

/**
 * The frame the app lives in.
 *
 * Until now there was none: every screen was a full-viewport page whose only route out was
 * a back chevron, so getting from receiving to the item master meant unwinding to the home
 * screen and reading a list of seventeen rows. On a 1440px laptop — which is what the
 * office actually uses — that is a phone app in a browser, and the home screen was carrying
 * the entire navigation burden as a consequence.
 *
 * Two layouts, one tree:
 *
 * - **≥1024px** a persistent sidebar beside the content. Nothing overlays, nothing opens,
 *   the destination list is simply always visible.
 * - **<1024px** a slim top bar with a hamburger, and the same sidebar as a drawer. A phone
 *   has no room for 260px of permanent chrome, and the gate screen needs every pixel.
 *
 * `@react-navigation/drawer` is not installed and is not needed: this is a flex row and an
 * absolutely-positioned panel. That keeps the promise in ADR 0015's own cost note, which
 * said desktop layouts inside a React Native app "take deliberate work" rather than a
 * dependency.
 */

const SIDEBAR_WIDTH = 264;
const DRAWER_WIDTH = 288;
const TOPBAR_HEIGHT = 56;

/**
 * Overlays on the brand band, not palette entries.
 *
 * The sidebar is a single dark slab, so its hover and active states are lighter or darker
 * versions of *itself*. Those are a property of this one surface, not semantic colours the
 * rest of the app could ask for, and adding `navHover`/`navActive` to `Palette` would
 * oblige every future theme to answer a question only this component asks.
 */
const NAV_HOVER = "rgba(255, 255, 255, 0.08)";
const NAV_DIVIDER = "rgba(255, 255, 255, 0.12)";

export function AppShell({ children }: { children: ReactNode }) {
  const { activeProperty, isPlatformAdmin } = useSession();
  const expanded = useIsExpanded();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const p = usePalette();

  const groups = navigationFor(activeProperty?.roles ?? [], isPlatformAdmin);
  const current = activeHref(pathname, groups);
  useDocumentTitle(labelFor(current, groups));

  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Choosing a destination is the one thing the drawer is for, so it closes itself the
  // moment the route changes rather than making every item remember to.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  if (expanded) {
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: p.brand }}>
        <View style={{ width: SIDEBAR_WIDTH, paddingTop: insets.top }}>
          <SidebarBody groups={groups} current={current} />
        </View>
        {/*
         * `minWidth: 0` is load-bearing on web. Flex children default to `min-width: auto`,
         * which refuses to shrink below their content — so one wide table row would push
         * the sidebar off the left edge of the screen instead of scrolling itself.
         */}
        <View style={{ flex: 1, minWidth: 0, backgroundColor: p.background }}>{children}</View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <View
        style={{
          height: TOPBAR_HEIGHT + insets.top,
          paddingTop: insets.top,
          paddingHorizontal: space.sm,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          backgroundColor: p.brand,
        }}
      >
        <IconButton
          icon="menu"
          label="Open navigation"
          tone="onBrand"
          onPress={() => setDrawerOpen(true)}
        />
        <Wordmark />
      </View>

      <View style={{ flex: 1 }}>{children}</View>

      <Drawer open={drawerOpen} onClose={closeDrawer}>
        <SidebarBody groups={groups} current={current} />
      </Drawer>
    </View>
  );
}

/**
 * The sidebar, off-canvas.
 *
 * Mounted only while it is needed, so the navigation is not in the accessibility tree of
 * every phone screen behind it. It animates because a panel that simply appears reads as a
 * rendering fault rather than as a thing that arrived from the left.
 */
function Drawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const p = usePalette();

  useEscape(open, onClose);

  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.timing(anim, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== "web",
      }).start();
      return;
    }
    // Exit is quicker than entry: a panel you have asked to leave should not make you
    // watch it go.
    const exit = Animated.timing(anim, {
      toValue: 0,
      duration: 140,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: Platform.OS !== "web",
    });
    exit.start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return () => exit.stop();
  }, [open, anim]);

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: anim }}
      >
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close navigation"
          style={{ flex: 1, backgroundColor: SCRIM }}
        />
      </Animated.View>
      <Animated.View
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: DRAWER_WIDTH,
          maxWidth: "86%",
          paddingTop: insets.top,
          backgroundColor: p.brand,
          transform: [
            {
              translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [-DRAWER_WIDTH, 0] }),
            },
          ],
        }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

function SidebarBody({ groups, current }: { groups: NavGroup[]; current: string | null }) {
  const { activeProperty, properties, session, setActiveProperty, signOut } = useSession();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: space.md, paddingBottom: space.sm }}>
        <Wordmark />
      </View>

      {activeProperty ? (
        <PropertyButton
          code={activeProperty.propertyCode}
          name={activeProperty.propertyName}
          switchable={properties.length > 1}
          // Clearing the choice rather than routing to the chooser, because the guard in
          // `_layout` sends anyone who *has* a property away from `/choose-property` —
          // pushing it directly would bounce straight back here.
          onPress={() => setActiveProperty("")}
        />
      ) : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingVertical: space.sm }}
        showsVerticalScrollIndicator={false}
      >
        {groups.map((group, index) => (
          <View key={group.title || `group-${index}`} style={{ marginBottom: space.sm }}>
            {group.title ? (
              <Text
                role="overline"
                tone="onBrandMuted"
                style={{
                  paddingHorizontal: space.md,
                  paddingTop: space.sm,
                  paddingBottom: space.xs,
                }}
              >
                {group.title}
              </Text>
            ) : null}
            {group.items.map((item) => (
              <NavRow
                key={item.href}
                item={item}
                active={item.href === current}
                onPress={() => router.navigate(item.href)}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      <View
        style={{
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: NAV_DIVIDER,
          padding: space.md,
          paddingBottom: space.md + insets.bottom,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text role="label" tone="onBrand" lines={1}>
            {session?.user.email ?? "Signed in"}
          </Text>
        </View>
        <IconButton
          icon="log-out-outline"
          label="Sign out"
          tone="onBrand"
          size={20}
          onPress={() => void signOut()}
        />
      </View>
    </View>
  );
}

function Wordmark() {
  return (
    <Text role="heading" tone="onBrand" weight="heavy" style={{ letterSpacing: 1.2 }}>
      PARGOLAI
    </Text>
  );
}

/**
 * Which hotel you are looking at, stated rather than implied.
 *
 * The tenancy boundary is the property, and a group manager with four of them has no other
 * way to tell one stock list from another. It is a button only when there is a choice to
 * make; with one property it is a label, because a control that leads to a page saying
 * "you have one option" is worse than no control.
 */
function PropertyButton({
  code,
  name,
  switchable,
  onPress,
}: {
  code: string;
  name: string;
  switchable: boolean;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const p = usePalette();

  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text role="label" tone="onBrand" weight="semibold" lines={1}>
          {name}
        </Text>
        <Text role="overline" tone="onBrandMuted" lines={1}>
          {code}
        </Text>
      </View>
      {switchable ? <Ionicons name="swap-horizontal" size={16} color={p.onBrandMuted} /> : null}
    </View>
  );

  const boxed: ViewStyle = {
    marginHorizontal: space.sm,
    marginBottom: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: NAV_DIVIDER,
  };

  if (!switchable) return <View style={boxed}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Switch property. Currently ${name}`}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) =>
        ({
          ...boxed,
          backgroundColor: pressed || hovered ? NAV_HOVER : "transparent",
          cursor: "pointer",
        }) as ViewStyle
      }
    >
      {body}
    </Pressable>
  );
}

function NavRow({
  item,
  active,
  onPress,
}: {
  item: NavItem;
  active: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={item.label}
      // `selected` rather than a colour alone: a screen reader has no way to see which
      // row is lit, and colour-only meaning is exactly what the accent is not for.
      accessibilityState={{ selected: active }}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) =>
        ({
          minHeight: touch.desk,
          marginHorizontal: space.sm,
          paddingHorizontal: space.sm,
          borderRadius: radius.md,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          backgroundColor: active ? p.accent : pressed || hovered ? NAV_HOVER : "transparent",
          borderWidth: focused ? 2 : 0,
          borderColor: p.focus,
          cursor: "pointer",
        }) as ViewStyle
      }
    >
      <Ionicons name={item.icon} size={20} color={active ? p.onAccent : p.onBrandMuted} />
      <Text
        role="body"
        tone={active ? "onAccent" : "onBrand"}
        weight={active ? "semibold" : "regular"}
        lines={1}
        style={{ flex: 1 }}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

function labelFor(href: string | null, groups: readonly NavGroup[]): string | null {
  if (!href) return null;
  for (const group of groups) {
    for (const item of group.items) if (item.href === href) return item.label;
  }
  return null;
}
