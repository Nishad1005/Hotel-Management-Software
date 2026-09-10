import type { LayoutRoomInput } from "@golai/domain";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg from "react-native-svg";
import { radius, space } from "../../theme";
import { floorPlanEnv, isNightAt } from "../../theme-floor-plan";
import { Text } from "../ui";
import { buildScene } from "./scene";

/**
 * The Living Floor Plan's world, framed.
 *
 * LFP-2: the scene at overview zoom, with no gestures and no overlays. Pan, pinch, the
 * level-of-detail ladder, name plates and reading pins are LFP-3 — so the `viewBox` here
 * is fixed to the scene's own base frame, which is exactly the overview the ladder starts
 * from. Wiring gestures to it later replaces this one prop and nothing else.
 *
 * The scene is memoised on the data and the mode. It is a few thousand SVG nodes; rebuilding
 * it on an unrelated re-render is the difference between a dashboard and a stutter.
 */

export interface FloorPlanViewProps {
  rooms: LayoutRoomInput[];
  /**
   * The mode this starts in. Null follows the device clock — day 06:00–17:59, night
   * otherwise. The ☾/☀ control overrides whatever this says, and once pressed it wins:
   * a caller stating a starting mode is not the same as forcing one.
   */
  night?: boolean | null;
  /** Height in pixels. The scene's aspect is preserved by the viewBox, not by this. */
  height?: number;
  /** Draws a ring on the floor at this location's feet, for the setup screen. */
  selectedLocationId?: string | null;
}

export function FloorPlanView({
  rooms,
  night = null,
  height = 420,
  selectedLocationId = null,
}: FloorPlanViewProps) {
  const [width, setWidth] = useState(0);

  /*
    Auto until first tap — §6.

    `null` means "follow the clock"; once somebody presses the control it holds a boolean
    and stops following. Starting on the clock rather than on a stored preference is the
    right default because the scene is a picture of the property at this hour: a manager
    opening it at nine at night should see the building lit, without having asked.
  */
  const [override, setOverride] = useState<boolean | null>(null);
  const chosen = override ?? night;

  // Read once per render rather than on a timer: nothing here needs the scene to turn
  // itself over at 18:00, and a component that re-renders on a clock is a component that
  // re-renders when nobody asked it to.
  const isNight = chosen ?? isNightAt(new Date().getHours());
  const env = useMemo(() => floorPlanEnv(isNight), [isNight]);

  const { elements, base } = useMemo(
    () => buildScene(rooms, env, selectedLocationId),
    [rooms, env, selectedLocationId],
  );

  const empty = rooms.length === 0;

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[
        styles.frame,
        {
          height,
          // The card's own ground follows the mode, so the scene does not sit on a bright
          // panel at night with a hard seam around it.
          backgroundColor: isNight ? "#08130E" : "#F3EFE4",
          borderColor: isNight ? "#16281F" : "#E0D9C6",
        },
      ]}
    >
      {width > 0 ? (
        <Svg width={width} height={height} viewBox={`${base.x} ${base.y} ${base.w} ${base.h}`}>
          {elements}
        </Svg>
      ) : null}

      {empty ? (
        <View style={styles.empty} pointerEvents="none">
          <Text role="body" tone={isNight ? "onBrand" : "muted"} style={styles.emptyText}>
            Add a room and the plan of your property draws itself here.
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => setOverride(!isNight)}
        accessibilityRole="button"
        accessibilityLabel={isNight ? "Show the property by day" : "Show the property at night"}
        testID="floor-plan-daynight"
        style={[
          styles.dayNight,
          {
            backgroundColor: isNight ? "rgba(8,28,21,0.72)" : "rgba(255,255,255,0.92)",
            borderColor: isNight ? "#2E4A3A" : "#E0D9C6",
          },
        ]}
      >
        <Text role="body" style={{ color: isNight ? "#DCB879" : "#143628" }}>
          {isNight ? "☀" : "☾"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    overflow: "hidden",
    position: "relative",
  },
  empty: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    padding: space.xl,
  },
  emptyText: { textAlign: "center", maxWidth: 320 },
  dayNight: {
    position: "absolute",
    top: space.md,
    right: space.md,
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
