import type { PlanDataBehavior, PlanSize, StorageRegime } from "@golai/db";
import {
  LOCATION_TYPES,
  MAX_LOCATIONS,
  MAX_ROOMS,
  deriveVisual,
  locationType,
  resolveBehavior,
  visualContradictsRegime,
} from "@golai/domain";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FloorPlanPreview, type PreviewRoom } from "../../components/floor-plan-preview";
import {
  Banner,
  Card,
  Field,
  Notice,
  PrimaryButton,
  Screen,
  Section,
  SelectRow,
  SkeletonList,
  Text,
  type Choice,
} from "../../components/ui";
import {
  createPlanLocation,
  createRoom,
  deleteRoom,
  loadFloorPlan,
  updateLocationPlan,
  updateRoom,
  type FloorPlan,
  type PlanLocation,
} from "../../lib/floor-plan";
import { deactivateLocation } from "../../lib/location-admin";
import { useSession } from "../../lib/session";
import { space, usePalette } from "../../theme";

/**
 * The Floor Plan step — a property describing where it keeps things, and watching the
 * plan of its own building assemble as it types.
 *
 * This creates storage zones. It is not an annotation layer over somebody else's list:
 * a location on the plan IS a row in `location` (ADR 0017), so typing "Walk-in Chiller"
 * here is the same act as adding it on the zones screen, and the two are two views of one
 * dataset rather than two datasets that will disagree by next month.
 *
 * It does **not** create bins. A bin is a scanned put-away destination under hard rule 13,
 * and a screen whose purpose is drawing a picture must not become a way to conjure
 * somewhere stock can be dumped without a label. Bins stay on the zones screen, where the
 * labels get printed.
 *
 * The regime is asked for, and it is not the same question as the picture. Regime carries
 * the rules; the visual is pre-filled from it and can be overridden for a cheese cave. A
 * disagreement between the two gets a note, never a refusal — witness before you enforce
 * (CLAUDE.md 18): "Charcuterie", "Chocolate Room" and "Cheese Cave" are real places a
 * property will legitimately want drawn as a chiller for reasons a regime cannot express.
 */

const REGIMES: Choice[] = [
  { id: "AMBIENT", label: "Ambient", sublabel: "Room temperature" },
  { id: "CHILLED", label: "Chilled", sublabel: "Above freezing, under control" },
  { id: "FROZEN", label: "Frozen", sublabel: "Below freezing" },
];

const SIZES: Choice[] = [
  { id: "S", label: "Small" },
  { id: "M", label: "Normal" },
  { id: "L", label: "Large" },
];

const BEHAVIOURS: Choice[] = [
  { id: "TEMPERATURE", label: "Temperature rounds", sublabel: "The last reading taken here" },
  { id: "COUNT", label: "Stock held", sublabel: "How many lines are on the shelves" },
  { id: "DWELL", label: "How long it has stood", sublabel: "Time since material arrived here" },
  { id: "RETURNABLE", label: "Returnables out", sublabel: "Crates and kegs not yet back" },
];

const VISUALS: Choice[] = Object.entries(LOCATION_TYPES).map(([id, entry]) => ({
  id,
  label: entry.label,
}));

