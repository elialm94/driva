/**
 * Serverside e-posttransport (Resend).
 *
 * Live: RESEND_API_KEY + explicit avsändare (RESEND_FROM_EMAIL / MAIL_FROM).
 * Utan det: ärlig mock i demon – logga, markera skickad, låtsas aldrig att
 * ett mejl gick till en riktig mottagare. Testdefault-From (beth.t@example.com)
 * används aldrig som tyst live-avsändare: Resend avvisar då kundens adress
 * och UI:t visade bara "Försök igen".
 *
 * Det publika demoföretaget lämnar aldrig ett mejl mot en godtycklig
 * extern adress (spam-relä). Se sendMail.
 */

import { Resend } from "resend";
import { isDemoBusiness } from "./demo";

export const MAIL_NOT_CONFIGURED = "E-posttjänsten är inte konfigurerad i den här miljön.";

/** Resends dokumenterade testavsändare – bara fallback när ingen egen From är satt. */
export const RESEND_TEST_FROM_EMAIL = "beth.t@example.com";
export const RESEND_TEST_FROM_NAME = "Driva";

export const UNVERIFIED_DOMAIN_ERROR =
  "Avsändardomänen är inte verifierad i Resend. Verifiera domänen i Resend-dashboarden, eller använd beth.t@example.com för tester.";

export const MAIL_SENDER_NOT_CONFIGURED =
  "Avsändaradressen för e-post saknas. Sätt RESEND_FROM_EMAIL till en verifierad adress.";

export interface MailMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

export type MailMode = "mock" | "live" | "test" | "demo";

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

/** Explicit From från miljön. Tomt = inte live – aldrig testdefault. */
export function configuredFromAddress(): string | undefined {
  const email = process.env.RESEND_FROM_EMAIL?.trim();
  const name = process.env.RESEND_FROM_NAME?.trim();
  if (email) return formatFromAddress(email, name);
  const legacy = process.env.MAIL_FROM?.trim() || process.env.RESEND_FROM?.trim();
  return legacy || undefined;
}

function formatFromAddress(email: string, name?: string): string {
  if (email.includes("<")) return email;
  return name ? `${name} <${email}>` : email;
}

/** Avsändare för kuvertet. Live-sändning kräver configuredFromAddress(). */
export function mailFromAddress(): string {
  return configuredFromAddress() ?? `${RESEND_TEST_FROM_NAME} <${RESEND_TEST_FROM_EMAIL}>`;
}

/** Riktig Resend-väg: nyckel OCH uttalad From. Testdefault räcker inte. */
export function isLiveMailConfigured(): boolean {
  return Boolean(resendApiKey() && configuredFromAddress());
}

/**
 * Valfri sink-adress för demoutskick (t.ex. en intern testbrevlåda). Med sink
 * skickas demoföretagets mejl DIT – aldrig till mottagaren i meddelandet.
 * Utan sink simuleras leveransen helt.
 */
export function demoEmailSink(): string | undefined {
  const v = process.env.DEMO_EMAIL_SINK?.trim();
  return v || undefined;
}

/** Riktig utskicksväg: live-nyckel+From eller testtransport. */
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
  if (testTransport) return "test";
  return isLiveMailConfigured() ? "live" : "mock";
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

