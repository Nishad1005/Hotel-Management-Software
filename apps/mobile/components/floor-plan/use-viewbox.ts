import {
  BUTTON_STEP,
  DOUBLE_TAP_FACTOR,
  FLY_MS,
  clampWidth,
  carryView,
  fitToAspect,
  focusHex,
  hitTest,
  isDetail,
  locationType,
  nearestRoomIndex,
  panFrom,
  pointInPolygon,
  roomFlyBox,
  roomFocusCentre,
  screenToWorld,
  zoomAt,
  type Box,
  type PlacedRoom,
} from "@golai/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gesture, type GestureTouchEvent } from "react-native-gesture-handler";
import {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { FLOOR_Z } from "./visuals";

/**
 * The viewBox engine — the demo's `VB`, `applyVB`, `zoomBy`, `animateTo`, `zoomToRoom`,
 * `resetView` and pointer handlers, as one hook.
 *
 * The view is three shared values: `vx`, `vy`, `vw`. There is deliberately no `vh` — the
 * view box always has the container's aspect ratio, so height is `vw × fit.h / fit.w` and
 * storing it separately would be a second copy that a bug could let drift. That lock is
 * also what makes every pixel conversion exact on both axes (see `viewbox.ts`).
 *
 * Shared values rather than React state because a pan changes them sixty times a second.
 * Nothing here re-renders during a gesture: the world moves through animated props, the
 * overlays through animated styles, and the only React state is WHICH room holds focus —
 * which changes when the view's centre crosses from one room to another, not per frame.
 */

export interface ViewBoxEngine {
  gesture: ReturnType<typeof Gesture.Simultaneous>;
  vx: SharedValue<number>;
  vy: SharedValue<number>;
  vw: SharedValue<number>;
  /** The whole property, fitted to the container's aspect. Overview IS this box. */
  fit: SharedValue<Box>;
  /**
   * The same frame as a plain value, for the `Svg`'s own `viewBox` — which stays FIXED at
   * this while the world inside it is transformed. Changing a viewBox re-renders React;
   * changing a group's transform does not.
   */
  fitBox: Box;
  viewW: SharedValue<number>;
  focusedRoomId: string | null;
  /** The +/− buttons: a step about the centre of the view. */
  zoomStep: (direction: "in" | "out") => void;
  /** The wheel: cursor-anchored. `x`/`y` in pixels within the frame. */
  wheel: (factor: number, x: number, y: number) => void;
  flyToRoom: (roomId: string) => void;
  reset: () => void;
}

const heightOf = (l: { visual: string | null }) => locationType(l.visual).pinZ;

/** The longest gap between the two taps of a double-tap. See `doubleTap` for what it costs. */
const DOUBLE_TAP_GAP_MS = 250;

export function useViewBox(args: {
  base: Box;
  width: number;
  height: number;
  rooms: readonly PlacedRoom[];
  onTapLocation?: ((locationId: string) => void) | undefined;
}): ViewBoxEngine {
  const { base, width, height, rooms, onTapLocation } = args;
  const reducedMotion = useReducedMotion();

  const fitJS = useMemo(
    () => (width > 0 && height > 0 ? fitToAspect(base, width / height) : base),
    [base, width, height],
  );

  const vx = useSharedValue(fitJS.x);
  const vy = useSharedValue(fitJS.y);
  const vw = useSharedValue(fitJS.w);
  const fit = useSharedValue<Box>(fitJS);
  const viewW = useSharedValue(width);
  const viewH = useSharedValue(height);
  /** Where a drag or a pinch began. */
  const start = useSharedValue<Box>(fitJS);
  /** The midpoint between the fingers during a pinch, in pixels within the surface. */
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const pinchScale = useSharedValue(1);
  const pinching = useSharedValue(false);
  /**
   * The room a fly-to is heading for, as an index, or -1. It lets focus — and so the dim
   * — appear the moment a plate is pressed, before the zoom has reached detail range,
   * which is what makes the fly-to read as "going to that room" rather than "zooming".
   */
  const pinned = useSharedValue(-1);

  const [focusedIndex, setFocusedIndex] = useState(-1);

  // --- a new frame: a resized container, or a room added ---------------------------
  // The view is carried across relative to the frame, so typing a room's name while
  // zoomed into it does not throw the user back to the overview on each keystroke.
  const prevFit = useRef<Box | null>(null);
  useEffect(() => {
    const from = prevFit.current;
    const next =
      from && width > 0
        ? carryView({ x: vx.value, y: vy.value, w: vw.value, h: 0 }, from, fitJS)
        : fitJS;
    fit.value = fitJS;
    viewW.value = width;
    viewH.value = height;
    vx.value = next.x;
    vy.value = next.y;
    vw.value = next.w;
    prevFit.current = width > 0 ? fitJS : null;
    // The shared values are stable containers; only the frame is a real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitJS, width, height]);

  // Flat [x0, y0, x1, y1, …] so the focus worklet captures plain numbers.
  const centres = useMemo(() => rooms.flatMap((r) => [...roomFocusCentre(r)]), [rooms]);

  // --- focus: the room nearest the centre, whenever in detail ----------------------
  useAnimatedReaction(
    () => {
      const f = fit.value;
      if (!(f.w > 0)) return -1;
      if (isDetail(vw.value, f.w)) {
        return nearestRoomIndex(centres, {
          x: vx.value,
          y: vy.value,
          w: vw.value,
          h: (vw.value * f.h) / f.w,
        });
      }
      // Out of detail range: only a fly-to in progress holds focus.
      //
      // A deliberate departure from the demo, checked in a browser rather than read off its
      // source: after "Whole property" the demo is back at the overview with #focusDim
      // still drawn, and it stays until the next pan or zoom clears it. Its reset clears
      // focus, the first half of the flight — still in detail range — re-acquires it, and
      // the last frame is applied while the animation still counts as running, which is the
      // one condition that skips the release. Spec §5 says zooming out releases focus, so
      // that is what this does; a dimmed overview is a state the spec has no name for.
      return pinned.value;
    },
    (current, previous) => {
      if (current !== previous) runOnJS(setFocusedIndex)(current);
    },
    [centres],
  );

  const stopAnimations = useCallback(() => {
    "worklet";
    cancelAnimation(vx);
    cancelAnimation(vy);
    cancelAnimation(vw);
    pinned.value = -1;
  }, [vx, vy, vw, pinned]);

  const currentBox = useCallback((): Box => {
    const f = fit.value;
    return { x: vx.value, y: vy.value, w: vw.value, h: (vw.value * f.h) / f.w };
  }, [fit, vx, vy, vw]);

  const animateTo = useCallback(
    (target: Box) => {
      const config = {
        duration: reducedMotion ? 0 : FLY_MS,
        easing: Easing.inOut(Easing.cubic),
      };
      vx.value = withTiming(target.x, config);
      vy.value = withTiming(target.y, config);
      vw.value = withTiming(target.w, config);
    },
    [reducedMotion, vx, vy, vw],
  );

  const reset = useCallback(() => {
    pinned.value = -1;
    animateTo(fit.value);
  }, [animateTo, fit, pinned]);

  const flyToRoom = useCallback(
    (roomId: string) => {
      const index = rooms.findIndex((r) => r.id === roomId);
      const f = fit.value;
      if (index < 0 || !(f.w > 0) || !(f.h > 0)) return;
      let target = fitToAspect(roomFlyBox(rooms[index]!), f.w / f.h);
      // A very small room would ask for more zoom than the clamp allows; widen about the
      // centre rather than let the animation end somewhere the next gesture snaps out of.
      const w = clampWidth(target.w, f.w);
      if (w !== target.w) {
        const h = (w * f.h) / f.w;
        target = {
          x: target.x - (w - target.w) / 2,
          y: target.y - (h - target.h) / 2,
          w,
          h,
        };
      }
      pinned.value = index;
      animateTo(target);
    },
    [animateTo, fit, pinned, rooms],
  );

  const zoomStep = useCallback(
    (direction: "in" | "out") => {
      stopAnimations();
      const next = zoomAt(
        currentBox(),
        direction === "in" ? 1 / BUTTON_STEP : BUTTON_STEP,
        0.5,
        0.5,
        fit.value.w,
      );
      vx.value = next.x;
      vy.value = next.y;
      vw.value = next.w;
    },
    [currentBox, fit, stopAnimations, vx, vy, vw],
  );

  const wheel = useCallback(
    (factor: number, x: number, y: number) => {
      if (!(viewW.value > 0) || !(viewH.value > 0)) return;
      stopAnimations();
      const next = zoomAt(currentBox(), factor, x / viewW.value, y / viewH.value, fit.value.w);
      vx.value = next.x;
      vy.value = next.y;
      vw.value = next.w;
    },
    [currentBox, fit, stopAnimations, viewH, viewW, vx, vy, vw],
  );

  // --- a tap, resolved by arithmetic ----------------------------------------------
  const focusedRoom = focusedIndex >= 0 ? (rooms[focusedIndex] ?? null) : null;
  const handleTap = useCallback(
    (px: number, py: number) => {
      if (!(viewW.value > 0)) return;
      const box = currentBox();
      const pt = screenToWorld(px, py, box, viewW.value);

      // Anywhere on the dim is "take me back" — the demo's click on #focusDim.
      if (focusedRoom && !pointInPolygon(pt, focusHex(focusedRoom))) {
        reset();
        return;
      }

      const hit = hitTest(rooms, pt, heightOf, FLOOR_Z);
      if (!hit) return;
      if (hit.kind === "location" && isDetail(box.w, fit.value.w)) {
        onTapLocation?.(hit.locationId);
        return;
      }
      // A room's floor at any zoom, or a location seen from the overview: go to the room.
      flyToRoom(hit.roomId);
    },
    [currentBox, fit, flyToRoom, focusedRoom, onTapLocation, reset, rooms, viewW],
  );

  // --- gestures ---------------------------------------------------------------------
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .maxPointers(1)
      // The demo's `dragMoved` threshold: under five pixels it is a press, not a drag.
      //
      // One difference from the demo that is the library's and not ours. The demo moves the
      // world from the first pixel and uses the threshold only to decide whether the release
      // was a click. Gesture-handler does not deliver a pan until it has travelled this far,
      // and on all three platforms it then measures `translation` from the point of
      // activation — so the world engages five pixels into a drag and tracks the finger
      // exactly from there, rather than snapping five pixels to catch up. That is the
      // library's deliberate choice (a catch-up snap reads as a stutter) and it is left alone.
      .minDistance(5)
      .onStart(() => {
        stopAnimations();
        start.value = { x: vx.value, y: vy.value, w: vw.value, h: 0 };
      })
      .onUpdate((e) => {
        const next = panFrom(start.value, e.translationX, e.translationY, viewW.value);
        vx.value = next.x;
        vy.value = next.y;
      });

    /*
      The midpoint between the fingers, from the touches themselves — NOT `e.focalX`.

      Gesture-handler 2.32 reports a pinch's focal point relative to the view on iOS and
      Android and in WINDOW coordinates on web (its web detector averages the pointers'
      absolute positions and never subtracts the view's origin). Used as given, a pinch on
      web held still a point offset from the fingers by exactly the plan's position on the
      page — (281, 149) px on the setup screen — so the map slid out from under the hand
      while it zoomed. Nothing about that looks like a coordinate bug from the outside; it
      looks like a pinch that "drifts". It was found by solving the before and after
      matrices for the point that had not moved and comparing it with where the fingers were.

      Per-touch positions are view-relative on all three platforms, so the midpoint is
      computed from those. That is right today, and stays right if the library corrects the
      web value — where subtracting the origin ourselves would then be wrong twice over.
    */
    // Measured from where the pinch began, so the fingers' spread maps to one zoom level
    // rather than compounding frame on frame.
    const applyPinch = () => {
      "worklet";
      if (!pinching.value || !(viewW.value > 0) || !(viewH.value > 0)) return;
      const next = zoomAt(
        start.value,
        1 / pinchScale.value,
        focalX.value / viewW.value,
        focalY.value / viewH.value,
        fit.value.w,
      );
      vx.value = next.x;
      vy.value = next.y;
      vw.value = next.w;
    };

    // The scale and the midpoint arrive in two callbacks, and which comes first for a given
    // movement is the library's business, not a documented contract. On web the scale leads,
    // so a zoom computed only in `onUpdate` always used the PREVIOUS event's midpoint. Both
    // callbacks therefore apply the zoom: whichever runs second has both values fresh, and
    // the last thing written for any movement is right whatever the order was.
    const trackFocal = (e: GestureTouchEvent) => {
      "worklet";
      const n = e.allTouches.length;
      if (n < 2) return;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < n; i++) {
        sx += e.allTouches[i]!.x;
        sy += e.allTouches[i]!.y;
      }
      focalX.value = sx / n;
      focalY.value = sy / n;
      applyPinch();
    };

    const pinch = Gesture.Pinch()
      .onTouchesDown(trackFocal)
      .onTouchesMove(trackFocal)
      .onStart(() => {
        stopAnimations();
        const f = fit.value;
        start.value = { x: vx.value, y: vy.value, w: vw.value, h: (vw.value * f.h) / f.w };
        pinchScale.value = 1;
        pinching.value = true;
      })
      .onUpdate((e) => {
        pinchScale.value = e.scale;
        applyPinch();
      })
      .onFinalize(() => {
        pinching.value = false;
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(250)
      // How long the second tap may take to arrive — and therefore how long EVERY single
      // tap on the map waits before it is allowed to act, since a single tap cannot know it
      // is not the first half of a double one. The library's default on web is 500 ms, and
      // measured in a browser that is what it cost: 535 ms from lifting the finger off a
      // room's floor to the view starting to move, against 25 ms for a plate. 250 ms is the
      // usual touch double-tap gap; stated here so the three platforms agree rather than
      // each bringing its own default.
      .maxDelay(DOUBLE_TAP_GAP_MS)
      .onEnd((e, success) => {
        if (!success || !(viewW.value > 0) || !(viewH.value > 0)) return;
        stopAnimations();
        const f = fit.value;
        const next = zoomAt(
          { x: vx.value, y: vy.value, w: vw.value, h: (vw.value * f.h) / f.w },
          DOUBLE_TAP_FACTOR,
          e.x / viewW.value,
          e.y / viewH.value,
          f.w,
        );
        vx.value = next.x;
        vy.value = next.y;
        vw.value = next.w;
      });

    const singleTap = Gesture.Tap()
      .maxDuration(250)
      .onEnd((e, success) => {
        if (success) runOnJS(handleTap)(e.x, e.y);
      });

    return Gesture.Simultaneous(pinch, Gesture.Race(pan, Gesture.Exclusive(doubleTap, singleTap)));
  }, [
    fit,
    focalX,
    focalY,
    handleTap,
    pinchScale,
    pinching,
    start,
    stopAnimations,
    viewH,
    viewW,
    vx,
    vy,
    vw,
  ]);

  return {
    gesture,
    vx,
    vy,
    vw,
    fit,
    fitBox: fitJS,
    viewW,
    focusedRoomId: focusedRoom?.id ?? null,
    zoomStep,
    wheel,
    flyToRoom,
    reset,
  };
}
