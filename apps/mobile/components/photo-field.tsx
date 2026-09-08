import { Ionicons } from "@expo/vector-icons";
import type { DocumentEntity, DocumentKind } from "@golai/db";
import { useEffect, useState } from "react";
import { Image, Pressable, View } from "react-native";
import {
  attachPhoto,
  photoCaptureAvailable,
  photoUrl,
  uploadPhoto,
  type UploadedPhoto,
} from "../lib/evidence";
import { imagePicker } from "../lib/image-pick";
import { radius, space, touch, usePalette } from "../theme";
import { FieldError, Text } from "./ui";

/**
 * Take a photograph, compress it, and file it against something.
 *
 * One control for every place the vault is written to, because the sequence is the same
 * everywhere — pick, compress under 400 KB, upload by content address, record the row —
 * and doing it per screen would produce four slightly different retry behaviours.
 *
 * ## Why the thumbnail is worth its space
 *
 * A photograph nobody looks at is a photograph nobody notices is of the floor. Showing it
 * back is what turns capture into verification, and at the dock that is the whole point:
 * criterion 18 is satisfied by a face on screen, not by bytes in a bucket.
 */
export function PhotoField({
  label,
  hint,
  propertyId,
  entityType,
  entityId,
  kind,
  /** An existing storage key, when the subject already has one. */
  existingKey,
  onAttached,
  onUploaded,
  disabled,
}: {
  label: string;
  hint?: string;
  propertyId: string;
  entityType: DocumentEntity;
  /**
   * Null when the subject does not exist yet.
   *
   * A cold-chain photograph is taken with the probe still in the fish, and its GRN line
   * is not created until the receipt posts. In that case the bytes are uploaded — so a
   * receipt that fails to post has not also lost the photograph — and handed back through
   * `onUploaded` for the caller to file once it has a line to file against.
   */
  entityId: string | null;
  kind: DocumentKind;
  existingKey?: string | null;
  onAttached?: (storageKey: string) => void;
  onUploaded?: (photo: UploadedPhoto) => void;
  disabled?: boolean;
}) {
  const p = usePalette();
  const [key, setKey] = useState<string | null>(existingKey ?? null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = imagePicker.available() && photoCaptureAvailable();

  // The URL is signed and short-lived, so it is minted when there is a key to show and
  // never stored beside it.
  useEffect(() => {
    let alive = true;
    if (!key) {
      setUrl(null);
      return;
    }
    void photoUrl(key).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  async function capture() {
    if (busy || disabled) return;
    setError(null);
    try {
      const file = await imagePicker.pick(true);
      // Null is a dismissal, not a failure. Saying nothing is the right response to
      // somebody changing their mind.
      if (!file) return;

      setBusy(true);
      if (entityId === null) {
        // Deferred: the bytes go up now, the filing waits for a subject to exist.
        const photo = await uploadPhoto(propertyId, file);
        setKey(photo.storageKey);
        onUploaded?.(photo);
      } else {
        const stored = await attachPhoto({ propertyId, entityType, entityId, kind, file });
        setKey(stored.storageKey);
        onAttached?.(stored.storageKey);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ marginBottom: space.lg }}>
      <Text role="label" weight="semibold" style={{ marginBottom: space.xs }}>
        {label}
      </Text>

      <Pressable
        onPress={() => void capture()}
        disabled={disabled || busy || !available}
        accessibilityRole="button"
        accessibilityLabel={
          key ? `Replace the photograph for ${label}` : `Take a photograph for ${label}`
        }
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          minHeight: touch.field,
          borderWidth: 1,
          borderColor: p.border,
          borderRadius: radius.md,
          backgroundColor: pressed ? p.surfaceSunken : p.surface,
          padding: space.md,
          opacity: available && !disabled ? 1 : 0.6,
        })}
      >
        {url ? (
          <Image
            source={{ uri: url }}
            style={{ width: 56, height: 56, borderRadius: radius.sm, marginRight: space.md }}
            resizeMode="cover"
            accessibilityLabel={`Photograph for ${label}`}
          />
        ) : (
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: radius.sm,
              marginRight: space.md,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: p.surfaceSunken,
            }}
          >
            <Ionicons name="camera-outline" size={22} color={p.textFaint} />
          </View>
        )}

        <View style={{ flex: 1 }}>
          <Text weight="semibold">
            {busy ? "Storing…" : key ? "Replace the photograph" : "Take a photograph"}
          </Text>
          {/*
            The unavailable case is stated rather than left as a dead button. On a build
            without a driver this is the only warning a storekeeper gets that the record
            they are about to make has no photograph on it.
          */}
          <Text role="caption" tone="muted" style={{ marginTop: 2 }}>
            {!available
              ? "Not available on this device yet."
              : (hint ?? "Compressed and stored against this record.")}
          </Text>
        </View>
      </Pressable>

      {error ? <FieldError message={error} /> : null}
    </View>
  );
}
