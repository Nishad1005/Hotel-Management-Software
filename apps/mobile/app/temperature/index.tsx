import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import {
  Card,
  Field,
  FieldError,
  Notice,
  PrimaryButton,
  Result,
  Screen,
  Section,
  SkeletonList,
  StatusPill,
  Text,
} from "../../components/ui";
import { useSession } from "../../lib/session";
import {
  listColdLocations,
  listStorageReadings,
  queueTemperatureReading,
  type ColdLocation,
  type StorageReading,
} from "../../lib/temperature";
import { space } from "../../theme";

/**
 * The temperature round — PRD section 7.3, the one register the flow cannot write.
 *
 * One field per cold unit, walked twice a day. A unit left blank is skipped, not
 * zeroed — a chiller under defrost has no reading, and inventing 0.0 for it would put
 * a lie on a register whose entire value is that it is what the thermometer said.
 *
 * Readings queue through the offline outbox. The cold room is the worst corner of the
 * building for signal, and a round that fails to save at the freezer door is a round
 * that stops being walked within a week. Nothing here waits for the network.
 */
export default function TemperatureRound() {
  const router = useRouter();
  const { activeProperty, session } = useSession();

  const [units, setUnits] = useState<ColdLocation[]>([]);
  const [lastByLocation, setLastByLocation] = useState<Map<string, StorageReading>>(new Map());
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [queuedCount, setQueuedCount] = useState<number | null>(null);

  const propertyId = activeProperty?.propertyId ?? null;

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      setUnits(await listColdLocations(propertyId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }

    // Today's readings, so the person walking the evening round can see the morning
    // one happened. Best-effort: offline, the round still records — this context is
    // the one thing worth losing.
    try {
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const today = await listStorageReadings(propertyId, midnight.toISOString());
      const latest = new Map<string, StorageReading>();
      for (const r of today) if (!latest.has(r.locationId)) latest.set(r.locationId, r);
      setLastByLocation(latest);
    } catch {
      setLastByLocation(new Map());
    }
  }, [propertyId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const entries = units.map((u) => ({ unit: u, raw: (values[u.id] ?? "").trim() }));
  const filled = entries.filter((e) => e.raw !== "");
  const problems = filled
    .filter((e) => !isPlausible(e.raw))
    .map(
      (e) =>
        `${e.unit.name}: "${e.raw}" is not a temperature a kitchen thermometer can read. Between -99.9 and 99.9, minus sign included.`,
    );

  async function record() {
    if (!propertyId || filled.length === 0 || problems.length > 0) return;
    setSaving(true);
    try {
      for (const e of filled) {
        await queueTemperatureReading({
          propertyId,
          locationId: e.unit.id,
          temperatureC: Number(e.raw),
          recordedBy: session?.user.id,
        });
      }
      setQueuedCount(filled.length);
      setValues({});
    } finally {
      setSaving(false);
    }
  }

  if (queuedCount !== null) {
    return (
      <Result
        eyebrow="Recorded"
        value={`${queuedCount} reading${queuedCount === 1 ? "" : "s"}`}
        caption="On the register. If the connection is down they sync by themselves — the pending count on Home is the truth."
        actions={
          <>
            <PrimaryButton
              label="Walk another round"
              icon="thermometer-outline"
              onPress={() => {
                setQueuedCount(null);
                void load();
              }}
            />
            <View style={{ height: space.sm }} />
            <PrimaryButton
              label="Open the register"
              tone="neutral"
              onPress={() => router.push("/registers")}
            />
          </>
        }
      />
    );
  }

  return (
    <Screen
      title="Temperature round"
      subtitle="Cold room and freezer, twice a day"
      onBack={() => router.back()}
    >
      {loading ? (
        <SkeletonList />
      ) : loadError ? (
        <Notice icon="cloud-offline-outline" title="Could not load" body={loadError} tone="bad" />
      ) : units.length === 0 ? (
        <Notice
          icon="thermometer-outline"
          title="No cold storage to read"
          body="The round covers every active chilled or frozen location. Mark the cold room and freezer with their regime under Setup → Locations and they appear here."
        />
      ) : (
        <>
          <Section
            title="The round"
            hint="Write what the thermometer says, minus sign and all. Leave a unit blank to skip it — a defrosting chiller has no reading, and the register does not want an invented one."
          >
            <Card>
              {units.map((u) => (
                <UnitField
                  key={u.id}
                  unit={u}
                  value={values[u.id] ?? ""}
                  last={lastByLocation.get(u.id)}
                  onChange={(v) => setValues((prev) => ({ ...prev, [u.id]: v }))}
                />
              ))}
            </Card>
          </Section>

          {problems.map((msg) => (
            <FieldError key={msg} message={msg} />
          ))}

          <PrimaryButton
            label={
              filled.length === 0
                ? "Record the round"
                : `Record ${filled.length} reading${filled.length === 1 ? "" : "s"}`
            }
            icon="checkmark"
            onPress={() => void record()}
            loading={saving}
            disabled={filled.length === 0 || problems.length > 0}
          />
        </>
      )}
    </Screen>
  );
}

function UnitField({
  unit,
  value,
  last,
  onChange,
}: {
  unit: ColdLocation;
  value: string;
  last: StorageReading | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ marginBottom: space.sm }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          marginBottom: space.xs,
        }}
      >
        <Text weight="semibold" style={{ flexShrink: 1 }}>
          {unit.name}
        </Text>
        <StatusPill
          label={unit.regime === "FROZEN" ? "Frozen" : "Chilled"}
          tone={unit.regime === "FROZEN" ? "neutral" : "good"}
        />
      </View>
      {last ? (
        <Text role="caption" tone="muted" numeric style={{ marginBottom: space.xs }}>
          Today so far: {last.temperatureC}° at{" "}
          {new Date(last.recordedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
      ) : null}
      {/*
        The full keyboard, deliberately. A freezer reads -18, and the numeric keypads
        on both mobile platforms hide or omit the minus sign — a keyboard that cannot
        express the most important readings on the round is the wrong keyboard.
      */}
      <Field
        label={unit.code}
        value={value}
        onChangeText={onChange}
        placeholder={unit.regime === "FROZEN" ? "-18.0" : "4.0"}
        suffix="°C"
      />
    </View>
  );
}

function isPlausible(raw: string): boolean {
  const n = Number(raw);
  return Number.isFinite(n) && n > -100 && n < 100;
}
