import { createHmac, timingSafeEqual } from "crypto";

/**
 * Inkommande leverantörsmejl – providerabstraktion.
 *
 * Webhooken tar emot ett normaliserat payload. Signatur är HMAC-SHA256 av
 * rå body. I produktion krävs giltig signatur. Lokalt (INBOUND_MAIL_MODE=mock,
 * default utanför production) får mock-providern posta osignerat.
 */

export const INBOUND_MAIL_DOMAIN = "in.driva.se";

export interface InboundAttachmentPayload {
  filename: string;
  contentType: string;
  size?: number;
  /** Valfri base64 – lagras inte i JSON-läget, bara metadata. */
  contentBase64?: string;
}

export interface InboundParsedHint {
  amount?: number;
  vatAmount?: number;
  supplier?: string;
  date?: string;
  confidence?: number;
  invoiceNumber?: string;
  dueDate?: string;
  ocr?: string;
  bankgiro?: string;
  /**
   * 0–1: konfidens specifikt för betalningsuppgifterna (bankgiro/OCR).
   * Saknas = samma som confidence. Under AUTO-tröskeln blir uppgifterna en
   * kontrollkandidat i stället för betalbara fält.
   */
  detailsConfidence?: number;
  documentType?: "leverantorsfaktura" | "kvitto" | "ekonomiskt_dokument";
}

export interface InboundMailPayload {
  externalId: string;
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: InboundAttachmentPayload[];
  parsed?: InboundParsedHint;
}

export type InboundMailMode = "mock" | "live";

export function inboundMailMode(): InboundMailMode {
  if (process.env.INBOUND_MAIL_MODE === "mock") return "mock";
  if (process.env.INBOUND_MAIL_MODE === "live") return "live";
  return process.env.NODE_ENV === "production" ? "live" : "mock";
}

export function inboundMailAddress(slug: string): string {
  return `${slug}@${INBOUND_MAIL_DOMAIN}`;
}

/** Lokal-del av To – tenantnyckel. +tagg strippas. Aldrig From. */
export function inboundSlugFromTo(to: string): string | null {
  const trimmed = to.trim().toLowerCase();
  const angle = trimmed.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : trimmed).split(",")[0]?.trim() ?? "";
  const at = addr.lastIndexOf("@");
  if (at <= 0) return null;
  const local = addr.slice(0, at);
  const plus = local.indexOf("+");
  const slug = (plus >= 0 ? local.slice(0, plus) : local).replace(/[^a-z0-9-]/g, "");
  return slug || null;
}

export function verifyInboundSignature(rawBody: string, header: string | null | undefined): boolean {
  const mode = inboundMailMode();
  const secret = process.env.INBOUND_MAIL_WEBHOOK_SECRET?.trim();
  const provided = header?.trim() ?? "";

  if (mode === "mock" && !provided) return true;
  if (!secret || !provided) return false;

  const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const gotHex = provided.replace(/^sha256=/i, "").trim();
  try {
    const a = Buffer.from(expectedHex, "hex");
    const b = Buffer.from(gotHex, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function parseInboundPayload(body: unknown): InboundMailPayload | { error: string } {
  if (!body || typeof body !== "object") return { error: "Ogiltig JSON" };
  const o = body as Record<string, unknown>;
  const externalId = typeof o.externalId === "string" ? o.externalId.trim() : "";
  const to = typeof o.to === "string" ? o.to.trim() : "";
  const from = typeof o.from === "string" ? o.from.trim() : "";
  const subject = typeof o.subject === "string" ? o.subject : "";
  const text = typeof o.text === "string" ? o.text : "";
  if (!externalId) return { error: "externalId saknas" };
  if (!to) return { error: "to saknas" };
  if (!from) return { error: "from saknas" };

  let parsed: InboundParsedHint | undefined;
  if (o.parsed && typeof o.parsed === "object") {
    const p = o.parsed as Record<string, unknown>;
    parsed = {
      ...(typeof p.amount === "number" ? { amount: p.amount } : {}),
      ...(typeof p.vatAmount === "number" ? { vatAmount: p.vatAmount } : {}),
      ...(typeof p.supplier === "string" ? { supplier: p.supplier } : {}),
      ...(typeof p.date === "string" ? { date: p.date } : {}),
      ...(typeof p.confidence === "number" ? { confidence: p.confidence } : {}),
      ...(typeof p.invoiceNumber === "string" ? { invoiceNumber: p.invoiceNumber } : {}),
      ...(typeof p.dueDate === "string" ? { dueDate: p.dueDate } : {}),
      ...(typeof p.ocr === "string" ? { ocr: p.ocr } : {}),
      ...(typeof p.bankgiro === "string" ? { bankgiro: p.bankgiro } : {}),
      ...(typeof p.detailsConfidence === "number" ? { detailsConfidence: p.detailsConfidence } : {}),
      ...(p.documentType === "leverantorsfaktura" || p.documentType === "kvitto" || p.documentType === "ekonomiskt_dokument"
        ? { documentType: p.documentType }
        : {}),
    };
  }

  const attachments: InboundAttachmentPayload[] = [];
  if (Array.isArray(o.attachments)) {
    for (const a of o.attachments) {
      if (!a || typeof a !== "object") continue;
      const att = a as Record<string, unknown>;
      if (typeof att.filename !== "string" || typeof att.contentType !== "string") continue;
      attachments.push({
        filename: att.filename,
        contentType: att.contentType,
        ...(typeof att.size === "number" ? { size: att.size } : {}),
        ...(typeof att.contentBase64 === "string" ? { contentBase64: att.contentBase64 } : {}),
      });
    }
  }

  return {
    externalId,
    to,
    from,
    subject,
    text,
    ...(typeof o.html === "string" ? { html: o.html } : {}),
    attachments,
    ...(parsed ? { parsed } : {}),
  };
}
