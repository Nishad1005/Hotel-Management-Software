import { Ionicons } from "@expo/vector-icons";
import {
  formatDocumentNumber,
  validateGateEntryDraft,
  type BillState,
  type GateEntryError,
  type VehicleMode,
  type VendorRef,
} from "@golai/domain";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Row, ChoiceTile, FieldError, PrimaryButton, Section, Stepper } from "../../components/ui";
import { outbox } from "../../lib/outbox";
import { useSession } from "../../lib/session";
import { drainOnce } from "../../lib/sync";
import { font, radius, space, touch, type, usePalette } from "../../theme";

/**
 * Gate 0 — Security capture. PRD section 4.
 *
 * The two-tap common path is vendor, photo, count. Everything else is optional here
 * and completed at Terminal 1, because a guard holding up a vehicle in the rain will
 * either skip an over-long form or invent answers for it.
 *
 * Not yet wired: the vendor master, the camera, and number leasing. Vendors below are
 * placeholder data and the number is generated locally so the flow can be walked and
 * timed end to end. Persistence lands with the outbox.
 */

const PLACEHOLDER_VENDORS = [
  { id: "11111111-1111-1111-1111-111111111111", code: "SB-VEN-0042", name: "Bhaskar Fish Supply" },
  { id: "22222222-2222-2222-2222-222222222222", code: "SB-VEN-0017", name: "Tinsukia Dairy" },
  { id: "33333333-3333-3333-3333-333333333333", code: "SB-VEN-0088", name: "Assam Fresh Produce" },
] as const;

const VEHICLE_OPTIONS: {
  mode: VehicleMode;
  label: string;
  icon: "car" | "bus" | "bicycle" | "cart";
}[] = [
  { mode: "TRUCK", label: "Truck", icon: "bus" },
  { mode: "TEMPO", label: "Tempo", icon: "car" },
  { mode: "TWO_WHEELER", label: "Two-wheeler", icon: "bicycle" },
  { mode: "HAND_CART", label: "Hand-cart", icon: "cart" },
];

const ERROR_TEXT: Record<GateEntryError, string> = {
  VENDOR_REQUIRED: "Choose a vendor, or enter a name for one that is not registered.",
  BILL_UNANSWERED: "Say whether there is a bill. 'No bill' is a valid answer.",
  BILL_PHOTO_MISSING: "The bill photo did not attach. Take it again.",
  PACKAGE_COUNT_REQUIRED: "Count the packages. At least one.",
  PACKAGE_COUNT_NOT_WHOLE: "Packages are counted whole.",
};

