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
 *   * Riktigt företag i Supabase-läge med SUPABASE_SERVICE_ROLE_KEY → privata
 *     bucketen `receipts` (sökväg <business_id>/<receipt_id>/<filnamn>, samma
 *     konvention som migration 08). Tenanttillståndet bär bara metadata.
 *     Svarar bucketen med fel (nekad nyckel/RLS, nätverk) sparas filen
 *     inline i stället när den ryms – uppladdningen får aldrig kastas bort
 *     för att fillagringen krånglar. Felet loggas på servern; användaren ser
 *     aldrig Storage-/Postgres-text.
 *   * Demo (sessionens JSON-fil eller demoföretaget) → ALLTID inline base64.
 *     Demosessioner rör aldrig Supabase (se auth/session.ts) och deras
 *     tenant-id (`demo-<session>`) är inget uuid – bucketen är fel plats.
 *   * JSON-läge eller ingen service-nyckel → inline base64 på raden med
 *     samma tak som inboxbilagor. Ärligt tak i stället för tyst bortkastad
 *     fil.
 *
 * Läsning sker via /api/kvitto/[receiptId] efter withBusinessRead.
 */

export const RECEIPT_BUCKET = "receipts";
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/** Användarsäkra feltexter – aldrig rå Storage-/Postgres-text i UI:t. */
export const RECEIPT_TOO_LARGE_FOR_DEMO =
  "Kvittot är för stort för demon (max 1,5 MB). Välj en mindre fil.";
export const RECEIPT_TOO_LARGE_WITHOUT_BUCKET =
  "Kvittot är för stort för att sparas utan fillagring (max 1,5 MB). Sätt SUPABASE_SERVICE_ROLE_KEY för att aktivera bucketen.";
export const RECEIPT_STORAGE_UNAVAILABLE =
  "Kvittot kunde inte sparas i fillagringen just nu. Försök igen om en stund eller välj en fil under 1,5 MB.";
/** Speglar bucketens allowed_mime_types i migration 08. */
const RECEIPT_TYPES = /^(application\/pdf|image\/(png|jpe?g|webp|heic))$/i;

export function isAllowedReceiptContentType(contentType: string): boolean {
  return RECEIPT_TYPES.test(contentType.trim());
}

export interface ReceiptFileInput {
  bytes: Buffer;
  contentType: string;
}

/** Innehållstyp ur webbläsarens uppgift, annars ur filändelsen (HEIC/PDF rapporteras ibland tomt). */
const EXTENSION_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
};

export function receiptContentTypeFor(filename: string, reported: string | undefined): string {
  const type = (reported ?? "").trim().toLowerCase();
  if (type && type !== "application/octet-stream") return type;
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  return (ext && EXTENSION_TYPES[ext]) || type;
}

/**
 * Läser kvittot ur server actionens FormData ("file" = File/Blob). Returnerar
 * null om inget läsbart fält finns – anroparen ger ett begripligt fel.
 */
export async function receiptFileFromForm(form: FormData): Promise<(ReceiptFileInput & { filename: string }) | null> {
  const entry = form.get("file");
  if (!(entry instanceof Blob) || entry.size === 0) return null;
  const filename = (entry instanceof File && entry.name.trim()) || "kvitto";
  return {
    bytes: Buffer.from(await entry.arrayBuffer()),
    contentType: receiptContentTypeFor(filename, entry.type),
    filename,
  };
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
  const ctx = tenantContext();
  const businessId = ctx?.businessId;
  const admin = isSupabaseMode() && businessId ? supabaseAuthAdminClient() : null;
  return storeReceiptFileWith(receipt, file, {
    demo: ctx?.state.meta.demo === true,
    businessId,
    bucket: admin ? bucketUploader(admin) : null,
  });
}

/** Var filen kan hamna – separerat från miljöläsningen så att vägvalen går att testa. */
export interface ReceiptStorageTarget {
  /** Demosession/demoföretag: aldrig bucketen. */
  demo: boolean;
  businessId: string | undefined;
  /** Bucket-upload som aldrig kastar: null vid framgång, annars felbeskrivning för loggen. null = ingen bucket. */
  bucket: ((path: string, file: ReceiptFileInput) => Promise<string | null>) | null;
}

export async function storeReceiptFileWith(
  receipt: Pick<Receipt, "id" | "filename">,
  file: ReceiptFileInput,
  target: ReceiptStorageTarget
): Promise<ReceiptFileMeta> {
  const valid = validateReceiptFile(file);
  const meta: ReceiptFileMeta = { contentType: valid.contentType, sizeBytes: valid.bytes.length };
  const fitsInline = valid.bytes.length <= MAX_INLINE_ATTACHMENT_BYTES;
  const inline = (): ReceiptFileMeta => ({ ...meta, contentBase64: valid.bytes.toString("base64") });

  if (target.demo) {
    if (!fitsInline) throw new Error(RECEIPT_TOO_LARGE_FOR_DEMO);
    return inline();
  }

  if (target.bucket && target.businessId) {
    const path = `${target.businessId}/${receipt.id}/${safeReceiptFilename(receipt.filename)}`;
    const error = await target.bucket(path, valid);
    if (!error) return { ...meta, storagePath: path };
    console.error(
      `[driva:kvitto] Bucketen "${RECEIPT_BUCKET}" nekade uppladdningen (${error}). ` +
        (fitsInline ? "Filen sparas inline på kvittoraden i stället." : "Filen ryms inte inline – uppladdningen avbryts.")
    );
    if (!fitsInline) throw new Error(RECEIPT_STORAGE_UNAVAILABLE);
    return inline();
  }

  if (!fitsInline) throw new Error(RECEIPT_TOO_LARGE_WITHOUT_BUCKET);
  return inline();
}

function bucketUploader(admin: NonNullable<ReturnType<typeof supabaseAuthAdminClient>>): NonNullable<ReceiptStorageTarget["bucket"]> {
  return async (path, file) => {
    try {
      const { error } = await admin.storage
        .from(RECEIPT_BUCKET)
        .upload(path, file.bytes, { contentType: file.contentType, upsert: true });
      return error ? error.message || "fillagringen svarade inte" : null;
    } catch (e) {
      return e instanceof Error ? e.message : "fillagringen svarade inte";
    }
  };
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
