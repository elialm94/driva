import type { Receipt } from "../types";
import { isSupabaseMode } from "../storage/config";
import { tenantContext } from "../storage/context";
import { supabaseAuthAdminClient } from "../platform/supabase-admin";
import { MAX_INLINE_ATTACHMENT_BYTES } from "../inbox/attachment-content";

export { receiptFileStored } from "./receipt-meta";

/**
 * Kvittofilen bakom en Receipt-rad.
 *
 * Bokföringslagen kräver att underlaget (själva kvittot) bevaras – att bara
 * anteckna filnamnet räcker inte. Filen sparas därför alltid när ett kvitto
 * laddas upp för ett riktigt köp:
 *
 *   * Supabase-läge med SUPABASE_SERVICE_ROLE_KEY → privata bucketen
 *     `receipts` (sökväg <business_id>/<receipt_id>/<filnamn>, samma
 *     konvention som migration 08). Tenanttillståndet bär bara metadata.
 *   * Annars (JSON-läge/demo, eller ingen service-nyckel) → inline base64 på
 *     raden med samma tak som inboxbilagor. Ärligt tak i stället för tyst
 *     bortkastad fil.
 *
 * Läsning sker via /api/kvitto/[receiptId] efter withBusinessRead.
 */

export const RECEIPT_BUCKET = "receipts";
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
/** Speglar bucketens allowed_mime_types i migration 08. */
const RECEIPT_TYPES = /^(application\/pdf|image\/(png|jpe?g|webp|heic))$/i;

export function isAllowedReceiptContentType(contentType: string): boolean {
  return RECEIPT_TYPES.test(contentType.trim());
}

export interface ReceiptFileInput {
  bytes: Buffer;
  contentType: string;
}

export function parseReceiptDataUrl(dataUrl: string): ReceiptFileInput | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    return { bytes: Buffer.from(match[2], "base64"), contentType: match[1].trim().toLowerCase() };
  } catch {
    return null;
  }
}

export function safeReceiptFilename(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
  return base || "kvitto";
}

/** Validerar och normaliserar en uppladdad kvittofil – kastar begripliga fel. */
export function validateReceiptFile(file: ReceiptFileInput): ReceiptFileInput {
  if (!isAllowedReceiptContentType(file.contentType)) {
    throw new Error("Kvittot måste vara en bild (JPEG/PNG/WebP/HEIC) eller PDF.");
  }
  if (file.bytes.length === 0) throw new Error("Kvittofilen är tom.");
  if (file.bytes.length > MAX_RECEIPT_BYTES) {
    throw new Error("Kvittot är för stort (max 5 MB).");
  }
  return file;
}

/** Fält på Receipt som beskriver var filen ligger. */
export type ReceiptFileMeta = Pick<Receipt, "contentType" | "sizeBytes" | "storagePath" | "contentBase64">;

/**
 * Sparar filen och returnerar metadata att sätta på kvittoraden. Anropas
 * INNE i tenantkontexten (businessId för bucket-sökvägen) och innan commit –
 * misslyckas lagringen kastas fel och ingen kvittorad skrivs.
 */
export async function storeReceiptFile(receipt: Pick<Receipt, "id" | "filename">, file: ReceiptFileInput): Promise<ReceiptFileMeta> {
  const valid = validateReceiptFile(file);
  const meta: ReceiptFileMeta = { contentType: valid.contentType, sizeBytes: valid.bytes.length };

  const businessId = tenantContext()?.businessId;
  if (isSupabaseMode() && businessId) {
    const admin = supabaseAuthAdminClient();
    if (admin) {
      const path = `${businessId}/${receipt.id}/${safeReceiptFilename(receipt.filename)}`;
      const { error } = await admin.storage
        .from(RECEIPT_BUCKET)
        .upload(path, valid.bytes, { contentType: valid.contentType, upsert: true });
      if (error) throw new Error(`Kvittot kunde inte sparas: ${error.message || "fillagringen svarade inte"}.`);
      return { ...meta, storagePath: path };
    }
  }

  if (valid.bytes.length > MAX_INLINE_ATTACHMENT_BYTES) {
    throw new Error(
      "Kvittot är för stort för att sparas utan fillagring (max 1,5 MB). Sätt SUPABASE_SERVICE_ROLE_KEY för att aktivera bucketen."
    );
  }
  return { ...meta, contentBase64: valid.bytes.toString("base64") };
}

/** Filens bytes, eller undefined när bara uppgifterna finns lagrade. */
export async function receiptFileContent(receipt: Receipt): Promise<ReceiptFileInput | undefined> {
  const contentType = receipt.contentType || "application/octet-stream";
  if (receipt.contentBase64) {
    try {
      return { bytes: Buffer.from(receipt.contentBase64, "base64"), contentType };
    } catch {
      return undefined;
    }
  }
  if (receipt.storagePath) {
    const admin = supabaseAuthAdminClient();
    if (!admin) return undefined;
    const { data, error } = await admin.storage.from(RECEIPT_BUCKET).download(receipt.storagePath);
    if (error || !data) return undefined;
    return { bytes: Buffer.from(await data.arrayBuffer()), contentType: data.type || contentType };
  }
  return undefined;
}
