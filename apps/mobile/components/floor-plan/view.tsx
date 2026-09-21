import {
  focusDimPath,
  iso,
  locationType,
  plateAnchor,
  resolveBehavior,
  type LayoutLocationInput,
  type LayoutRoomInput,
  type PlanDataBehavior,
  type Pt,
} from "@golai/domain";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedProps } from "react-native-reanimated";
import Svg, { G, Path } from "react-native-svg";
import { radius, space } from "../../theme";
import { floorPlanEnv, frameChrome, isNightAt } from "../../theme-floor-plan";
import { Text } from "../ui";
import { BackPill, MapButton, MapHint, ReadingPin, RoomPlate } from "./overlays";
import { buildScene } from "./scene";
import { useViewBox } from "./use-viewbox";
import { useWheelZoom } from "./use-wheel-zoom";
import { FLOOR_Z } from "./visuals";

/**
 * The Living Floor Plan — the world, the overlays above it, and the gestures that move one
 * under the other.
 *
 * Two strictly separated layers, per spec §3:
 *
 *   - the **world** is one SVG whose `viewBox` never changes. Pan and zoom are a transform
 *     on the single group inside it, driven by shared values, so a gesture re-renders
 *     nothing in React and the vector scene stays sharp at every zoom.
 *   - the **overlays** are native views in screen space, placed by projecting their
 *     anchors through the same shared values. They inherit no scale, because there is
 *     none to inherit — that is the mechanical form of "labels never scale with the world".
 *
 * What this phase deliberately does not do: pins carry no readings (LFP-4), tapping a pin
 * goes nowhere (LFP-4), and the plan is not on the dashboard (LFP-5).
 */

const AnimatedG = Animated.createAnimatedComponent(G);

/** A location as the plan is handed it: the packer's input, plus what its pin reports. */
export type FloorPlanLocation = LayoutLocationInput & {
  behavior?: PlanDataBehavior | null;
};
export type FloorPlanRoom = Omit<LayoutRoomInput, "locations"> & {
  locations: FloorPlanLocation[];
};

/**
 * What a pin says it will report, in the property's words. Configuration, not telemetry:
 * it changes when the "Readings come from" selector does, and at no other time.
 */
const SOURCE_LABEL: Record<PlanDataBehavior, string> = {
  TEMPERATURE: "temperature",
  COUNT: "stock lines",
  DWELL: "dwell time",
  RETURNABLE: "returnables",
};

export interface FloorPlanViewProps {
  rooms: FloorPlanRoom[];
  /**
   * The mode this starts in. Null follows the device clock — day 06:00–17:59, night
   * otherwise. The ☾/☀ control overrides whatever this says, and once pressed it wins:
   * a caller stating a starting mode is not the same as forcing one.
   */
  night?: boolean | null;
  /** Height in pixels. The scene's aspect is preserved by the view box, not by this. */
  height?: number;
  /** Draws a ring on the floor at this location's feet, for the setup screen. */
  selectedLocationId?: string | null;
  /** The user's "show readings" preference (spec §5). Pins never show at overview either way. */
  showReadings?: boolean;
  /** Changing this to a room's id flies the view to it — the setup screen's card selection. */
  flyToRoomId?: string | null;
  /** A location tapped at detail zoom. At overview a tap flies to its room instead. */
  onSelectLocation?: (locationId: string) => void;
}

