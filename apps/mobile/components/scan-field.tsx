import { Ionicons } from "@expo/vector-icons";
import type { ScanMethod } from "@golai/db";
import { classifyEntry, emptyTrace, observeChange, type EntryTrace } from "@golai/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInput as TextInputRef,
} from "react-native";
import { cameraScanner } from "../lib/barcode-camera";
import { font, radius, space, touch, type, usePalette } from "../theme";
import { CloseButton, PrimaryButton } from "./ui";

/**
 * One field, three ways in: a wedge scanner, the camera, and a keyboard.
 *
 * A USB barcode scanner is a keyboard — it types the code and presses Enter — so the
 * wedge path needs no integration at all, only a focused input. That is why this is a
 * text field first and a camera second: the pilot's hardware is a wedge on the dock, and
 * the camera is what a phone has instead.
 *
 * ## It reports how, not just what
 *
 * Hard rule 13 requires a scanned destination and permits no typed one. This build allows
 * typing because the labels are not printed yet, so the honest form of that concession is
 * to record which happened rather than to ask (PRD section 2). Asking would get "yes"
 * every time.
 *
 * The classifier is in the domain package with tests, because "was that a scan" is a rule
 * and it has to hold identically on every device.
 */
export function ScanField({
  label,
  hint,
  placeholder,
  onScan,
  autoFocus = true,
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  /** Fired on Enter, on a camera read, or on the confirm button. */
  onScan: (code: string, method: ScanMethod) => void;
  autoFocus?: boolean;
}) {
  const p = usePalette();
  const input = useRef<TextInputRef>(null);
  const trace = useRef<EntryTrace>(emptyTrace());

  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let alive = true;
    void cameraScanner.available().then((ok) => {
      if (alive) setCameraReady(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const change = useCallback((next: string) => {
    trace.current = observeChange(trace.current, next, Date.now());
    setValue(next);
  }, []);

  const commit = useCallback(() => {
    const code = value.trim();
    if (!code) return;
    const method = classifyEntry(trace.current);
    trace.current = emptyTrace();
    setValue("");
    onScan(code, method);
    // Refocused rather than dismissed: put-away is a sequence of scans, and a field that
    // gives up focus after each one makes the second scan land nowhere.
    input.current?.focus();
  }, [value, onScan]);

  const fromCamera = useCallback(
    (code: string) => {
      setScanning(false);
      trace.current = emptyTrace();
      setValue("");
      onScan(code.trim(), "CAMERA");
    },
    [onScan],
  );

  // Live, so the person can see what the field currently believes before they commit it.
  const method: ScanMethod = classifyEntry(trace.current);

  return (
    <View style={{ marginBottom: space.lg }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.xs }}>
        <Text style={{ flex: 1, fontSize: type.label, ...font("semibold"), color: p.text }}>
          {label}
        </Text>
        {value.trim() ? (
          <Text
            style={{ fontSize: type.micro, ...font("semibold"), color: p.textFaint }}
            accessibilityLiveRegion="polite"
          >
            {method === "HARDWARE" ? "Scanned" : "Typed"}
          </Text>
        ) : null}
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderWidth: focused ? 2 : StyleSheet.hairlineWidth,
          borderColor: focused ? p.focus : p.border,
          borderRadius: radius.md,
          backgroundColor: p.surface,
        }}
      >
        <View
          style={{
            width: touch.field,
            height: touch.field,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="barcode-outline" size={24} color={focused ? p.focus : p.textMuted} />
        </View>

        <TextInput
          ref={input}
          value={value}
          onChangeText={change}
          onSubmitEditing={commit}
          // A wedge sends Enter at the end of the code. Without this the field eats it
          // and the whole hardware path silently does nothing.
          returnKeyType="done"
          blurOnSubmit={false}
          autoFocus={autoFocus}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          placeholder={placeholder ?? "Scan or type the label"}
          placeholderTextColor={p.textFaint}
          accessibilityLabel={label}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={
            {
              flex: 1,
              minHeight: touch.field,
              paddingRight: space.md,
              fontSize: type.heading,
              ...font("semibold"),
              letterSpacing: 0.5,
              color: p.text,
              outlineStyle: "none",
            } as never
          }
        />

        {cameraReady ? (
          <Pressable
            onPress={() => setScanning(true)}
            accessibilityRole="button"
            accessibilityLabel="Read the label with the camera"
            style={({ pressed }) => ({
              width: touch.field,
              height: touch.field,
              alignItems: "center",
              justifyContent: "center",
              borderLeftWidth: StyleSheet.hairlineWidth,
              borderLeftColor: p.border,
              backgroundColor: pressed ? p.surfaceSunken : "transparent",
              cursor: "pointer",
            })}
          >
            <Ionicons name="camera-outline" size={24} color={p.accent} />
          </Pressable>
        ) : null}
      </View>

      {hint ? (
        <Text
          style={{
            fontSize: type.caption,
            color: p.textMuted,
            marginTop: space.xs,
            lineHeight: 17,
          }}
        >
          {hint}
        </Text>
      ) : null}

      {value.trim() ? (
        <View style={{ marginTop: space.md }}>
          <PrimaryButton
            label="Use this code"
            icon="arrow-forward"
            density="field"
            onPress={commit}
          />
        </View>
      ) : null}

      <CameraSheet visible={scanning} onClose={() => setScanning(false)} onCode={fromCamera} />
    </View>
  );
}

/**
 * The camera, in a sheet that owns the device for exactly as long as it is open.
 *
 * The stream is stopped on unmount and on a successful read, not left running behind a
 * closed modal. A camera that stays on is a battery problem and, more to the point, a
 * thing a person holding the device is entitled to object to.
 */
function CameraSheet({
  visible,
  onClose,
  onCode,
}: {
  visible: boolean;
  onClose: () => void;
  onCode: (code: string) => void;
}) {
  const p = usePalette();
  const [error, setError] = useState<string | null>(null);
  const [mount, setMount] = useState<unknown>(null);

  useEffect(() => {
    if (!visible || !mount) return;
    let alive = true;
    let session: { stop: () => void } | null = null;

    void (async () => {
      try {
        const started = await cameraScanner.start(mount, (code) => {
          if (alive) onCode(code);
        });
        if (alive) session = started;
        // Resolved after the effect was torn down: stop it rather than leaking a camera
        // nobody can see.
        else started.stop();
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      alive = false;
      session?.stop();
    };
  }, [visible, mount, onCode]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingTop: space.xxxl,
            paddingHorizontal: space.lg,
            paddingBottom: space.md,
          }}
        >
          <Text style={{ flex: 1, fontSize: type.heading, ...font("semibold"), color: "#FFF" }}>
            Point at the label
          </Text>
          <CloseButton onPress={onClose} />
        </View>

        <View
          ref={(node) => setMount(node)}
          collapsable={false}
          style={{ flex: 1, overflow: "hidden", backgroundColor: "#000" }}
        />

        {error ? (
          <View style={{ padding: space.lg, backgroundColor: p.dangerSurface }}>
            <Text style={{ fontSize: type.caption, color: p.danger, lineHeight: 17 }}>{error}</Text>
          </View>
        ) : (
          <View style={{ padding: space.lg }}>
            <Text style={{ fontSize: type.caption, color: "#B9B2AA", textAlign: "center" }}>
              Hold the code inside the frame. It reads on its own.
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}