function logMock(message: MailMessage): void {
  const reply = message.replyTo ? ` (svara till ${message.replyTo})` : "";
  console.info(
    `[driva:email] Från ${message.from}: ${message.subject} till ${message.to}${reply}. Ingen riktig e-post skickas i den här miljön.`
  );
  const cta = message.text.split("\n").find((line) => /^https?:\/\//.test(line.trim()));
  if (cta) console.info(`[driva:email] CTA ${cta}`);
}

/**
 * Operativ mejllogg (email_events) för Driva Admin: svarar på "varför fick
 * kunden aldrig offerten?". Loggar mottagare/typ/status – ALDRIG mejlkroppen.
 * Får aldrig påverka själva utskicket: fel sväljs medvetet.
 */
async function recordEmailEvent(
  message: MailMessage,
  meta: MailSendMeta | undefined,
  status: "sent" | "failed" | "not_configured",
  mode: MailMode,
  detail?: { error?: string; messageId?: string }
): Promise<void> {
  try {
    const { insertEmailEvent } = await import("./platform/store");
    const { uid } = await import("./ids");
    await insertEmailEvent({
      id: uid(),
      businessId: meta?.businessId,
      kind: meta?.kind ?? "",
      documentId: meta?.documentId,
      toEmail: message.to,
      status,
      error: detail?.error,
      providerMessageId: detail?.messageId,
      mode: mode === "live" ? "live" : "test",
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Loggen är sekundär – utskicksresultatet får aldrig påverkas.
  }
}

function classifyProviderError(raw: string): {
  error: string;
  code: NonNullable<Extract<MailResult, { ok: false }>["code"]>;
} {
  const text = raw.toLowerCase();
  if (
    text.includes("not verified") ||
    text.includes("unverified") ||
    text.includes("domain is not") ||
    text.includes("only send testing emails")
  ) {
    return { error: UNVERIFIED_DOMAIN_ERROR, code: "unverified_domain" };
  }
  if (
    text.includes("invalid api key") ||
    text.includes("api key is invalid") ||
    text.includes("unauthorized") ||
    text.includes("missing api key")
  ) {
    return { error: MAIL_NOT_CONFIGURED, code: "not_configured" };
  }
  return { error: raw, code: "provider" };
}

export async function sendMail(message: MailMessage, meta?: MailSendMeta): Promise<MailResult> {
  // Demoföretaget är publikt och delat – dess utskick får aldrig nå
  // godtyckliga externa adresser. Grinden sitter centralt så att ALLA
  // utskicksvägar (offert, faktura, påminnelse, inbjudan) täcks.
  if (isDemoBusiness()) {
    return sendDemoMail(message, meta);
  }
  const mode = activeMode();
  try {
    if (testTransport) {
      const extra = await testTransport(message);
      const messageId = extra && typeof extra === "object" ? extra.messageId : undefined;
      logSend("sent", meta, messageId);
      await recordEmailEvent(message, meta, "sent", "test", { messageId });
      return { ok: true, mode: "test", messageId };
    }
    if (!isLiveMailConfigured()) {
      logMock(message);
      logSend("mock", meta);
      await recordEmailEvent(message, meta, "not_configured", "mock");
      return { ok: true, mode: "mock" };
    }
    const messageId = await sendViaResend(message);
    logSend("sent", meta, messageId);
    await recordEmailEvent(message, meta, "sent", "live", { messageId });
    return { ok: true, mode: "live", messageId };
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Kunde inte skicka e-post.";
    const classified = classifyProviderError(raw);
    logSend("failed", meta);
    await recordEmailEvent(message, meta, "failed", mode, { error: classified.error });
    return { ok: false, error: classified.error, mode, code: classified.code };
  }
}

function resendErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Resend avvisade utskicket.";
  const rec = error as { message?: unknown; name?: unknown; error?: unknown };
  if (typeof rec.message === "string" && rec.message.trim()) return rec.message;
  if (typeof rec.error === "string" && rec.error.trim()) return rec.error;
  if (typeof rec.name === "string" && rec.name.trim()) return rec.name;
  return "Resend avvisade utskicket.";
}

/**
 * Demoutskick: simuleras (standard) eller omdirigeras till DEMO_EMAIL_SINK.
 * Returnerar alltid ok med mode "demo" – UI:t visar den ärliga demonoten
 * ("mejlet simulerades") och dokumentflödet fortsätter som i riktiga Driva.
 */
async function sendDemoMail(message: MailMessage, meta?: MailSendMeta): Promise<MailResult> {
  const sink = demoEmailSink();
  if (!sink || !mailProviderAvailable()) {
    logSend("demo_simulated", meta);
    return { ok: true, mode: "demo" };
  }
  const redirected: MailMessage = { ...message, to: sink, subject: `[Demo] ${message.subject}` };
  try {
    if (testTransport) {
      const extra = await testTransport(redirected);
      const messageId = extra && typeof extra === "object" ? extra.messageId : undefined;
      logSend("demo_sink", meta, messageId);
      return { ok: true, mode: "demo", messageId };
    }
    const messageId = await sendViaResend(redirected);
    logSend("demo_sink", meta, messageId);
    return { ok: true, mode: "demo", messageId };
  } catch {
    // Sinken är bäst-ansträngning: demon får aldrig blockeras av mejlfel.
    logSend("demo_sink_failed", meta);
    return { ok: true, mode: "demo" };
  }
}

async function sendViaResend(message: MailMessage): Promise<string | undefined> {
  const key = resendApiKey();
  if (!key) throw new Error(MAIL_NOT_CONFIGURED);
  const from = configuredFromAddress();
  if (!from) throw new Error(MAIL_SENDER_NOT_CONFIGURED);
  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from,
    to: [message.to],
    replyTo: message.replyTo || undefined,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
  if (error) {
    throw new Error(resendErrorMessage(error));
  }
  return data?.id;
}
