import {
  DOCK_DRILL_DOWN,
  dockPin,
  drillDownFor,
  focusDimPath,
  gatePin,
  iso,
  locationType,
  plateAnchor,
  resolveBehavior,
  zonePin,
  type DrillDown,
  type LayoutLocationInput,
  type LayoutRoomInput,
  type PinText,
  type PlanDataBehavior,
  type PropertyReading,
  type Pt,
  type ZoneReading,
} from "@golai/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * The pins say what the property's data says (LFP-4): the figures arrive from one server
 * read and the words from the domain, and this component only places them. A tap on a
 * pin is reported to the host as a drill-down target; the host owns the navigation. The
 * gate pin has no target and takes no tap. What is still not here: the dashboard (LFP-5).
 */

const AnimatedG = Animated.createAnimatedComponent(G);

/** A location as the plan is handed it: the packer's input, plus what its pin reports. */
export type FloorPlanLocation = LayoutLocationInput & {
  behavior?: PlanDataBehavior | null;
  /** The location's code, which the drill-down hands to the screen it lands on. */
  code?: string;
};

/** The pins' figures, as `loadFloorPlanReadings` returns them. Null until they arrive. */
export interface FloorPlanReadingsInput {
  zones: ReadonlyMap<string, ZoneReading>;
  property: PropertyReading | null;
}
export type FloorPlanRoom = Omit<LayoutRoomInput, "locations"> & {
  locations: FloorPlanLocation[];
};

/** "09:40", in the device's locale. The DATE decision — read today or not — is the server's. */
const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

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
  /** What the pins show. Omit or pass null and every pin says "No reading yet". */
  readings?: FloorPlanReadingsInput | null;
  /** A pin was pressed. The host navigates; this component does not know the routes. */
  onDrillDown?: (target: DrillDown) => void;
}

export function FloorPlanView({
  rooms,
  night = null,
  height = 420,
  selectedLocationId = null,
  showReadings = true,
  flyToRoomId = null,
  onSelectLocation,
  readings = null,
  onDrillDown,
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

  const inputOf = useMemo(() => {
    const map = new Map<string, FloorPlanLocation>();
    for (const r of rooms) for (const l of r.locations) map.set(l.id, l);
    return map;
  }, [rooms]);

  // One press handler for every pin, keyed by target, so each pin's gesture is built once
  // and not rebuilt under a live touch when the readings refresh.
  const drill = useRef(onDrillDown);
  drill.current = onDrillDown;
  const pressers = useRef(new Map<string, () => void>());
  const presserFor = useCallback((key: string, target: DrillDown) => {
    let fn = pressers.current.get(key);
    if (!fn) {
      fn = () => drill.current?.(target);
      pressers.current.set(key, fn);
    }
    return fn;
  }, []);

  const pins = useMemo(() => {
    const out: {
      id: string;
      anchor: Pt;
      label: string;
      text: PinText;
      onPress: () => void;
      a11y: string;
    }[] = [];
    for (const r of geometry.rooms) {
      for (const l of r.locations) {
        const entry = locationType(l.visual);
        const input = inputOf.get(l.id);
        const behavior = resolveBehavior(l.visual, input?.behavior);
        const text = zonePin(
          behavior,
          readings?.zones.get(l.id) ?? null,
          readings?.property ?? null,
          formatTime,
        );
        const label = l.name || entry.label;
        const target = drillDownFor(behavior, input?.code ?? l.id);
        out.push({
          id: l.id,
          anchor: iso(l.x + l.w / 2, l.y + l.d / 2, FLOOR_Z + entry.pinZ),
          label,
          text,
          onPress: presserFor(`${behavior}:${l.id}`, target),
          a11y: `${label}: ${text.value}${text.caption ? `, ${text.caption}` : ""}. Open ${
            target.screen === "registers"
              ? "the temperature register"
              : target.screen === "stock"
                ? "what is in the store"
                : "the returnables register"
          }.`,
        });
      }
    }
    return out;
  }, [geometry.rooms, inputOf, readings, presserFor]);

  const gate = gatePin();
  const dock = dockPin(readings?.property ?? null);
  const dockPress = presserFor("dock", DOCK_DRILL_DOWN);

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
                layer itself answers nothing; plates and pins answer a tap; the gate pin
                answers nothing.
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
                    value={p.text.value}
                    tone={p.text.tone}
                    caption={p.text.caption}
                    enabled={showReadings}
                    onPress={p.onPress}
                    accessibilityLabel={p.a11y}
                  />
                ))}
                {/* No target: there is no gate log to land on, and no on-site count until
                    something records a vehicle leaving. Deaf to pointers, and says so. */}
                <ReadingPin
                  engine={engine}
                  anchor={geometry.anchors.gate}
                  label="Gate"
                  value={gate.value}
                  tone={gate.tone}
                  enabled={showReadings}
                  accessibilityLabel="Gate: no reading yet. Vehicles on site cannot be counted until departures are recorded."
                />
                <ReadingPin
                  engine={engine}
                  anchor={geometry.anchors.dock}
                  label="Dock"
                  value={dock.value}
                  tone={dock.tone}
                  enabled={showReadings}
                  onPress={dockPress}
                  accessibilityLabel={`Dock: ${dock.value}. Open receiving.`}
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
