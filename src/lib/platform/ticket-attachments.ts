/**
 * Privata supportbilagor. Uppladdning går via service role EFTER att
 * servern redan identifierat användaren. Bucketen är inte publik – Data API
 * (authenticated/anon) har inga policyer. Admin läser via signerade URL:er.
 *
 * JSON-/testläge lagrar en data-URL på ärendet (ingen Storage).
 */
import { supabaseAuthAdminClient } from "./supabase-admin";
import { isSupabaseMode } from "../storage/config";

export const SUPPORT_ATTACHMENT_BUCKET = "support_attachments";
export const TICKET_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const TICKET_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;

export type TicketAttachmentMime = (typeof TICKET_ATTACHMENT_TYPES)[number];

export function isAllowedTicketAttachmentMime(mime: string): mime is TicketAttachmentMime {
  return (TICKET_ATTACHMENT_TYPES as readonly string[]).includes(mime);
}

function safeFilename(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
  return base || "bilaga";
}

function mimeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return match?.[1] ?? "";
}

export function parseTicketAttachmentDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    return { mime: match[1], bytes: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

export async function storeSupportAttachment(input: {
  ticketId: string;
  businessId?: string;
  name: string;
  dataUrl?: string;
  bytes?: Buffer;
  mime?: string;
}): Promise<{ name: string; path?: string; dataUrl?: string }> {
  const name = safeFilename(input.name);
  let mime = input.mime ?? "";
  let bytes = input.bytes;
  if (!bytes && input.dataUrl) {
    const parsed = parseTicketAttachmentDataUrl(input.dataUrl);
    if (parsed) {
      bytes = parsed.bytes;
      mime = mime || parsed.mime;
    }
  }
  mime = mime || mimeFromDataUrl(input.dataUrl ?? "");
  if (!bytes || !isAllowedTicketAttachmentMime(mime)) {
    throw new Error("Bilagan måste vara en bild (PNG/JPEG/WebP/GIF) eller PDF.");
  }
  if (bytes.length > TICKET_ATTACHMENT_MAX_BYTES) {
    throw new Error("Bilagan är för stor (max 5 MB).");
  }

  if (isSupabaseMode()) {
    const admin = supabaseAuthAdminClient();
    if (admin) {
      const folder = input.businessId?.trim() || "_";
      const path = `${folder}/${input.ticketId}/${name}`;
      const { error } = await admin.storage.from(SUPPORT_ATTACHMENT_BUCKET).upload(path, bytes, {
        contentType: mime,
        upsert: true,
      });
      if (error) throw new Error(error.message || "Kunde inte spara bilagan.");
      return { name, path };
    }
  }

  const dataUrl =
    input.dataUrl && input.dataUrl.startsWith("data:")
      ? input.dataUrl
      : `data:${mime};base64,${bytes.toString("base64")}`;
  return { name, dataUrl };
}

export async function signedSupportAttachmentUrl(path: string, expiresSec = 60 * 10): Promise<string | null> {
  if (!path || !isSupabaseMode()) return null;
  const admin = supabaseAuthAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.storage
    .from(SUPPORT_ATTACHMENT_BUCKET)
    .createSignedUrl(path, expiresSec);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
