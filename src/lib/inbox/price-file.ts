/**
 * Prisfil i inboxen: identifiera och förhandsgranska utan LLM.
 * Aktiveras bara när användaren trycker Använd nya priser.
 */
import type { InboxItem, WholesalerConnection } from "../types";
import { parsePriceFile } from "../wholesalers/import-engine";
import { db } from "../store";
import { connectionLabel } from "../wholesalers/labels";
import { attachmentContent } from "./attachment-content";

const PRICE_EXT = /\.(csv|txt|tsv|xlsx|xls|xml|zip)$/i;

export function looksLikePriceFile(filename: string, contentType?: string): boolean {
  if (PRICE_EXT.test(filename)) return true;
  const t = (contentType ?? "").toLowerCase();
  return /spreadsheet|excel|csv|zip/.test(t);
}

/** Inline-bytes för prisfiler. Ingen LLM. Tak 8 MB. */
export function storablePriceFileContent(
  filename: string,
  contentType: string | undefined,
  contentBase64: string | undefined
): string | undefined {
  if (!contentBase64 || !looksLikePriceFile(filename, contentType)) return undefined;
  const compact = contentBase64.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return undefined;
  if (compact.length > Math.ceil((8 * 1024 * 1024 * 4) / 3) + 4) return undefined;
  return compact;
}

export function identifyInboxPriceConnection(item: InboxItem): {
  connection?: WholesalerConnection;
  uncertain: boolean;
  reason: string;
} {
  const connections = (db().wholesalerConnections ?? []).filter((c) => c.active);
  if (connections.length === 0) {
    return { uncertain: true, reason: "Ingen aktiv grossistanslutning." };
  }
  const from = item.fromAddress.toLowerCase();
  const name = (item.subject + " " + item.attachments.map((a) => a.filename).join(" ")).toLowerCase();
  const hits = connections.filter((c) => {
    const label = connectionLabel(c).toLowerCase();
    const email = c.orderEmail.toLowerCase();
    const domain = email.includes("@") ? email.slice(email.lastIndexOf("@")) : "";
    return (
      (domain && from.includes(domain)) ||
      (label && name.includes(label)) ||
      (c.wholesaler && name.includes(c.wholesaler))
    );
  });
  if (hits.length === 1) {
    return { connection: hits[0], uncertain: false, reason: `Matchade ${connectionLabel(hits[0])}` };
  }
  return { uncertain: true, reason: "Osäker matchning - välj grossist själv. Ny anslutning skapas inte." };
}

export function previewInboxPriceAttachment(bytes: Buffer, filename: string) {
  return parsePriceFile(bytes, filename);
}

export function inboxItemPriceFile(item: InboxItem) {
  const attachment = item.attachments.find((a) => looksLikePriceFile(a.filename, a.contentType));
  if (!attachment) return null;
  const identified = identifyInboxPriceConnection(item);
  const content = attachmentContent(attachment);
  let preview: ReturnType<typeof previewInboxPriceAttachment> | undefined;
  let previewError: string | undefined;
  if (content) {
    try {
      preview = previewInboxPriceAttachment(content.bytes, attachment.filename);
    } catch (e) {
      previewError = e instanceof Error ? e.message : "Filen kunde inte läsas.";
    }
  }
  return {
    attachment,
    identified,
    preview,
    previewError,
    bytes: content?.bytes,
  };
}
