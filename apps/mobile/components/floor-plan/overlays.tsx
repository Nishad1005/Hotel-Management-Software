import { anchorInView, isDetail, showsBackPill, type Pt } from "@golai/domain";
import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { radius, space } from "../../theme";
import { OVERLAY, type FrameChrome } from "../../theme-floor-plan";
import { Text } from "../ui";
import type { ViewBoxEngine } from "./use-viewbox";

/**
 * The overlay layer — room name plates and reading pins, in SCREEN space.
 *
 * This file is the other half of the rule `scene.tsx` states from its side: a label must
 * never scale with the world. Everything here is an ordinary React Native view positioned
 * by projecting a drawing-space anchor through the current view box. The projection yields
 * a position and nothing else — there is no scale in it for a label to inherit — so a plate
 * is the same 11px `overline` at overview and at maximum zoom, on a phone and on a desk.
 *
 * The demo reaches the same result by counter-scaling SVG groups against measured pixels
 * on every frame. Native views in screen space are the cleaner equivalent the spec asks
 * for (§3), and they get the platform's own text rendering instead of scaled vector text.
 *
 * Positions and visibility are animated styles, so nothing here re-renders during a pan.
 *
 * **Pins carry no readings yet.** Wiring real sources is LFP-4. Until then a pin shows the
 * location's name and WHICH source it will report from — both true, both configured by the
 * property — and no value at all. Not "No reading yet" either: that is a statement about
 * the data, and with nothing wired it would be asserted over chillers that have in fact
 * been read this morning. Saying nothing is the only claim this phase can stand behind.
 */

type Engine = Pick<ViewBoxEngine, "vx" | "vy" | "vw" | "fit" | "viewW">;

/** How wide the centring row is. Wider than any label; it takes no presses of its own. */
const ROW = 420;

function useAnchorStyle(engine: Engine, anchor: Pt, kind: "plate" | "pin", enabled: boolean) {
  const [ax, ay] = anchor;
  return useAnimatedStyle(() => {
    const f = engine.fit.value;
    const w = engine.vw.value;
    const viewW = engine.viewW.value;
    if (!(w > 0) || !(viewW > 0) || !(f.w > 0)) return { display: "none" as const };

    const detail = isDetail(w, f.w);
    const box = { x: engine.vx.value, y: engine.vy.value, w, h: (w * f.h) / f.w };
    // The ladder, spec §5: plates at overview and no pins of any kind; pins at detail,
    // and only the ones in view.
    const visible =
      kind === "plate" ? !detail : detail && enabled && anchorInView(ax, ay, box, viewW);
    if (!visible) return { display: "none" as const };

    const pxPerUnit = viewW / w;
    return {
      display: "flex" as const,
      transform: [
        { translateX: (ax - box.x) * pxPerUnit },
        { translateY: (ay - box.y) * pxPerUnit },
      ],
    };
  });
}

/**
 * A room's name, standing in the corridor in front of it. Pressing it flies to the room.
 *
 * **A plate is part of the map's pointer system, not a button laid over it.** Its press is a
 * gesture-handler tap on a detector nested inside the map's, so one arbiter sees every
 * touch: a press fires on release, and the moment the same touch turns into a drag or a
 * second finger lands, the map's pan or pinch activates and cancels it. That is the demo's
 * arrangement — its plates live inside the svg that owns the pointer — and the first build
 * of this got it wrong in a way worth recording. The plate was an ordinary `Pressable` in a
 * layer beside the map, which looked identical and behaved like this: a drag that began on
 * a plate did not pan — it fired the plate on release, because the plate had travelled with
 * the world and was still under the pointer — and on a touch screen the browser, seeing a
 * touch outside the map's `touch-action: none`, cancelled it and scrolled the page. At the
 * overview the plates are the largest things on a phone's screen, so "start a pan on one"
 * is the common case, not the edge.
 *
 * The inner `Pressable` takes no pointer events at all. It is there for the two callers
 * that are not pointers — a keyboard's Enter and a screen reader's activate — and being
 * deaf to pointers is what stops one press from flying to the room twice.
 */
