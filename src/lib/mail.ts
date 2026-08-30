/**
 * Serverside e-posttransport (Resend). Utan RESEND_API_KEY eller
 * testtransport: ärligt fel – aldrig fejkad succé.
 */

import { Resend } from "resend";

export const MAIL_NOT_CONFIGURED = "E-posttjänsten är inte konfigurerad i den här miljön.";

/** Resends dokumenterade testavsändare – används bara när ingen egen From är satt. */
export const RESEND_TEST_FROM_EMAIL = "beth.t@example.com";
export const RESEND_TEST_FROM_NAME = "Driva";

export const UNVERIFIED_DOMAIN_ERROR =
  "Avsändardomänen är inte verifierad i Resend. Verifiera domänen i Resend-dashboarden, eller använd beth.t@example.com för tester.";

export interface MailMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

export type MailMode = "live" | "test";

export type MailResult =
  | { ok: true; mode: MailMode; messageId?: string }
  | { ok: false; error: string; mode: MailMode; code?: "not_configured" | "unverified_domain" | "provider" };

export type MailTransport = (message: MailMessage) => Promise<{ messageId?: string } | void>;

export interface MailSendMeta {
  kind?: string;
  documentId?: string;
  businessId?: string;
}

let testTransport: MailTransport | undefined;

export function setMailTransportForTests(transport: MailTransport | undefined): void {
  testTransport = transport;
}

export function resendApiKey(): string | undefined {
  const key = process.env.RESEND_API_KEY?.trim();
  return key || undefined;
}

/** Avsändare från env. Aldrig kundens eller företagets adress som From (spoof). */
export function mailFromAddress(): string {
  const email = process.env.RESEND_FROM_EMAIL?.trim();
  const name = process.env.RESEND_FROM_NAME?.trim();
  if (email) return name ? `${name} <${email}>` : email;
  const legacy = process.env.MAIL_FROM?.trim() || process.env.RESEND_FROM?.trim();
  if (legacy) return legacy;
  return `${RESEND_TEST_FROM_NAME} <${RESEND_TEST_FROM_EMAIL}>`;
}

export function isLiveMailConfigured(): boolean {
  return Boolean(resendApiKey());
}

/** Riktig utskicksväg: live-nyckel eller testtransport. Mock-succé finns inte. */
export function mailProviderAvailable(): boolean {
  return Boolean(testTransport) || isLiveMailConfigured();
}

export function appOrigin(): string {
  const raw = process.env.DRIVA_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  // På Vercel injiceras domänen automatiskt (utan protokoll). Använd den så att
  // publika länkar (offert-/faktura-/BankID-länkar, e-post) pekar på den riktiga
  // sajten i stället för localhost när DRIVA_APP_URL inte är satt.
  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return "http://localhost:3123";
}

export function absoluteAppUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${appOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

function activeMode(): MailMode {
  return testTransport ? "test" : "live";
}

function logSend(status: string, meta: MailSendMeta | undefined, messageId?: string): void {
  const parts = [
    `[driva:email]`,
    `status=${status}`,
    meta?.kind ? `kind=${meta.kind}` : null,
    meta?.documentId ? `document=${meta.documentId}` : null,
    meta?.businessId ? `business=${meta.businessId}` : null,
    messageId ? `messageId=${messageId}` : null,
  ].filter(Boolean);
  console.info(parts.join(" "));
}

function classifyProviderError(raw: string): { error: string; code: NonNullable<Extract<MailResult, { ok: false }>["code"]> } {
  const text = raw.toLowerCase();
  if (
    text.includes("not verified") ||
    text.includes("unverified") ||
    text.includes("domain is not") ||
    text.includes("only send testing emails")
  ) {
    return { error: UNVERIFIED_DOMAIN_ERROR, code: "unverified_domain" };
  }
  return { error: raw, code: "provider" };
}

export async function sendMail(message: MailMessage, meta?: MailSendMeta): Promise<MailResult> {
  const mode = activeMode();
  try {
    if (testTransport) {
      const extra = await testTransport(message);
      const messageId = extra && typeof extra === "object" ? extra.messageId : undefined;
      logSend("sent", meta, messageId);
      return { ok: true, mode: "test", messageId };
    }
    if (!isLiveMailConfigured()) {
      logSend("not_configured", meta);
      return { ok: false, error: MAIL_NOT_CONFIGURED, mode: "live", code: "not_configured" };
    }
    const messageId = await sendViaResend(message);
    logSend("sent", meta, messageId);
    return { ok: true, mode: "live", messageId };
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Kunde inte skicka e-post.";
    const classified = classifyProviderError(raw);
    logSend("failed", meta);
    return { ok: false, error: classified.error, mode, code: classified.code };
  }
}

async function sendViaResend(message: MailMessage): Promise<string | undefined> {
  const key = resendApiKey();
  if (!key) throw new Error(MAIL_NOT_CONFIGURED);
  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from: message.from,
    to: [message.to],
    replyTo: message.replyTo || undefined,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
  if (error) {
    throw new Error(error.message || "Resend avvisade utskicket.");
  }
  return data?.id;
}
