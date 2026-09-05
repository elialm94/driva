/**
 * Bilagornas innehåll. Två källor, i prioritetsordning:
 *
 *   1. Demodokument (storageKey "demo/…"): deterministiskt genererade PDF:er
 *      (pdf/demo-documents.ts) – alltid tillgängliga, lagras aldrig.
 *   2. Inline-lagrade bytes (contentBase64 på bilagan): små dokument från
 *      inkommande mejl/uppladdningar sparas direkt på posten så att båda
 *      lagringslägena (Supabase JSONB + lokal JSON) fungerar identiskt.
 *
 * V1-avgränsning: dokument större än taket lagras inte (bara metadata) och
 * visaren säger då ärligt att innehållet inte finns kvar – vi låtsas aldrig.
 * En riktig blob-lagring (bucket) kan ersätta källa 2 utan att routen ändras.
 */
import { demoDocumentPdf, isDemoDocumentKey } from "../pdf/demo-documents";
import type { InboxAttachment } from "../types";

/** Största bilaga som lagras inline (råbytes). Större → endast metadata. */
export const MAX_INLINE_ATTACHMENT_BYTES = 1_500_000;

/** Innehållstyper som lagras och visas i dokumentvisaren. */
const VIEWABLE_TYPES = /^(application\/pdf|image\/(png|jpe?g|webp|gif))$/i;

export function isViewableContentType(contentType: string): boolean {
  return VIEWABLE_TYPES.test(contentType.trim());
}

/** Base64 som får lagras inline – annars undefined (ärlig metadata-only). */
export function storableAttachmentContent(
  contentType: string,
  contentBase64: string | undefined
): string | undefined {
  if (!contentBase64 || !isViewableContentType(contentType)) return undefined;
  const compact = contentBase64.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return undefined;
  // Base64 är ~4/3 av råstorleken.
  if (compact.length > Math.ceil((MAX_INLINE_ATTACHMENT_BYTES * 4) / 3) + 4) return undefined;
  return compact;
}

export interface AttachmentContent {
  bytes: Buffer;
  contentType: string;
}

/**
 * Bilagans bytes utan nätanrop: demodokument och inline-lagrade poster.
 *
 * En bilaga som ligger i bucketen kräver en nedladdning och kommer därför bara
 * ur `attachmentBytes` nedan. Den här synkrona vägen finns kvar för det som
 * läser innehåll utan att kunna vänta – tolkningen och demovisaren.
 */
export function attachmentContent(attachment: InboxAttachment): AttachmentContent | undefined {
  if (isDemoDocumentKey(attachment.storageKey)) {
    const bytes = demoDocumentPdf(attachment.storageKey);
    if (bytes) return { bytes, contentType: "application/pdf" };
  }
  if (attachment.contentBase64) {
    try {
      return { bytes: Buffer.from(attachment.contentBase64, "base64"), contentType: attachment.contentType };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Bilagans bytes oavsett var de ligger: demodokument, inline eller bucketen.
 * Det här är vägen routen och arkivexporten går.
 */
export async function attachmentBytes(attachment: InboxAttachment): Promise<AttachmentContent | undefined> {
  const direct = attachmentContent(attachment);
  if (direct) return direct;
  if (!attachment.storagePath) return undefined;
  // Import här: bucketmodulen drar in Supabase-klienten, och den här filen
  // läses även av klientkod via attachmentIsViewable.
  const { downloadInboxAttachment } = await import("./attachment-file");
  return downloadInboxAttachment(attachment.storagePath, attachment.contentType);
}

/** Kan [Visa PDF]/dokumentvisaren öppna bilagan? */
export function attachmentIsViewable(attachment: InboxAttachment): boolean {
  if (isDemoDocumentKey(attachment.storageKey)) return true;
  if (!isViewableContentType(attachment.contentType)) return false;
  return Boolean(attachment.contentBase64 || attachment.storagePath);
}