export function RoomPlate({
  engine,
  anchor,
  roomId,
  name,
  onPress,
}: {
  engine: Engine;
  anchor: Pt;
  roomId: string;
  name: string;
  /** Must be stable across renders: a new identity rebuilds the gesture under a live touch. */
  onPress: (roomId: string) => void;
}) {
  const anchored = useAnchorStyle(engine, anchor, "plate", true);
  const pressed = useSharedValue(0);
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(250)
        .onBegin(() => {
          pressed.value = 1;
        })
        .onEnd((_e, success) => {
          if (success) runOnJS(onPress)(roomId);
        })
        .onFinalize(() => {
          pressed.value = 0;
        }),
    [onPress, pressed, roomId],
  );
  const feedback = useAnimatedStyle(() => ({ opacity: pressed.value ? 0.85 : 1 }));

  return (
    <Animated.View pointerEvents="box-none" style={[styles.anchor, anchored]}>
      {/* Bottom edge 9px BELOW the anchor: the pointer's tip lands on the corridor spot. */}
      <View pointerEvents="box-none" style={[styles.row, { bottom: -9 }]}>
        <GestureDetector gesture={tap}>
          {/* The target is 44px tall around a 22px pill: the padding is cancelled by an equal
              negative margin, so the plate is drawn where it always was and only the area
              that answers a finger has grown. */}
          <View style={styles.plateTarget} collapsable={false}>
            <Animated.View style={[styles.plate, feedback]} testID="floor-plan-plate">
              <Pressable
                pointerEvents="none"
                onPress={() => onPress(roomId)}
                accessibilityRole="button"
                accessibilityLabel={`Look inside ${name || "this room"}`}
                style={styles.plateLabel}
              >
                <View style={styles.plateDot} />
                <Text role="overline" tone="onBrand" lines={1}>
                  {name || "Untitled room"}
                </Text>
              </Pressable>
            </Animated.View>
          </View>
        </GestureDetector>
        <View style={styles.platePointer} />
      </View>
    </Animated.View>
  );
}

/**
 * A pin standing over a location. Not pressable in this phase — drill-down is LFP-4 — so
 * it takes no pointer events at all, and a drag that begins on a pin still pans the map.
 */
