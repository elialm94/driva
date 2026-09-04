/**
 * Resend Receiving → InboundMailPayload.
 *
 * Webhooken (email.received) bär bara metadata. Innehåll hämtas med
 * receiving.get + attachments.list/download och mappas till samma ingest som
 * POST /api/inbox/inbound. Tenant = local-part på vår inbound-domän, aldrig From.
 */
import { Resend } from "resend";
import { resendApiKey } from "../mail";
import {
  INBOUND_MAIL_ALIAS_DOMAINS,
  inboundMailDomain,
  inboundMailMode,
  inboundSlugFromTo,
  parseInboundPayload,
  type InboundAttachmentPayload,
  type InboundMailPayload,
} from "./inbound-mail";
import {
  isViewableContentType,
  MAX_INLINE_ATTACHMENT_BYTES,
  storableAttachmentContent,
} from "./attachment-content";
import { ingestInboundMail, inboundSlugMatches } from "../services/inbox";
import {
  resendWebhookSecret,
  verifyResendWebhookSignature,
  type ResendWebhookHeaders,
} from "./resend-signature";

export type { ResendWebhookHeaders } from "./resend-signature";
export {
  resendWebhookHeadersFromRequest,
  resendWebhookSecret,
  signResendWebhook,
  verifyResendWebhookSignature,
} from "./resend-signature";

/** Hoppa över resterande nerladdningar innan Vercel-taket. */
const ATTACHMENT_DOWNLOAD_BUDGET_MS = 18_000;
const MAX_VIEWABLE_DOWNLOADS = 6;
const DOWNLOAD_TIMEOUT_MS = 8_000;
const RECEIVING_GET_TIMEOUT_MS = 12_000;

export const RESEND_RECEIVING_NOT_CONFIGURED =
  "Inkommande e-post via Resend är inte konfigurerad. Sätt RESEND_API_KEY och RESEND_WEBHOOK_SECRET.";

export interface ResendReceivedEmail {
  id?: string;
  from: string;
  to: string[];
  received_for?: string[];
  subject: string;
  text?: string | null;
  html?: string | null;
  headers?: Record<string, string> | null;
}

export interface ResendReceivingAttachment {
  id?: string;
  filename?: string | null;
  content_type: string;
  size?: number;
  download_url?: string;
}

export interface ResendReceivingClient {
  getEmail(emailId: string): Promise<ResendReceivedEmail | null>;
  listAttachments(emailId: string): Promise<ResendReceivingAttachment[]>;
  download(url: string): Promise<Buffer | null>;
}

export type InboundWebhookResult =
  | { status: 200; payload: { id: string; created: boolean; autoBooked: boolean } }
  | { status: 400 | 404; error: string };

export interface ResendEmailReceivedFixture {
  type: string;
  created_at?: string;
  data: {
    email_id?: string;
    from?: string;
    to?: string[];
    received_for?: string[];
    subject?: string;
    attachments?: Array<{
      id?: string;
      filename?: string | null;
      content_type?: string;
      size?: number;
    }>;
  };
}

export function isResendReceivingConfigured(): boolean {
  return Boolean(resendApiKey() && resendWebhookSecret());
}

export function parseMailboxAddress(
  raw: string
): { address: string; local: string; domain: string } | null {
  const trimmed = raw.trim().toLowerCase();
  const angle = trimmed.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : trimmed).split(",")[0]?.trim() ?? "";
  const at = addr.lastIndexOf("@");
  if (at <= 0) return null;
  const local = addr.slice(0, at);
  const domain = addr.slice(at + 1);
  if (!local || !domain) return null;
  return { address: addr, local, domain };
}

export function isOurInboundMailDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  if (d === inboundMailDomain()) return true;
  return (INBOUND_MAIL_ALIAS_DOMAINS as readonly string[]).includes(d);
}

/** Första adressen på in.ferva.se / alias i to eller received_for. */
export function pickInboundRecipient(to: string[] | undefined, receivedFor?: string[]): string | null {
  for (const raw of [...(to ?? []), ...(receivedFor ?? [])]) {
    const parsed = parseMailboxAddress(raw);
    if (parsed && isOurInboundMailDomain(parsed.domain)) return parsed.address;
  }
  return null;
}

