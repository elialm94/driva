/**
 * Resend webhook-signatur (Svix / Standard Webhooks).
 *
 * Samma modell som Resend-docs och `resend.webhooks.verify`: HMAC-SHA256 av
 * `${svix-id}.${svix-timestamp}.${rawBody}` med hemligheten (whsec_ + base64).
 * Hemligheten är RESEND_WEBHOOK_SECRET – inte INBOUND_MAIL_WEBHOOK_SECRET.
 */
import { createHmac, timingSafeEqual } from "crypto";

const SECRET_PREFIX = "whsec_";
/** Svix standardtolerans. */
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export interface ResendWebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export function resendWebhookSecret(): string | undefined {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  return secret || undefined;
}

export function resendWebhookHeadersFromRequest(
  getHeader: (name: string) => string | null
): ResendWebhookHeaders {
  return {
    id: getHeader("svix-id") ?? getHeader("webhook-id"),
    timestamp: getHeader("svix-timestamp") ?? getHeader("webhook-timestamp"),
    signature: getHeader("svix-signature") ?? getHeader("webhook-signature"),
  };
}

function decodeWebhookSecret(secret: string): Buffer | null {
  const raw = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/** Skapa `v1,<base64>` – samma format som Svix/Resend skickar. */
export function signResendWebhook(
  secret: string,
  id: string,
  timestamp: string,
  payload: string
): string {
  const key = decodeWebhookSecret(secret);
  if (!key) throw new Error("Ogiltig webhook-hemlighet");
  const digest = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`, "utf8").digest("base64");
  return `v1,${digest}`;
}

function timestampIsFresh(timestamp: string, nowSeconds: number): boolean {
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowSeconds - ts) <= TIMESTAMP_TOLERANCE_SECONDS;
}

/**
 * Verifiera Svix-signatur mot rå body. Returnerar false vid saknad/ogiltig
 * signatur – kastar inte (anroparen mappar till 401).
 */
export function verifyResendWebhookSignature(
  rawBody: string,
  headers: ResendWebhookHeaders,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  if (!secret) return false;
  const id = headers.id?.trim() ?? "";
  const timestamp = headers.timestamp?.trim() ?? "";
  const provided = headers.signature?.trim() ?? "";
  if (!id || !timestamp || !provided) return false;
  if (!timestampIsFresh(timestamp, nowSeconds)) return false;

  let expected: string;
  try {
    expected = signResendWebhook(secret, id, timestamp, rawBody);
  } catch {
    return false;
  }
  const expectedSig = expected.slice(expected.indexOf(",") + 1);
  const expectedBuf = Buffer.from(expectedSig);

  for (const part of provided.split(/\s+/)) {
    const comma = part.indexOf(",");
    if (comma <= 0) continue;
    const version = part.slice(0, comma);
    const sig = part.slice(comma + 1);
    if (version !== "v1" || !sig) continue;
    const got = Buffer.from(sig);
    if (got.length === expectedBuf.length && timingSafeEqual(got, expectedBuf)) return true;
  }
  return false;
}