export function ReadingPin({
  engine,
  anchor,
  label,
  source,
  enabled,
}: {
  engine: Engine;
  anchor: Pt;
  label: string;
  /** Which real source this pin will report from. Configuration, not telemetry. */
  source: string;
  enabled: boolean;
}) {
  const anchored = useAnchorStyle(engine, anchor, "pin", enabled);
  // The demo's truncation: past fifteen characters a name crowds its neighbours' pins.
  const short = label.length > 15 ? `${label.slice(0, 14)}…` : label;
  return (
    <Animated.View pointerEvents="none" style={[styles.anchor, anchored]}>
      <View style={styles.stem} />
      <View style={styles.stemDot} />
      {/* The pill's bottom edge sits 13px above the anchor, at the top of the stem. */}
      <View style={[styles.row, { bottom: 13 }]}>
        <View style={styles.pinHalo}>
          <View style={styles.pin} testID="floor-plan-pin">
            <View style={styles.pinTone} />
            <Text role="overline" tone="onBrand" lines={1}>
              {short}
            </Text>
            <Text role="overline" tone="onBrandMuted" lines={1}>
              {source}
            </Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

/** "← Whole property" — shown whenever the view is meaningfully zoomed in. */
export function BackPill({ engine, onPress }: { engine: Engine; onPress: () => void }) {
  const style = useAnimatedStyle(() => {
    const f = engine.fit.value;
    const on = f.w > 0 && showsBackPill(engine.vw.value, f.w);
    return { display: on ? ("flex" as const) : ("none" as const) };
  });
  return (
    <Animated.View style={[styles.backPillSlot, style]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Back to the whole property"
        testID="floor-plan-back"
        style={({ pressed }) => [styles.backPill, pressed ? { opacity: 0.85 } : null]}
      >
        <Text role="label" tone="onBrand" weight="semibold">
          {"←  Whole property"}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** The overview's one line of instruction. Gone as soon as the user has clearly found the controls. */
export function MapHint({
  engine,
  chrome,
  touch,
}: {
  engine: Engine;
  chrome: FrameChrome;
  touch: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const f = engine.fit.value;
    const zoomed = f.w > 0 && showsBackPill(engine.vw.value, f.w);
    return { display: zoomed ? ("none" as const) : ("flex" as const) };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.hint,
        { backgroundColor: chrome.hintBg, borderColor: chrome.controlBorder },
        style,
      ]}
    >
      <Text role="caption" style={{ color: chrome.controlInk }}>
        {touch
          ? "Tap a room name to look inside · pinch to zoom · drag to pan"
          : "Click a room name to look inside · scroll to zoom · drag to pan"}
      </Text>
    </Animated.View>
  );
}

/** One of the map's square controls: zoom in, zoom out, fit, day/night. */
export function MapButton({
  glyph,
  label,
  chrome,
  onPress,
  testID,
}: {
  glyph: string;
  label: string;
  chrome: FrameChrome;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(testID ? { testID } : {})}
      style={({ pressed }) => [
        styles.mapButton,
        { backgroundColor: chrome.controlBg, borderColor: chrome.controlBorder },
        pressed ? { opacity: 0.8 } : null,
      ]}
    >
      <Text role="body" weight="semibold" style={{ color: chrome.controlInk }}>
        {glyph}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A zero-size point at the projected anchor. Everything hangs off it, so moving a label
  // is one transform and its own layout never has to be measured.
  anchor: { position: "absolute", left: 0, top: 0, width: 0, height: 0 },
  // A wide row centred on the anchor; the label centres itself inside it.
  row: {
    position: "absolute",
    left: -ROW / 2,
    width: ROW,
    alignItems: "center",
  },
  // What answers a finger: the pill plus 11px above and below (44px in all) and 8px either
  // side. The negative margins give the space back, so nothing around it moves.
  plateTarget: {
    paddingVertical: 11,
    marginVertical: -11,
    paddingHorizontal: 8,
    marginHorizontal: -8,
    cursor: "pointer",
  },
  plateLabel: { flexDirection: "row", alignItems: "center", gap: 7 },
  plate: {
    flexDirection: "row",
    alignItems: "center",
    height: 22,
    paddingLeft: 9,
    paddingRight: 12,
    borderRadius: radius.pill,
    borderWidth: 1.1,
    borderColor: OVERLAY.plateBorder,
    backgroundColor: OVERLAY.plateBg,
    shadowColor: OVERLAY.plateShadow,
    shadowOffset: { width: 1.5, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  plateDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: OVERLAY.plateDot },
  // A downward triangle from borders — the one shape both platforms draw identically.
  platePointer: {
    width: 0,
    height: 0,
    marginTop: 2,
    borderLeftWidth: 4.5,
    borderRightWidth: 4.5,
    borderTopWidth: 6,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: OVERLAY.plateBorder,
  },
  stem: {
    position: "absolute",
    left: -0.5,
    bottom: 0,
    width: 1,
    height: 13,
    backgroundColor: OVERLAY.pinStem,
  },
  stemDot: {
    position: "absolute",
    left: -3.1,
    top: -3.1,
    width: 6.2,
    height: 6.2,
    borderRadius: 3.1,
    borderWidth: 1,
    borderColor: OVERLAY.pinStemDotRing,
    backgroundColor: OVERLAY.pinStem,
  },
  pinHalo: {
    borderRadius: radius.pill,
    borderWidth: 1.6,
    borderColor: OVERLAY.pinHalo,
  },
  pin: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    height: 22,
    paddingLeft: 8,
    paddingRight: 11,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: OVERLAY.pinBorder,
    backgroundColor: OVERLAY.pinBg,
  },
  pinTone: { width: 6, height: 6, borderRadius: 3, backgroundColor: OVERLAY.toneNeutral },
  backPillSlot: { position: "absolute", top: space.md, left: space.md },
  backPill: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: OVERLAY.backPillBorder,
    backgroundColor: OVERLAY.backPillBg,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: {
    position: "absolute",
    left: space.md,
    bottom: space.sm + 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  mapButton: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