export default function NewGateEntry() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeProperty, session } = useSession();

  const [vendor, setVendor] = useState<VendorRef | null>(null);
  const [vendorLabel, setVendorLabel] = useState<string>("");
  const [bill, setBill] = useState<BillState>({ kind: "UNANSWERED" });
  const [packageCount, setPackageCount] = useState(1);
  const [vehicleMode, setVehicleMode] = useState<VehicleMode | undefined>();
  const [vehicleNumber, setVehicleNumber] = useState("");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [unregisteredName, setUnregisteredName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const draft = {
    vendor: vendor ?? { kind: "UNREGISTERED" as const, name: "" },
    bill,
    packageCount,
    arrivalType: "PO_DELIVERY" as const,
    ...(vehicleMode ? { vehicleMode } : {}),
    ...(vehicleNumber.trim() ? { vehicleNumber: vehicleNumber.trim() } : {}),
  };

  const result = validateGateEntryDraft(draft);
  // Errors appear only after an attempt. Showing them while the form is still blank
  // reads as scolding, and a guard learning the app in one shift does not need that.
  const shown = submitted ? result.errors : [];
  const has = (e: GateEntryError) => shown.includes(e);

  async function record() {
    setSubmitted(true);
    if (!validateGateEntryDraft(draft).ok) return;

    // Placeholder until number leasing lands (ADR 0005). Sequence is local and
    // meaningless; it exists so the confirmation screen can be walked.
    const sequence = Math.floor((Date.now() / 1000) % 999999) + 1;
    const gateEntryNumber = formatDocumentNumber("SB", "GE", sequence);

    // The capture is queued before the guard sees the number. If this throws, the
    // number must not be shown: an officer writing a number onto a challan for an
    // arrival that was never recorded is the one failure this whole flow exists to
    // prevent. The idempotency key is the number itself, so a retry after a crash
    // cannot produce a second arrival.
    await outbox.enqueue({
      type: "GATE_ENTRY",
      idempotencyKey: gateEntryNumber,
      payload: {
        ...draft,
        gateEntryNumber,
        capturedAt: Date.now(),
        // The capture carries its own property rather than resolving one at sync time.
        // A storekeeper covering two hotels can switch properties between capturing and
        // syncing, and the arrival belongs to where it happened.
        propertyId: activeProperty?.propertyId,
        capturedBy: session?.user.id,
      },
    });

    // Send it now if the network is there. The queue would pick it up within the
    // minute anyway, but at the gate the guard is standing next to the vehicle, and a
    // pending count that clears while they watch is what tells them it worked.
    void drainOnce();

    router.push(`/gate/recorded?number=${gateEntryNumber}`);
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <ScrollView
        contentContainerStyle={{
          padding: space.md,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl * 2,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ fontSize: type.title, ...font("bold"), color: p.text }}>New arrival</Text>
        <Text style={{ fontSize: type.label, color: p.textMuted, marginBottom: space.lg }}>
          Record what arrived before anything is unloaded.
        </Text>

        <Section title="Vendor">
          <Row
            icon={vendor ? "business" : "qr-code-outline"}
            label={vendor ? vendorLabel : "Scan card or choose vendor"}
            {...(vendor
              ? { value: vendor.kind === "REGISTERED" ? "Registered" : "Not registered" }
              : {})}
            selected={!!vendor}
            onPress={() => setPickerOpen(true)}
          />
          {has("VENDOR_REQUIRED") ? <FieldError message={ERROR_TEXT.VENDOR_REQUIRED} /> : null}
        </Section>

        <Section title="Bill" hint="A missing bill is normal. Say so rather than leaving it blank.">
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <ChoiceTile
              icon="camera"
              label="Photograph bill"
              selected={bill.kind === "PHOTOGRAPHED"}
              // Camera is not wired yet; this stands in for the capture result.
              onPress={() => setBill({ kind: "PHOTOGRAPHED", photoRef: "placeholder://bill.jpg" })}
            />
            <ChoiceTile
              icon="document-outline"
              label="No bill"
              selected={bill.kind === "NONE"}
              onPress={() => setBill({ kind: "NONE" })}
            />
          </View>
          {has("BILL_UNANSWERED") ? <FieldError message={ERROR_TEXT.BILL_UNANSWERED} /> : null}
          {has("BILL_PHOTO_MISSING") ? (
            <FieldError message={ERROR_TEXT.BILL_PHOTO_MISSING} />
          ) : null}
        </Section>

        <Section title="Packages" hint="Count packages only. Weight is Terminal 1's job.">
          <Stepper value={packageCount} onChange={setPackageCount} min={0} max={999} />
          {has("PACKAGE_COUNT_REQUIRED") ? (
            <FieldError message={ERROR_TEXT.PACKAGE_COUNT_REQUIRED} />
          ) : null}
        </Section>

        <Section title="Vehicle" hint="Optional. A hand-cart has no number.">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {VEHICLE_OPTIONS.map((v) => (
              <View key={v.mode} style={{ width: "48%" }}>
                <ChoiceTile
                  icon={v.icon}
                  label={v.label}
                  selected={vehicleMode === v.mode}
                  onPress={() => setVehicleMode(vehicleMode === v.mode ? undefined : v.mode)}
                />
              </View>
            ))}
          </View>
          {vehicleMode && vehicleMode !== "HAND_CART" ? (
            <View style={{ marginTop: space.sm }}>
              <Text style={{ fontSize: type.label, color: p.text, marginBottom: space.xs }}>
                Vehicle number
              </Text>
              <TextInput
                value={vehicleNumber}
                onChangeText={(t) => setVehicleNumber(t.toUpperCase())}
                placeholder="AS 06 AB 1234"
                placeholderTextColor={p.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                accessibilityLabel="Vehicle number"
                style={[
                  styles.input,
                  { backgroundColor: p.surface, borderColor: p.border, color: p.text },
                ]}
              />
            </View>
          ) : null}
        </Section>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: p.surface,
            borderTopColor: p.border,
            paddingBottom: insets.bottom + space.md,
          },
        ]}
      >
        <PrimaryButton label="Record arrival" icon="arrow-forward" onPress={record} />
      </View>

      <VendorPicker
        open={pickerOpen}
        name={unregisteredName}
        onChangeName={setUnregisteredName}
        onClose={() => setPickerOpen(false)}
        onPick={(ref, label) => {
          setVendor(ref);
          setVendorLabel(label);
          setPickerOpen(false);
        }}
      />
    </View>
  );
}