export function FloorPlanView({
  rooms,
  night = null,
  height = 420,
  selectedLocationId = null,
  showReadings = true,
  flyToRoomId = null,
  onSelectLocation,
}: FloorPlanViewProps) {
  /*
    The SURFACE is measured, not the frame.

    The frame has a border, so the space inside it is two pixels smaller each way than the
    `height` a caller asked for. Feeding the engine the frame's size while the Svg filled
    the smaller inside made the two disagree about scale by half a percent: the Svg quietly
    letterboxed itself, and pins drifted up to four pixels off their shelves towards the
    edges. Nothing looked broken — it only showed when the drawn scale was measured against
    the assumed one. Everything that needs pixels now reads them from the one view the
    world and the overlays both fill, so there is no second number to disagree with.
  */
  const [size, setSize] = useState({ w: 0, h: 0 });
  const width = size.w;
  const surfaceRef = useRef<View>(null);

  /*
    Auto until first tap — §6.

    `null` means "follow the clock"; once somebody presses the control it holds a boolean
    and stops following. Starting on the clock rather than on a stored preference is the
    right default because the scene is a picture of the property at this hour: a manager
    opening it at nine at night should see the building lit, without having asked.
  */
  const [override, setOverride] = useState<boolean | null>(null);
  const chosen = override ?? night;
  const isNight = chosen ?? isNightAt(new Date().getHours());
  const env = useMemo(() => floorPlanEnv(isNight), [isNight]);
  const chrome = useMemo(() => frameChrome(isNight), [isNight]);

  // The geometry — frame, placed rooms, scenery anchors — depends on the rooms alone, so
  // it is computed without focus or selection. The engine needs it BEFORE it can say which
  // room holds focus, and the drawn scene needs that answer; splitting the two breaks the
  // circle. Building the scene twice is cheap beside drawing it once.
  const geometry = useMemo(() => buildScene(rooms, env), [rooms, env]);

  const engine = useViewBox({
    base: geometry.base,
    width: size.w,
    height: size.h,
    rooms: geometry.rooms,
    onTapLocation: onSelectLocation,
  });

  const { elements } = useMemo(
    () => buildScene(rooms, env, selectedLocationId, engine.focusedRoomId),
    [rooms, env, selectedLocationId, engine.focusedRoomId],
  );

  useWheelZoom(surfaceRef, engine.wheel);

  // The setup screen's "selecting a card flies the preview to its room" (spec §7).
  const { flyToRoom } = engine;
  useEffect(() => {
    if (flyToRoomId) flyToRoom(flyToRoomId);
  }, [flyToRoomId, flyToRoom]);

  /*
    The world's transform: the view box, expressed as a matrix on one group.

    With the Svg's own viewBox fixed at the fitted frame F, showing the box V means mapping
    V onto F: scale by k = F.w / V.w and translate so V's corner lands on F's. A six-number
    array is react-native-svg's matrix form on native and becomes `matrix(…)` on web, so
    one shape serves both.
  */
  const worldProps = useAnimatedProps(() => {
    const f = engine.fit.value;
    const w = engine.vw.value;
    const k = w > 0 ? f.w / w : 1;
    const matrix: [number, number, number, number, number, number] = [
      k,
      0,
      0,
      k,
      f.x - engine.vx.value * k,
      f.y - engine.vy.value * k,
    ];
    return { transform: matrix };
  });

  const focusedRoom = engine.focusedRoomId
    ? (geometry.rooms.find((r) => r.id === engine.focusedRoomId) ?? null)
    : null;

  const behaviorOf = useMemo(() => {
    const map = new Map<string, PlanDataBehavior | null | undefined>();
    for (const r of rooms) for (const l of r.locations) map.set(l.id, l.behavior);
    return map;
  }, [rooms]);

  const pins = useMemo(() => {
    const out: { id: string; anchor: Pt; label: string; source: string }[] = [];
    for (const r of geometry.rooms) {
      for (const l of r.locations) {
        const entry = locationType(l.visual);
        out.push({
          id: l.id,
          anchor: iso(l.x + l.w / 2, l.y + l.d / 2, FLOOR_Z + entry.pinZ),
          label: l.name || entry.label,
          source: SOURCE_LABEL[resolveBehavior(l.visual, behaviorOf.get(l.id))],
        });
      }
    }
    return out;
  }, [geometry.rooms, behaviorOf]);

  const empty = rooms.length === 0;
  const fit = engine.fitBox;

  return (
    <View
      style={[styles.frame, { height, backgroundColor: chrome.ground, borderColor: chrome.border }]}
    >
      <View
        ref={surfaceRef}
        style={StyleSheet.absoluteFill}
        onLayout={(e: LayoutChangeEvent) => {
          const { width: w, height: h } = e.nativeEvent.layout;
          setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
        }}
      >
        {width > 0 ? (
          <GestureDetector gesture={engine.gesture}>
            <Animated.View style={StyleSheet.absoluteFill} collapsable={false}>
              <Svg width={size.w} height={size.h} viewBox={`${fit.x} ${fit.y} ${fit.w} ${fit.h}`}>
                <AnimatedG animatedProps={worldProps}>
                  {elements}
                  {focusedRoom ? (
                    // The demo's #focusDim: everything, minus the focused room's silhouette.
                    // In the world layer on purpose — it is a shape cut to the room, and has
                    // to move and scale with it.
                    <Path
                      d={focusDimPath(focusedRoom, geometry.base)}
                      fill={env.dim}
                      fillRule="evenodd"
                    />
                  ) : null}
                </AnimatedG>
              </Svg>

              {/*
                Screen space — and INSIDE the map's detector, which is the point. A touch
                that lands on a plate or a pin bubbles to the map, so a pan or a pinch can
                start anywhere, and it falls under the map's `touch-action: none`, so the
                browser does not take the touch away to scroll the page. `box-none`: the
                layer itself answers nothing; pins answer nothing; plates answer a tap.
              */}
              <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                {geometry.rooms.map((r) => (
                  <RoomPlate
                    key={`plate-${r.id}`}
                    engine={engine}
                    anchor={plateAnchor(r)}
                    roomId={r.id}
                    name={r.name}
                    onPress={engine.flyToRoom}
                  />
                ))}
                {pins.map((p) => (
                  <ReadingPin
                    key={`pin-${p.id}`}
                    engine={engine}
                    anchor={p.anchor}
                    label={p.label}
                    source={p.source}
                    enabled={showReadings}
                  />
                ))}
                <ReadingPin
                  engine={engine}
                  anchor={geometry.anchors.gate}
                  label="Gate"
                  source="open entries"
                  enabled={showReadings}
                />
                <ReadingPin
                  engine={engine}
                  anchor={geometry.anchors.dock}
                  label="Dock"
                  source="receiving"
                  enabled={showReadings}
                />
              </View>
            </Animated.View>
          </GestureDetector>
        ) : null}

        {empty ? (
          <View style={styles.empty} pointerEvents="none">
            <Text role="body" tone={isNight ? "onBrand" : "muted"} style={styles.emptyText}>
              Add a room and the plan of your property draws itself here.
            </Text>
          </View>
        ) : null}

        <BackPill engine={engine} onPress={engine.reset} />
        {!empty ? <MapHint engine={engine} chrome={chrome} touch={Platform.OS !== "web"} /> : null}

        <View style={styles.controls}>
          <MapButton
            glyph="+"
            label="Zoom in"
            chrome={chrome}
            onPress={() => engine.zoomStep("in")}
            testID="floor-plan-zoom-in"
          />
          <MapButton
            glyph={"−"}
            label="Zoom out"
            chrome={chrome}
            onPress={() => engine.zoomStep("out")}
            testID="floor-plan-zoom-out"
          />
          <MapButton
            glyph={"⌂"}
            label="Show the whole property"
            chrome={chrome}
            onPress={engine.reset}
            testID="floor-plan-fit"
          />
          <MapButton
            glyph={isNight ? "☀" : "☾"}
            label={isNight ? "Show the property by day" : "Show the property at night"}
            chrome={chrome}
            onPress={() => setOverride(!isNight)}
            testID="floor-plan-daynight"
          />
        </View>
      </View>
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
    // A drag across a label must pan the map, not select the label's text.
    userSelect: "none",
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
  controls: { position: "absolute", top: space.md, right: space.md, gap: space.sm },
});
