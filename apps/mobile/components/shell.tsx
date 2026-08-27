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
  const pageLabel = labelFor(current, groups);
  useDocumentTitle(pageLabel);

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
        {/*
          The wordmark on the landing screen, the page name everywhere else.

          A phone app bar that says the product's name on all twenty-five screens tells you
          nothing you did not know when you opened it. Deeper in, with the sidebar hidden
          behind a hamburger, the one thing worth the space is where you are — a
          storekeeper who put the phone down mid-task comes back to an answer.
        */}
        {pageLabel && pageLabel !== "Home" ? (
          <Text role="heading" tone="onBrand" lines={1} style={{ flex: 1 }}>
            {pageLabel}
          </Text>
        ) : (
          <Wordmark />
        )}
      </View>

      <View style={{ flex: 1 }}>{children}</View>

      <Drawer open={drawerOpen} onClose={closeDrawer}>
        <SidebarBody groups={groups} current={current} onClose={closeDrawer} />
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

function SidebarBody({
  groups,
  current,
  onClose,
}: {
  groups: NavGroup[];
  current: string | null;
  /** Present only in the drawer. The persistent sidebar has nothing to close. */
  onClose?: () => void;
}) {
  const { activeProperty, properties, session, setActiveProperty, signOut } = useSession();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          padding: space.md,
          paddingBottom: space.sm,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <View style={{ flex: 1 }}>
          <Wordmark />
        </View>
        {/*
          Escape and a tap on the scrim both close this, and neither is discoverable with a
          thumb. On a phone the drawer covers the screen, so the way out has to be visible.
        */}
        {onClose ? (
          <IconButton icon="close" label="Close navigation" tone="onBrand" onPress={onClose} />
        ) : null}
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
          <View
            key={group.title || `group-${index}`}
            /*
              One rhythm, set here rather than by each label's own padding.

              A group's separation from the one above it belongs to the group, not to the
              eyebrow inside it — which is why the untitled first group (Home, no label)
              used to sit at a different distance from its neighbour than every other pair.
            */
            style={{ marginTop: index === 0 ? 0 : space.lg }}
          >
            {group.title ? (
              <Text
                role="overline"
                tone="onBrandMuted"
                style={{ paddingHorizontal: space.md, paddingBottom: space.xs }}
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
          padding: space.sm,
          paddingBottom: space.sm + insets.bottom,
        }}
      >
        <Text
          role="caption"
          tone="onBrandMuted"
          lines={1}
          style={{ paddingHorizontal: space.sm, paddingBottom: space.xs }}
        >
          {session?.user.email ?? "Signed in"}
        </Text>
        {/*
          A labelled action, not a bare glyph.

          Signing out was an icon of a door with an arrow, which is only obvious once you
          already know. It is also the one control here whose consequence you cannot undo
          without your password — the last thing that should be guessed at. Full width,
          because unlike the tiles on the dashboard there is nothing beside it competing.
        */}
        <SidebarAction icon="log-out-outline" label="Sign out" onPress={() => void signOut()} />
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
  const [focused, setFocused] = useState(false);
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
      {/*
        A chevron, not a swap glyph.
        
        `swap-horizontal` is a picture of the outcome; a chevron is the convention for
        "this opens something", which is the thing a person needs to recognise without
        being taught. Absent when there is one property, because then this is a label.
      */}
      {switchable ? (
        <Ionicons name="chevron-down" size={16} color={hovered ? p.onBrand : p.onBrandMuted} />
      ) : null}
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

  // Flat and borderless with one property: an outlined box that does nothing looks like a
  // control that is broken rather than a label that is complete.
  if (!switchable)
    return <View style={{ ...boxed, borderWidth: 0, paddingHorizontal: space.md }}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Switch property. Currently ${name}`}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) =>
        ({
          ...boxed,
          backgroundColor: pressed || hovered ? NAV_HOVER : "transparent",
          borderWidth: focused ? 2 : StyleSheet.hairlineWidth,
          borderColor: focused ? p.onBrand : NAV_DIVIDER,
          cursor: "pointer",
        }) as ViewStyle
      }
    >
      {body}
    </Pressable>
  );
}

/**
 * A full-width labelled control for the sidebar's foot.
 *
 * Not `IconButton`: that is a 44px square for a glyph, and the point here is the word.
 */
function SidebarAction({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  const p = usePalette();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) =>
        ({
          minHeight: touch.desk,
          paddingHorizontal: space.sm,
          borderRadius: radius.md,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          backgroundColor: pressed || hovered ? NAV_HOVER : "transparent",
          borderWidth: focused ? 2 : 0,
          borderColor: p.onBrand,
          cursor: "pointer",
        }) as ViewStyle
      }
    >
      <Ionicons name={icon} size={18} color={p.onBrandMuted} />
      <Text role="body" tone="onBrand" weight="medium">
        {label}
      </Text>
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
          // Cream, not `p.focus`: the rows stand on the brand band, where the dark ring
          // measures 2.88:1 and this measures 14.42:1.
          borderColor: p.onBrand,
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