export function parseResendWebhookJson(body: unknown): ResendEmailReceivedFixture | { error: string } {
  if (!body || typeof body !== "object") return { error: "Ogiltig JSON" };
  const o = body as Record<string, unknown>;
  const type = typeof o.type === "string" ? o.type : "";
  if (!type) return { error: "type saknas" };
  const data = o.data && typeof o.data === "object" ? (o.data as ResendEmailReceivedFixture["data"]) : {};
  return {
    type,
    ...(typeof o.created_at === "string" ? { created_at: o.created_at } : {}),
    data,
  };
}

export function mapResendReceivedToPayload(input: {
  emailId: string;
  from: string;
  to: string;
  subject: string;
  text?: string | null;
  html?: string | null;
  attachments?: InboundAttachmentPayload[];
}): InboundMailPayload | { error: string } {
  return parseInboundPayload({
    externalId: input.emailId,
    to: input.to,
    from: input.from,
    subject: input.subject,
    text: input.text ?? "",
    ...(input.html ? { html: input.html } : {}),
    attachments: input.attachments ?? [],
  });
}

export function ingestInboundPayloadLocal(payload: InboundMailPayload): InboundWebhookResult {
  const slug = inboundSlugFromTo(payload.to);
  if (!slug) return { status: 400, error: "Kunde inte läsa tenant från To-adressen" };
  if (!inboundSlugMatches(payload.to)) {
    return { status: 404, error: "Okänd inkommande adress" };
  }
  const result = ingestInboundMail(payload);
  if (!result.ok) return { status: result.status as 400 | 404, error: result.error };
  return {
    status: 200,
    payload: { id: result.item.id, created: result.created, autoBooked: result.autoBooked },
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

export async function collectInboundAttachments(
  emailId: string,
  client: ResendReceivingClient,
  webhookAttachments: ResendEmailReceivedFixture["data"]["attachments"] = [],
  now: () => number = Date.now
): Promise<InboundAttachmentPayload[]> {
  let listed: ResendReceivingAttachment[] = [];
  try {
    listed = await client.listAttachments(emailId);
  } catch {
    listed = [];
  }

  const source: ResendReceivingAttachment[] =
    listed.length > 0
      ? listed
      : (webhookAttachments ?? []).map((a) => ({
          id: a.id,
          filename: a.filename,
          content_type: a.content_type || "application/octet-stream",
          size: a.size,
        }));

  const started = now();
  const out: InboundAttachmentPayload[] = [];
  let downloads = 0;

  for (const att of source) {
    const filename = att.filename?.trim() || "bilaga";
    const contentType = att.content_type || "application/octet-stream";
    const meta: InboundAttachmentPayload = {
      filename,
      contentType,
      ...(typeof att.size === "number" ? { size: att.size } : {}),
    };

    const overBudget = now() - started > ATTACHMENT_DOWNLOAD_BUDGET_MS;
    const tooBig = typeof att.size === "number" && att.size > MAX_INLINE_ATTACHMENT_BYTES;
    const shouldDownload =
      Boolean(att.download_url) &&
      isViewableContentType(contentType) &&
      !tooBig &&
      !overBudget &&
      downloads < MAX_VIEWABLE_DOWNLOADS;

    if (!shouldDownload) {
      out.push(meta);
      continue;
    }

    downloads += 1;
    try {
      const bytes = await client.download(att.download_url!);
      if (!bytes) {
        out.push(meta);
        continue;
      }
      if (bytes.length > MAX_INLINE_ATTACHMENT_BYTES) {
        out.push({ ...meta, size: bytes.length });
        continue;
      }
      const contentBase64 = storableAttachmentContent(contentType, bytes.toString("base64"));
      out.push({
        ...meta,
        size: bytes.length,
        ...(contentBase64 ? { contentBase64 } : {}),
      });
    } catch {
      out.push(meta);
    }
  }

  return out;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createResendReceivingClient(apiKey: string): ResendReceivingClient {
  const resend = new Resend(apiKey);
  return {
    async getEmail(emailId) {
      const { data, error } = await withTimeout(
        resend.emails.receiving.get(emailId),
        RECEIVING_GET_TIMEOUT_MS,
        "Resend receiving.get svarade inte i tid."
      );
      if (error || !data) return null;
      return {
        id: data.id,
        from: data.from,
        to: data.to ?? [],
        received_for: data.received_for ?? [],
        subject: data.subject ?? "",
        text: data.text,
        html: data.html,
        headers: data.headers,
      };
    },
    async listAttachments(emailId) {
      const { data, error } = await withTimeout(
        resend.emails.receiving.attachments.list({ emailId }),
        RECEIVING_GET_TIMEOUT_MS,
        "Resend attachments.list svarade inte i tid."
      );
      if (error || !data) return [];
      return (data.data ?? []).map((a) => ({
        id: a.id,
        filename: a.filename,
        content_type: a.content_type,
        size: a.size,
        download_url: a.download_url,
      }));
    },
    async download(url) {
      const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

export async function handleResendInboundWebhook(
  input: { rawBody: string; headers: ResendWebhookHeaders },
  deps: {
    client?: ResendReceivingClient;
    ingest?: (payload: InboundMailPayload) => Promise<InboundWebhookResult> | InboundWebhookResult;
  } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const mode = inboundMailMode();
  const secret = resendWebhookSecret();
  const signed = Boolean(
    input.headers.id?.trim() && input.headers.timestamp?.trim() && input.headers.signature?.trim()
  );

  if (mode === "live" && !secret) {
    return { status: 503, body: { error: RESEND_RECEIVING_NOT_CONFIGURED } };
  }

  if (mode === "live" || signed) {
    if (!verifyResendWebhookSignature(input.rawBody, input.headers, secret)) {
      return { status: 401, body: { error: "Ogiltig eller saknad Resend-signatur" } };
    }
  }

  let json: unknown;
  try {
    json = input.rawBody ? JSON.parse(input.rawBody) : null;
  } catch {
    return { status: 400, body: { error: "Ogiltig JSON" } };
  }

  const event = parseResendWebhookJson(json);
  if ("error" in event) return { status: 400, body: { error: event.error } };
  if (event.type !== "email.received") {
    return { status: 200, body: {} };
  }

  const emailId = typeof event.data.email_id === "string" ? event.data.email_id.trim() : "";
  if (!emailId) return { status: 400, body: { error: "email_id saknas" } };

  const client = deps.client ?? (resendApiKey() ? createResendReceivingClient(resendApiKey()!) : undefined);
  if (!client) {
    return { status: 503, body: { error: RESEND_RECEIVING_NOT_CONFIGURED } };
  }

  const received = await client.getEmail(emailId);
  if (!received) {
    return { status: 502, body: { error: "Kunde inte hämta mejlet från Resend" } };
  }

  const toList = received.to.length > 0 ? received.to : asStringArray(event.data.to);
  const receivedFor =
    received.received_for && received.received_for.length > 0
      ? received.received_for
      : asStringArray(event.data.received_for);
  const to = pickInboundRecipient(toList, receivedFor);
  if (!to) {
    return { status: 400, body: { error: "Ingen mottagare på inkommande domän" } };
  }

  const from = (received.from || (typeof event.data.from === "string" ? event.data.from : "")).trim();
  const subject = received.subject || (typeof event.data.subject === "string" ? event.data.subject : "");
  const attachments = await collectInboundAttachments(emailId, client, event.data.attachments);

  const payload = mapResendReceivedToPayload({
    emailId,
    from,
    to,
    subject,
    text: received.text,
    html: received.html,
    attachments,
  });
  if ("error" in payload) return { status: 400, body: { error: payload.error } };

  const ingest = deps.ingest ?? ingestInboundPayloadLocal;
  const result = await ingest(payload);
  if (result.status !== 200) return { status: result.status, body: { error: result.error } };
  return { status: 200, body: result.payload };
}