function VendorPicker({
  open,
  name,
  onChangeName,
  onClose,
  onPick,
}: {
  open: boolean;
  name: string;
  onChangeName: (v: string) => void;
  onClose: () => void;
  onPick: (ref: VendorRef, label: string) => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={{ flex: 1, backgroundColor: p.background, paddingTop: insets.top }}>
        <View style={[styles.modalBar, { borderBottomColor: p.border }]}>
          <Text style={{ fontSize: type.heading, ...font("bold"), color: p.text }}>
            Choose vendor
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close vendor list"
            hitSlop={12}
            style={{
              minWidth: touch.field,
              minHeight: touch.field,
              alignItems: "flex-end",
              justifyContent: "center",
            }}
          >
            <Ionicons name="close" size={30} color={p.text} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: space.md }}
          keyboardShouldPersistTaps="handled"
        >
          {PLACEHOLDER_VENDORS.map((v) => (
            <Row
              key={v.id}
              icon="business"
              label={v.name}
              value={v.code}
              // Captured by name, not as a party reference. There is no party master
              // yet, and now that these entries actually reach the server, picking one
              // of these would write a fabricated UUID into gate_entry.party_id — a
              // column with no foreign key to catch it. An unregistered vendor by name
              // is what the schema is for, and it leaves nothing to clean up when the
              // real master lands.
              onPress={() => onPick({ kind: "UNREGISTERED", name: v.name }, v.name)}
            />
          ))}

          <Text
            style={{
              fontSize: type.caption,
              ...font("bold"),
              letterSpacing: 1.2,
              textTransform: "uppercase",
              color: p.textMuted,
              marginTop: space.lg,
              marginBottom: space.sm,
            }}
          >
            Not registered
          </Text>
          <Text style={{ fontSize: type.caption, color: p.textMuted, marginBottom: space.sm }}>
            An unregistered vendor can still be received. Registration is chased later.
          </Text>
          <TextInput
            value={name}
            onChangeText={onChangeName}
            placeholder="Vendor name"
            placeholderTextColor={p.textMuted}
            accessibilityLabel="Unregistered vendor name"
            style={[
              styles.input,
              { backgroundColor: p.surface, borderColor: p.border, color: p.text },
            ]}
          />
          <View style={{ height: space.sm }} />
          <PrimaryButton
            label="Use this name"
            onPress={() => onPick({ kind: "UNREGISTERED", name: name.trim() }, name.trim())}
            disabled={name.trim().length === 0}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: touch.field,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: type.body,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: space.md,
    paddingTop: space.md,
  },
  modalBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
  },
});
