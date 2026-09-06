import type { InboundMailPayload } from "./inbound-mail";
import { MAX_INLINE_ATTACHMENT_BYTES, isViewableContentType } from "./attachment-content";
import { isSupabaseMode } from "../storage/config";
import { tenantContext } from "../storage/context";
import { supabaseAuthAdminClient } from "../platform/supabase-admin";

/**
 * Inboxbilagans fil.
 *
 * Bilagorna låg tidigare bara som base64 på posten. Det höll för ett kvitto
 * men inte för en bokföring: taket på 1,5 MB kastade tysta bort en inskannad
 * faktura, och en JSONB-kolumn som växer med varje mejl är fel plats för
 * megabyte. Bucketen `inbox_attachments` har funnits i schemat sedan migration
 * 13 med samma tenantpolicy som kvittobucketen – den används nu.
 *
 * Samma tvåläge som kvitton (receipts/receipt-file.ts):
 *
 *   * Supabase-läge med SUPABASE_SERVICE_ROLE_KEY → privata bucketen, sökväg
 *     <business_id>/<dokumentnyckel>/<filnamn>. Posten bär bara metadata.
 *   * Annars (JSON-läge/demo) → inline base64 med det gamla taket, för att
 *     utveckling och demo ska fungera utan fillagring.
 *
 * Bytes lagras FÖRE ingest, precis som ett kvitto lagras före kvittoraden:
 * misslyckas lagringen ska dokumentet inte finnas som en post utan innehåll.
 */

export const INBOX_BUCKET = "inbox_attachments";

/** Speglar bucketens allowed_mime_types i migration 13. */
const BUCKET_TYPES = /^(application\/pdf|image\/(png|jpe?g|webp|heic))$/i;

/** Bucketens tak (migration 13). Större filer lagras inte alls. */
export const MAX_INBOX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function safeAttachmentFilename(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
  return base || "dokument";
}

/** Bucketlagring är möjlig och påslagen. */
export function inboxBucketAvailable(): boolean {
  return isSupabaseMode() && tenantContext()?.businessId != null && supabaseAuthAdminClient() != null;
}

export interface StoredAttachment {
  /** Sökväg i bucketen, när filen ligger där. */
  storagePath?: string;
  /** Inline base64, när fillagring saknas. Aldrig båda satta. */
  contentBase64?: string;
}

/**
 * Lagrar en bilagas bytes och returnerar var de hamnade. Tomt objekt betyder
 * att innehållet inte sparades – då bär posten bara uppgifterna om dokumentet,
 * och visaren säger det rakt ut i stället för att låtsas.
 */
export async function storeInboxAttachment(
  documentKey: string,
  filename: string,
  contentType: string,
  contentBase64: string | undefined
): Promise<StoredAttachment> {
  if (!contentBase64) return {};
  const compact = contentBase64.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return {};

  if (inboxBucketAvailable() && BUCKET_TYPES.test(contentType.trim())) {
    const bytes = Buffer.from(compact, "base64");
    if (bytes.length === 0 || bytes.length > MAX_INBOX_ATTACHMENT_BYTES) return {};
    const businessId = tenantContext()!.businessId!;
    const admin = supabaseAuthAdminClient()!;
    const path = `${businessId}/${documentKey}/${safeAttachmentFilename(filename)}`;
    const { error } = await admin.storage
      .from(INBOX_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) {
      throw new Error(`Dokumentet kunde inte sparas: ${error.message || "fillagringen svarade inte"}.`);
    }
    return { storagePath: path };
  }

  // Utan bucket gäller det gamla inline-taket, och bara typer visaren klarar.
  if (!isViewableContentType(contentType)) return {};
  if (compact.length > Math.ceil((MAX_INLINE_ATTACHMENT_BYTES * 4) / 3) + 4) return {};
  return { contentBase64: compact };
}

/** Hämtar bilagans bytes ur bucketen. Undefined när filen inte går att läsa. */
export async function downloadInboxAttachment(
  storagePath: string,
  contentType: string
): Promise<{ bytes: Buffer; contentType: string } | undefined> {
  const admin = supabaseAuthAdminClient();
  if (!admin) return undefined;
  const { data, error } = await admin.storage.from(INBOX_BUCKET).download(storagePath);
  if (error || !data) return undefined;
  return { bytes: Buffer.from(await data.arrayBuffer()), contentType: data.type || contentType };
}

/**
 * Lagrar payloadens bilagor och lämnar tillbaka en payload där innehållet
 * pekar på bucketen i stället för att bäras som base64.
 *
 * Körs efter tolkningen (som behöver bytes) och före ingest. Bilagor som inte
 * gick att lagra behåller sin metadata – dokumentet ska in i inboxen även när
 * filen var för stor, för mejlet har ändå kommit.
 */
export async function persistInboundAttachments(payload: InboundMailPayload): Promise<InboundMailPayload> {
  const attachments = payload.attachments ?? [];
  if (attachments.length === 0) return payload;

  const stored = await Promise.all(
    attachments.map(async (a) => {
      const where = await storeInboxAttachment(
        payload.externalId ?? "inbox",
        a.filename,
        a.contentType,
        a.contentBase64
      );
      const { contentBase64: _dropped, ...rest } = a;
      return { ...rest, ...where };
    })
  );
  return { ...payload, attachments: stored };
}
