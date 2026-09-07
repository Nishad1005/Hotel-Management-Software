import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { ImageBackground, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsExpanded } from "../lib/responsive";
import { radius, space, usePalette } from "../theme";
import { Text } from "./ui";

/**
 * The hero backdrop.
 *
 * One file, replaced by dropping a photograph of the property at the same path — the
 * swappability contract in brief §6. `require` rather than a URI because the brief also
 * forbids remote images: the Stitch export's own hero URLs are Google-hosted and expire.
 */
const HERO = require("../assets/illustrations/login-hero.png");

/**
 * The frame for the screens you see before you are anybody: sign-in, and the property
 * chooser.
 *
 * ## What was wrong with the old one
 *
 * A full-width brand band across the top with the form card pulled up over its lower edge
 * by a negative margin. On a phone that reads as intended — a coloured header, a card
 * lapping onto it. On a laptop the same markup becomes a horizontal stripe through the
 * middle of an otherwise empty page, with dead space above and below it and a 400px card
 * straddling the seam. It was one composition being asked to serve two aspect ratios it
 * could not both suit.
 *
 * ## Two compositions, one decision
 *
 * - **≥1024px** — two columns. The brand owns the left panel floor to ceiling, the form
 *   sits on the page to the right. No band, no seam, no negative margin. The width a
 *   laptop actually has is used rather than left empty.
 * - **<1024px** — one column, vertically centred, with a compact brand header above the
 *   card. Not the full panel: on a phone the identity is worth about 120px, and every
 *   pixel it takes beyond that is one the keyboard will fight for.
 *
 * The threshold is `expanded`, the same one the app shell uses — deliberately not a third
 * breakpoint. The band this leaves imperfect is 860–1024px, which is almost entirely
 * narrow desktop windows rather than the tablets and phones store staff hold: an iPad in
 * portrait is 768 or 834 and stacks either way; a 12.9" iPad in portrait is 1024 and
 * splits either way. A rare width is less handsome; the alternative is permanent config
 * surface on every responsive decision that comes after this one.
 *
 * ## 360px
 *
 * The binding case, because that is a gate phone. Everything here is proportional or
 * wrapping rather than fixed: the brand mark shrinks, the tagline wraps to two lines
 * instead of truncating, and the card's horizontal padding steps down so the inputs keep
 * their width. Nothing has a minimum that a 360px viewport cannot meet.
 */
export function AuthLayout({
  children,
  footer,
}: {
  children: ReactNode;
  /** Below the card, on the page — the "accounts are created by an administrator" note. */
  footer?: ReactNode;
}) {
  const expanded = useIsExpanded();
  const p = usePalette();
  const insets = useSafeAreaInsets();

  if (expanded) {
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: p.background }}>
        <ImageBackground
          source={HERO}
          resizeMode="cover"
          // The panel's own colour behind the image, so a slow decode or a failed load
          // shows the brand rather than a white flash against the linen page.
          style={{
            // Not a half-and-half split. The brand panel is a backdrop and the form is the
            // thing you came to use, so the form gets the larger share; 5:7 keeps the
            // panel substantial without it competing.
            flex: 5,
            backgroundColor: p.brand,
            justifyContent: "center",
            padding: space.xxxl,
            // Load-bearing on web. `ImageBackground` renders a real <img> inside its
            // container, and at `cover` that element keeps its own intrinsic width — so
            // without this the 1200px source spills across the form column and paints
            // the panel over two thirds of the page instead of five twelfths.
            overflow: "hidden",
          }}
        >
          <Brand size="full" />
        </ImageBackground>

        {/* `minWidth: 0` so a long validation message cannot push the panel off screen. */}
        <View
          style={{
            flex: 7,
            minWidth: 0,
            alignItems: "center",
            justifyContent: "center",
            padding: space.xxxl,
          }}
        >
          <View style={{ width: "100%", maxWidth: 400 }}>
            {children}
            {footer}
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: p.background }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        paddingTop: insets.top + space.xl,
        paddingBottom: insets.bottom + space.xl,
        // `space.lg` rather than `xl`: at 360px the difference is 16 points of input width,
        // which is the difference between an email address fitting and not.
        paddingHorizontal: space.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ width: "100%", maxWidth: 400, alignSelf: "center" }}>
        <View style={{ alignItems: "center", marginBottom: space.xl }}>
          <Brand size="compact" />
        </View>
        {children}
        {footer}
      </View>
    </ScrollView>
  );
}

/**
 * The mark, the name, the line.
 *
 * Two sizes rather than two components, because the only thing that varies is scale — and
 * a second copy of the wordmark is a second place for it to drift out of step with the
 * sidebar's.
 */
function Brand({ size }: { size: "full" | "compact" }) {
  const p = usePalette();
  const full = size === "full";
  const tile = full ? 72 : 52;

  return (
    // Left-aligned on the hero, centred on a phone. The reference composition ranges its
    // hero text from the left edge — centring it over a vignetted backdrop puts the
    // wordmark in the middle of the arcs and both fight for the same spot.
    <View style={{ alignItems: full ? "flex-start" : "center", maxWidth: 460 }}>
      <View
        style={{
          width: tile,
          height: tile,
          borderRadius: radius.lg,
          backgroundColor: p.accent,
          // A brass hairline, per DESIGN.md's icon badges. On the hero the tile is
          // forest-800 on a forest-900 backdrop — 1.1:1, an invisible square — and the
          // frame is the whole reason it reads as an object at all.
          borderWidth: full ? 1 : 0,
          borderColor: p.brassOnBrand,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="cube" size={Math.round(tile * 0.5)} color={p.onAccent} />
      </View>

      {/*
        `onBrand` on the panel, ordinary text on the page — the compact layout puts this on
        the cream background, where onBrand would be invisible.
      */}
      <Text
        role="display"
        tone={full ? "onBrand" : "default"}
        align={full ? "left" : "center"}
        style={{ marginTop: space.lg, letterSpacing: 1.5 }}
      >
        PARGOLAI
      </Text>
      <Text
        role="label"
        tone={full ? "onBrandMuted" : "muted"}
        weight="medium"
        align={full ? "left" : "center"}
        style={{ marginTop: space.xs, maxWidth: 260 }}
      >
        Quantity. Movement. Accountability.
      </Text>

      {/*
        The hero's one claim, and it is the product's actual thesis rather than copy
        invented for a login screen — CLAUDE.md states it in almost these words, and
        guardrail 6 rules out the reference's fictional marketing prose. Only on the wide
        panel: on a phone this space belongs to the keyboard.
      */}
      {full ? (
        <>
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              width: 88,
              backgroundColor: p.brassOnBrand,
              marginTop: space.xxl,
              marginBottom: space.lg,
              opacity: 0.7,
            }}
          />
          <Text role="title" tone="onBrand" style={{ lineHeight: 32 }}>
            The compliance register is a by-product of the work, not a second job.
          </Text>
        </>
      ) : null}
    </View>
  );
}
