import { layoutFloorPlan, locationType, type LayoutRoomInput, type PlanSize } from "@golai/domain";
import { useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Text } from "./ui";
import { radius, space, usePalette } from "../theme";

/**
 * The plan, drawn from above, redrawing on every keystroke.
 *
 * **This is not the Living Floor Plan.** It is LFP-1's preview: a top-down reading of the
 * same `layoutFloorPlan()` output the isometric scene will consume in LFP-2. Building it
 * flat is a deliberate phase boundary rather than a shortcut — the isometric renderer
 * needs `react-native-svg`, which is not installed, and pulling in a dependency one phase
 * before the code that uses it would mean shipping it unexercised.
 *
 * What it does have to be is *honest about the layout*. Every position here comes from
 * the real packer, so if a room is too narrow or two locations overlap, that shows up
 * now, in the screen where a property is typing, rather than in LFP-2 under a coat of
 * isometric paint. Nothing here is a mock-up with plausible boxes.
 *
 * Scene units are metres-ish. The whole plan is scaled to the measured width, so the
 * preview is the same drawing at any size and nothing is positioned in pixels.
 */

export interface PreviewRoom extends LayoutRoomInput {
  /** Drawn with a ring, when the property has a location selected in the editor. */
  highlight?: boolean;
}

const MIN_HEIGHT = 150;
const MAX_HEIGHT = 340;

export function FloorPlanPreview({
  rooms,
  selectedLocationId,
}: {
  rooms: PreviewRoom[];
  selectedLocationId?: string | null;
}) {
  const p = usePalette();
  const [width, setWidth] = useState(0);

  const layout = useMemo(
    () =>
      layoutFloorPlan(rooms, (l) => locationType(l.visual).footprint((l.size ?? "M") as PlanSize)),
    [rooms],
  );

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  // Scale so the building spans the measured width. Height follows from the same scale,
  // clamped — a property with one small room should not get a preview two pixels tall,
  // and one with four should not get a strip taller than the editor beside it.
  const scale = width > 0 ? width / layout.buildingWidth : 0;
  const height = Math.min(Math.max(layout.buildingDepth * scale, MIN_HEIGHT), MAX_HEIGHT);

  const empty = rooms.length === 0;

  return (
    <View
      onLayout={onLayout}
      style={[styles.frame, { height, backgroundColor: p.surfaceSunken, borderColor: p.border }]}
    >
      {empty || scale === 0 ? (
        <View style={styles.empty}>
          <Text role="body" tone="muted" style={styles.emptyText}>
            {empty ? "Add a room and the plan of your property draws itself here." : ""}
          </Text>
        </View>
      ) : (
        layout.rooms.map((room) => (
          <View
            key={room.id}
            style={[
              styles.room,
              {
                left: room.x * scale,
                top: room.y * scale,
                width: room.w * scale,
                height: room.d * scale,
                borderColor: rooms.find((r) => r.id === room.id)?.highlight
                  ? p.brassLine
                  : p.border,
                backgroundColor: p.surface,
              },
            ]}
          >
            <Text role="overline" tone="muted" lines={1} style={styles.roomName}>
              {room.name || "Untitled room"}
            </Text>

            {room.locations.map((l) => {
              const selected = l.id === selectedLocationId;
              return (
                <View
                  key={l.id}
                  style={[
                    styles.location,
                    {
                      // Location coordinates are absolute in scene space; the room is
                      // already offset, so subtract it rather than laying out twice.
                      left: (l.x - room.x) * scale,
                      top: (l.y - room.y) * scale,
                      width: l.w * scale,
                      height: l.d * scale,
                      backgroundColor: selected ? p.brassSurface : p.surfaceRaised,
                      borderColor: selected ? p.brass : p.border,
                    },
                  ]}
                >
                  <Text role="caption" lines={2} style={styles.locationName}>
                    {l.name || locationType(l.visual).label}
                  </Text>
                </View>
              );
            })}
          </View>
        ))
      )}
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
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg },
  emptyText: { textAlign: "center", maxWidth: 320 },
  room: {
    position: "absolute",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  roomName: { position: "absolute", top: 4, left: 6, right: 6 },
  location: {
    position: "absolute",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: 3,
    overflow: "hidden",
  },
  locationName: { fontSize: 9, lineHeight: 11 },
});
