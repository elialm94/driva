import type { VerificationAttachment } from "../types";
import { isSupabaseMode } from "../storage/config";
import { tenantContext } from "../storage/context";
import { supabaseAuthAdminClient } from "../platform/supabase-admin";
import { MAX_INLINE_ATTACHMENT_BYTES } from "../inbox/attachment-content";
import {
  RECEIPT_BUCKET,
  isAllowedReceiptContentType,
  safeReceiptFilename,
  type ReceiptFileInput,
} from "./receipt-file";

/**
 * Underlaget bakom en verifikation – fakturan, kvittot eller avtalet. Samma
 * lagringsmönster som kvitton: privata bucketen `receipts` när fillagring
 * finns, annars inline med ett ärligt tak. Sökvägen ligger under `verifikat/`
 * så att arkivexporten kan skilja verifikationsunderlag från kvitton.
 *
 * Läses via /api/verifikat/[id]/bilaga efter behörighetskontroll.
 */

export const MAX_VERIFICATION_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function validateVerificationAttachment(file: ReceiptFileInput): ReceiptFileInput {
  if (!isAllowedReceiptContentType(file.contentType)) {
    throw new Error("Underlaget måste vara en bild (JPEG/PNG/WebP/HEIC) eller PDF.");
  }
  if (file.bytes.length === 0) throw new Error("Filen är tom.");
  if (file.bytes.length > MAX_VERIFICATION_ATTACHMENT_BYTES) {
    throw new Error("Underlaget är för stort (max 10 MB).");
  }
  return file;
}

/**
 * Sparar underlaget och returnerar metadata att sätta på verifikationen.
 * Anropas innan verifikationen bokförs – misslyckas lagringen bokförs
 * ingenting, så en verifikation aldrig pekar på ett underlag som inte finns.
 */
export async function storeVerificationAttachment(
  verificationId: string,
  filename: string,
  file: ReceiptFileInput
): Promise<VerificationAttachment> {
  const valid = validateVerificationAttachment(file);
  const safeName = safeReceiptFilename(filename);
  const meta: VerificationAttachment = {
    filename: safeName,
    contentType: valid.contentType,
    sizeBytes: valid.bytes.length,
  };

  const businessId = tenantContext()?.businessId;
  if (isSupabaseMode() && businessId) {
    const admin = supabaseAuthAdminClient();
    if (admin) {
      const path = `${businessId}/verifikat/${verificationId}/${safeName}`;
      const { error } = await admin.storage
        .from(RECEIPT_BUCKET)
        .upload(path, valid.bytes, { contentType: valid.contentType, upsert: true });
      if (error) {
        throw new Error(`Underlaget kunde inte sparas: ${error.message || "fillagringen svarade inte"}.`);
      }
      return { ...meta, storagePath: path };
    }
  }

  if (valid.bytes.length > MAX_INLINE_ATTACHMENT_BYTES) {
    throw new Error(
      "Underlaget är för stort för att sparas utan fillagring (max 1,5 MB). Sätt SUPABASE_SERVICE_ROLE_KEY för att aktivera bucketen."
    );
  }
  return { ...meta, contentBase64: valid.bytes.toString("base64") };
}

/** Underlagets bytes, eller undefined när filen inte finns lagrad. */
export async function verificationAttachmentContent(
  attachment: VerificationAttachment
): Promise<ReceiptFileInput | undefined> {
  const contentType = attachment.contentType || "application/octet-stream";
  if (attachment.contentBase64) {
    try {
      return { bytes: Buffer.from(attachment.contentBase64, "base64"), contentType };
    } catch {
      return undefined;
    }
  }
  if (attachment.storagePath) {
    const admin = supabaseAuthAdminClient();
    if (!admin) return undefined;
    const { data, error } = await admin.storage.from(RECEIPT_BUCKET).download(attachment.storagePath);
    if (error || !data) return undefined;
    return { bytes: Buffer.from(await data.arrayBuffer()), contentType: data.type || contentType };
  }
  return undefined;
}
