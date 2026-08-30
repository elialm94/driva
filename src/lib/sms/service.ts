/**
 * Serverside SMS via 46elks. Credentials läses bara från process.env.
 * React-komponenter anropar aldrig hit direkt.
 */

import { isDemoBusiness } from "../demo";
import { SMS_API_URL, SMS_FROM, SMS_NOT_CONFIGURED, SMS_PROVIDER, SMS_SEND_FAILED } from "./config";

export type SmsMode = "live" | "demo" | "test" | "mock";

export type SmsResult =
  | { ok: true; mode: SmsMode; providerMessageId?: string; provider: typeof SMS_PROVIDER }
  | { ok: false; error: string; mode: SmsMode; code?: "not_configured" | "provider" };

export type SmsMessage = {
  to: string;
  message: string;
};

export type SmsTransport = (message: SmsMessage) => Promise<{ providerMessageId?: string } | void>;

let testTransport: SmsTransport | undefined;

export function setSmsTestTransport(transport: SmsTransport | undefined): void {
  testTransport = transport;
}

function elksUsername(): string | undefined {
  const v = process.env.ELKS_API_USERNAME?.trim();
  return v || undefined;
}

function elksPassword(): string | undefined {
  const v = process.env.ELKS_API_PASSWORD?.trim();
  return v || undefined;
}

export function isLiveSmsConfigured(): boolean {
  return Boolean(elksUsername() && elksPassword());
}

function basicAuthHeader(): string {
  const user = elksUsername();
  const pass = elksPassword();
  if (!user || !pass) throw new Error(SMS_NOT_CONFIGURED);
  return `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;
}

function logSend(status: string, to: string, providerMessageId?: string): void {
  const parts = [
    "[driva:sms]",
    `status=${status}`,
    `to=${to}`,
    `from=${SMS_FROM}`,
    `provider=${SMS_PROVIDER}`,
    providerMessageId ? `id=${providerMessageId}` : null,
  ].filter(Boolean);
  console.info(parts.join(" "));
}

function providerErrorMessage(raw: string): string {
  const text = raw.toLowerCase();
  if (text.includes("unauthorized") || text.includes("authentication") || text.includes("invalid user")) {
    return SMS_NOT_CONFIGURED;
  }
  return SMS_SEND_FAILED;
}

function parseElksId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id : undefined;
}

async function sendViaElks(message: SmsMessage): Promise<string | undefined> {
  const res = await fetch(SMS_API_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      from: SMS_FROM,
      to: message.to,
      message: message.message,
    }).toString(),
  });

  let parsed: unknown;
  const rawText = await res.text();
  try {
    parsed = rawText ? JSON.parse(rawText) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!res.ok) {
    const fromBody =
      parsed && typeof parsed === "object" && typeof (parsed as { message?: unknown }).message === "string"
        ? (parsed as { message: string }).message
        : rawText.slice(0, 200);
    throw new Error(fromBody || `46elks ${res.status}`);
  }

  return parseElksId(parsed);
}

/**
 * Skicka ett SMS. Demo simulerar alltid (inga 46elks-krediter).
 * Testhook via setSmsTestTransport. Saknade credentials på riktigt företag = ärligt fel.
 */
export async function sendSms(input: SmsMessage): Promise<SmsResult> {
  if (isDemoBusiness()) {
    logSend("demo_simulated", input.to);
    return { ok: true, mode: "demo", provider: SMS_PROVIDER, providerMessageId: `demo_${Date.now()}` };
  }

  try {
    if (testTransport) {
      const extra = await testTransport(input);
      const providerMessageId = extra && typeof extra === "object" ? extra.providerMessageId : undefined;
      logSend("sent", input.to, providerMessageId);
      return { ok: true, mode: "test", provider: SMS_PROVIDER, providerMessageId };
    }
    if (!isLiveSmsConfigured()) {
      return { ok: false, error: SMS_NOT_CONFIGURED, mode: "mock", code: "not_configured" };
    }
    const providerMessageId = await sendViaElks(input);
    logSend("sent", input.to, providerMessageId);
    return { ok: true, mode: "live", provider: SMS_PROVIDER, providerMessageId };
  } catch (e) {
    const raw = e instanceof Error ? e.message : SMS_SEND_FAILED;
    const error = providerErrorMessage(raw);
    logSend("failed", input.to);
    return {
      ok: false,
      error,
      mode: testTransport ? "test" : isLiveSmsConfigured() ? "live" : "mock",
      code: error === SMS_NOT_CONFIGURED ? "not_configured" : "provider",
    };
  }
}
