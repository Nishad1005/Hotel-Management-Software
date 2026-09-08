import type { DocumentEntity, DocumentKind } from "@golai/db";
import { preparePhoto, photoCaptureAvailable } from "./photo";
import { requireSupabase } from "./supabase";

/**
 * Putting a photograph into the vault, and getting one back out.
 *
 * Two steps, in this order and not the other: upload the bytes, then record the row. An
 * interrupted capture then leaves an orphan object, which is invisible and costs a few
 * hundred kilobytes. The other order leaves a row pointing at nothing — a photograph the
 * register tells an inspector exists, and which cannot be produced.
 *
 * Both steps are safe to repeat. The object key is the content address, so re-uploading
 * the same bytes overwrites itself with identical content; `attach_document` treats the
 * same address against the same subject as the retry it is.
 */

const BUCKET = "evidence";

export { photoCaptureAvailable };

export interface StoredPhoto {
  documentId: string;
  storageKey: string;
}

export async function attachPhoto(input: {
  propertyId: string;
  entityType: DocumentEntity;
  entityId: string;
  kind: DocumentKind;
  file: Blob;
}): Promise<StoredPhoto> {
  const client = requireSupabase();
  const prepared = await preparePhoto(input.file);

  // `{property_id}/{sha256}` — the shape the storage policies check, first segment being
  // the property a member must belong to.
  const key = `${input.propertyId}/${prepared.sha256}`;

  const { error: uploadError } = await client.storage.from(BUCKET).upload(key, prepared.blob, {
    contentType: prepared.mimeType,
    // The same bytes produce the same key, so an overwrite is a retry writing identical
    // content. Refusing it would turn a dropped connection into a permanent failure.
    upsert: true,
  });

  if (uploadError) throw new Error(friendlyUpload(uploadError.message));

  const { data, error } = await client.rpc("attach_document", {
    p_property_id: input.propertyId,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_kind: input.kind,
    p_sha256: prepared.sha256,
    p_mime_type: prepared.mimeType,
    p_byte_size: prepared.byteSize,
  });

  if (error) throw new Error(error.message);
  if (!data) throw new Error("The photograph uploaded but was not filed. Try attaching it again.");

  return { documentId: data as string, storageKey: key };
}

export interface VaultDocument {
  id: string;
  kind: DocumentKind;
  storageKey: string;
  mimeType: string;
  capturedAt: string;
}

export async function listDocuments(input: {
  propertyId: string;
  entityType: DocumentEntity;
  entityId: string;
}): Promise<VaultDocument[]> {
  const { data, error } = await requireSupabase().rpc("list_documents", {
    p_property_id: input.propertyId,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((d) => ({
    id: d.id,
    kind: d.kind,
    storageKey: d.storage_key,
    mimeType: d.mime_type,
    capturedAt: d.captured_at,
  }));
}

/**
 * A URL the browser can show, minted when it is needed.
 *
 * Signed and short-lived rather than stored, because the bucket is private and a URL that
 * lived in a row would either expire inside a record meant to outlive it or, if made
 * permanent, publish every face to anyone who found the pattern.
 */
export async function photoUrl(storageKey: string, seconds = 300): Promise<string | null> {
  const { data, error } = await requireSupabase()
    .storage.from(BUCKET)
    .createSignedUrl(storageKey, seconds);

  if (error) return null;
  return data?.signedUrl ?? null;
}

function friendlyUpload(message: string): string {
  if (/exceeded the maximum allowed size|payload too large/i.test(message))
    return "That photograph is too large to store even after compressing. Take it again with less in frame.";
  if (/row-level security|not authorized|403/i.test(message))
    return "You cannot store evidence at this property.";
  if (/bucket not found/i.test(message))
    return "This build is talking to a database that has no evidence vault yet. The migration has not been deployed.";
  return message;
}