export default function FloorPlanSetup() {
  const router = useRouter();
  const { activeProperty, canEditMasters } = useSession();

  const [plan, setPlan] = useState<FloorPlan>({ rooms: [], ungrouped: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // The add-a-location form, per room.
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newRegime, setNewRegime] = useState<StorageRegime>("AMBIENT");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlan(await loadFloorPlan());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Runs a write, then reloads — the server is the truth about what actually landed. */
  const commit = useCallback(
    async (work: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await work();
        setError(null);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const locationCount = useMemo(
    () => plan.rooms.reduce((n, r) => n + r.locations.length, 0) + plan.ungrouped.length,
    [plan],
  );

  /**
   * What the preview draws.
   *
   * Ungrouped zones get an implicit room rather than being left out. A property that has
   * never opened this screen still has the seven locations provisioning gave it, and
   * showing them is the difference between "here is your building" and "here is nothing,
   * start typing".
   */
  const previewRooms: PreviewRoom[] = useMemo(() => {
    const toInput = (l: PlanLocation) => ({
      id: l.id,
      name: l.name,
      visual: l.visual ?? deriveVisual("ZONE", l.regime),
      size: l.size,
    });
    const rooms: PreviewRoom[] = plan.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      locations: r.locations.map(toInput),
      highlight: r.locations.some((l) => l.id === selected),
    }));
    if (plan.ungrouped.length > 0) {
      rooms.push({
        id: "__ungrouped",
        name: "Not in a room yet",
        locations: plan.ungrouped.map(toInput),
        highlight: plan.ungrouped.some((l) => l.id === selected),
      });
    }
    return rooms;
  }, [plan, selected]);

  if (!canEditMasters) {
    return (
      <Screen title="Floor plan" onBack={() => router.back()}>
        <Notice
          icon="lock-closed-outline"
          title="Nothing here for your role"
          body="Describing where the property keeps things is an administrator's job. The plan itself is on your dashboard."
        />
      </Screen>
    );
  }

  const propertyId = activeProperty?.propertyId ?? null;
  const propertyCode = activeProperty?.propertyCode ?? null;
  const roomsFull = plan.rooms.length >= MAX_ROOMS;
  const locationsFull = locationCount >= MAX_LOCATIONS;

  return (
    <Screen
      title="Floor plan"
      subtitle="Where the property keeps things, drawn from what it already tracks"
      onBack={() => router.back()}
      wide
    >
      {error ? (
        <Banner icon="alert-circle-outline" tone="bad">
          {error}
        </Banner>
      ) : null}

      <Section
        title="Your property"
        hint="This is the same drawing the dashboard shows. It redraws as you type."
      >
        <FloorPlanPreview rooms={previewRooms} selectedLocationId={selected} />
      </Section>

      {loading ? (
        <SkeletonList rows={4} />
      ) : (
        <>
          {plan.ungrouped.length > 0 ? (
            <Section
              title="Not in a room yet"
              hint="These are drawn already. Putting them in a room only groups them."
            >
              <Card padded={false}>
                {plan.ungrouped.map((l, i) => (
                  <LocationEditor
                    key={l.id}
                    location={l}
                    rooms={plan.rooms.map((r) => ({ id: r.id, label: r.name }))}
                    divider={i < plan.ungrouped.length - 1}
                    selected={selected === l.id}
                    onSelect={() => setSelected(selected === l.id ? null : l.id)}
                    disabled={busy || !propertyId}
                    onPatch={(patch) =>
                      void commit(() => updateLocationPlan(propertyId!, l.id, patch))
                    }
                    onRetire={() => void commit(() => deactivateLocation(propertyId!, l.id))}
                  />
                ))}
              </Card>
            </Section>
          ) : null}

          {plan.rooms.map((room) => (
            <Section key={room.id}>
              <Card padded={false}>
                {/*
                  A room arrives named "Room 1" because a property should not have to name
                  something before they can see whether the idea works. The field is the
                  first thing in the card so renaming it is obvious rather than hidden
                  behind a menu.
                */}
                <View style={styles.roomHeader}>
                  <RoomNameField
                    key={`${room.id}:${room.name}`}
                    initial={room.name}
                    disabled={busy || !propertyId}
                    onRename={(name) =>
                      void commit(() => updateRoom(propertyId!, room.id, { name }))
                    }
                  />
                </View>

                {room.locations.map((l, i) => (
                  <LocationEditor
                    key={l.id}
                    location={l}
                    rooms={plan.rooms.map((r) => ({ id: r.id, label: r.name }))}
                    divider={i < room.locations.length - 1 || addingTo === room.id}
                    selected={selected === l.id}
                    onSelect={() => setSelected(selected === l.id ? null : l.id)}
                    disabled={busy || !propertyId}
                    onPatch={(patch) =>
                      void commit(() => updateLocationPlan(propertyId!, l.id, patch))
                    }
                    onRetire={() => void commit(() => deactivateLocation(propertyId!, l.id))}
                  />
                ))}

                {addingTo === room.id ? (
                  <View style={styles.addForm}>
                    <Field
                      label="What is it called?"
                      value={newName}
                      onChangeText={setNewName}
                      placeholder="Walk-in Chiller"
                      autoCapitalize="words"
                    />
                    <SelectRow
                      label="How is it kept?"
                      value={newRegime}
                      placeholder="Choose"
                      choices={REGIMES}
                      onSelect={(id) => setNewRegime(id as StorageRegime)}
                    />
                    <Text role="caption" tone="muted" style={styles.hint}>
                      This decides the rules, and pre-fills how it is drawn. You can change the
                      picture afterwards without changing how it is kept.
                    </Text>
                    <View style={styles.addActions}>
                      <PrimaryButton
                        label="Add it"
                        onPress={() => {
                          if (!propertyId || !propertyCode || !newName.trim()) return;
                          const visual = deriveVisual("ZONE", newRegime);
                          void commit(async () => {
                            await createPlanLocation({
                              propertyId,
                              propertyCode,
                              roomId: room.id,
                              name: newName,
                              regime: newRegime,
                              visual,
                              // Always set, never left to a database default: the default
                              // depends on the visual, whose meaning lives in the registry.
                              behavior: resolveBehavior(visual, null),
                              size: "M",
                            });
                            setNewName("");
                            setAddingTo(null);
                          });
                        }}
                        disabled={busy || !newName.trim() || locationsFull}
                        loading={busy}
                      />
                      <PrimaryButton
                        label="Cancel"
                        tone="neutral"
                        onPress={() => {
                          setAddingTo(null);
                          setNewName("");
                        }}
                        disabled={busy}
                      />
                    </View>
                  </View>
                ) : null}
              </Card>

              <View style={styles.roomActions}>
                <PrimaryButton
                  label="Add a location"
                  icon="add-outline"
                  tone="neutral"
                  onPress={() => {
                    setAddingTo(room.id);
                    setNewName("");
                    setNewRegime("AMBIENT");
                  }}
                  disabled={busy || locationsFull || addingTo === room.id}
                />
                <PrimaryButton
                  label="Remove room"
                  tone="danger"
                  variant="ghost"
                  onPress={() => void commit(() => deleteRoom(propertyId!, room.id))}
                  disabled={busy || !propertyId}
                />
              </View>
              <Text role="caption" tone="muted" style={styles.hint}>
                Removing a room keeps everything in it. The locations become ungrouped; nothing
                recorded against them is touched.
              </Text>
            </Section>
          ))}

          <PrimaryButton
            label="Add a room"
            icon="add-outline"
            onPress={() => {
              if (!propertyId) return;
              void commit(() =>
                createRoom(propertyId, `Room ${plan.rooms.length + 1}`, plan.rooms.length),
              );
            }}
            disabled={busy || roomsFull || !propertyId}
            loading={busy}
          />

          {roomsFull || locationsFull ? (
            <Text role="caption" tone="muted" style={styles.hint}>
              {roomsFull
                ? `The plan draws up to ${MAX_ROOMS} rooms`
                : `The plan draws up to ${MAX_LOCATIONS} locations`}{" "}
              for now. If your property needs more, tell us — it is a limit of the drawing, not of
              what the app will track, and everything beyond it is still recorded.
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

/**
 * A room's name, held locally and committed on submit.
 *
 * Local state rather than a controlled field over the server value, because saving every
 * keystroke would be a write per character and a reload per write. Keyed on the saved
 * name by the caller, so a rename that fails server-side snaps back to the truth rather
 * than leaving the screen showing something the database does not have.
 */
function RoomNameField({
  initial,
  disabled,
  onRename,
}: {
  initial: string;
  disabled: boolean;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Field
      label="Room"
      value={name}
      onChangeText={setName}
      placeholder="Main Kitchen Store"
      autoCapitalize="words"
      onSubmitEditing={() => {
        const next = name.trim();
        if (next && next !== initial && !disabled) onRename(next);
      }}
    />
  );
}

/** One location's row: what it is called, how it is kept, how it is drawn, what it reports. */
function LocationEditor({
  location,
  rooms,
  divider,
  selected,
  disabled,
  onSelect,
  onPatch,
  onRetire,
}: {
  location: PlanLocation;
  rooms: { id: string; label: string }[];
  divider: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onPatch: (patch: Parameters<typeof updateLocationPlan>[2]) => void;
  onRetire: () => void;
}) {
  const p = usePalette();
  const [name, setName] = useState(location.name);

  const visual = location.visual ?? deriveVisual("ZONE", location.regime);
  const behaviour = resolveBehavior(visual, location.behavior);
  const mismatch = visualContradictsRegime(location.visual, "ZONE", location.regime);

  return (
    <View
      style={[
        styles.row,
        divider ? { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: p.border } : null,
        selected ? { backgroundColor: p.brassSurface } : null,
      ]}
    >
      <Field
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder={locationType(visual).label}
        autoCapitalize="words"
        onSubmitEditing={() => {
          if (name.trim() && name.trim() !== location.name) onPatch({ name });
        }}
      />
      <Text role="caption" tone="faint">
        {location.code}
      </Text>

      <SelectRow
        label="Which room"
        value={location.roomId}
        placeholder="Not in a room"
        choices={rooms.map((r) => ({ id: r.id, label: r.label || "Untitled room" }))}
        onSelect={(id) => onPatch({ roomId: id })}
      />

      <SelectRow
        label="Drawn as"
        value={visual}
        placeholder="Choose"
        choices={VISUALS}
        onSelect={(id) => onPatch({ visual: id })}
      />

      {mismatch ? (
        <Text role="caption" tone="muted" style={styles.hint}>
          Drawn as a {locationType(visual).label.toLowerCase()}, but kept{" "}
          {location.regime.toLowerCase()}. That is allowed — a cheese cave is a real place — but if
          it was not deliberate, the picture is the part to change. How it is kept decides the
          rules.
        </Text>
      ) : null}

      <SelectRow
        label="Size on the plan"
        value={location.size ?? "M"}
        placeholder="Normal"
        choices={SIZES}
        onSelect={(id) => onPatch({ size: id as PlanSize })}
      />

      {/*
        The "Readings come from" selector, spec section 4b. Separate from the picture on
        purpose: a property that keeps cheese in a chiller and counts wheels rather than
        reading temperatures gets a chiller-shaped box with a stock count on it, and we
        ship nothing. Tying the number to the drawing is what would have made every such
        property need us.
      */}
      <SelectRow
        label="Readings come from"
        value={behaviour}
        placeholder="Choose"
        choices={BEHAVIOURS}
        onSelect={(id) => onPatch({ behavior: id as PlanDataBehavior })}
      />

      <View style={styles.rowActions}>
        <PrimaryButton
          label={selected ? "Done" : "Highlight"}
          tone="neutral"
          variant="ghost"
          onPress={onSelect}
          disabled={disabled}
        />
        <PrimaryButton
          label="Retire"
          tone="danger"
          variant="ghost"
          onPress={onRetire}
          disabled={disabled}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { padding: space.lg, gap: space.sm },
  roomHeader: { padding: space.lg, paddingBottom: space.sm },
  rowActions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  roomActions: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
  addForm: { padding: space.lg, gap: space.sm },
  addActions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  hint: { marginTop: space.xs },
});
