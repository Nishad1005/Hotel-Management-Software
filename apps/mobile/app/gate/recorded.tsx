import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { Banner, PrimaryButton, Result } from "../../components/ui";
import { space } from "../../theme";

/**
 * The gate entry number, immediately after capture.
 *
 * This screen exists for one physical act: the officer writes this number onto the
 * vendor's paper challan (PRD section 4 Gate 0a). That is the bridge between paper and
 * app, and it is why the number is the largest thing on the screen rather than a
 * confirmation tick. Everything else here is subordinate to reading six digits
 * correctly, at night, through a windscreen's worth of distraction.
 */
export default function GateEntryRecorded() {
  const router = useRouter();
  const { number } = useLocalSearchParams<{ number?: string }>();

  return (
    <Result
      eyebrow="Arrival recorded"
      value={number ?? "—"}
      caption="Gate entry number"
      actions={
        <>
          <PrimaryButton
            label="Record another arrival"
            icon="add"
            density="field"
            onPress={() => router.replace("/gate/new")}
          />
          <View style={{ height: space.md }} />
          <PrimaryButton label="Done" tone="neutral" onPress={() => router.replace("/")} />
        </>
      }
    >
      {/*
        The one instruction on the screen, and the whole reason the number is shown before
        anything else. A gate entry that never reaches the vendor's challan is a record with
        no paper counterpart, which is the join the entire inbound spine rests on.
      */}
      <Banner icon="create-outline" tone="warn">
        Write this number on the vendor&apos;s bill or challan now, before the vehicle moves.
      </Banner>
    </Result>
  );
}
