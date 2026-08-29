/**
 * E-postutskick. Utan RESEND_API_KEY + MAIL_FROM loggas mejlet (mock) –
 * vi låtsas inte att ett mejl gick iväg till en riktig mottagare.
 * Misslyckad live-leverans returnerar ok: false, aldrig fejkad succé.
 */

export interface MailMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

export type MailMode = "mock" | "live" | "test";

export type MailResult = { ok: true; mode: MailMode } | { ok: false; error: string; mode: MailMode };

export type MailTransport = (message: MailMessage) => Promise<void>;

let testTransport: MailTransport | undefined;

export function setMailTransportForTests(transport: MailTransport | undefined): void {
  testTransport = transport;
}

export function mailFromAddress(): string | undefined {
  const from = process.env.MAIL_FROM?.trim() || process.env.RESEND_FROM?.trim();
  return from || undefined;
}

export function isLiveMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && mailFromAddress());
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

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const mode = activeMode();
  try {
    if (testTransport) {
      await testTransport(message);
      return { ok: true, mode: "test" };
    }
    if (isLiveMailConfigured()) {
      await sendViaResend(message);
      return { ok: true, mode: "live" };
    }
    logMock(message);
    return { ok: true, mode: "mock" };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Kunde inte skicka e-post.";
    console.error(`[driva:email] Misslyckades till ${message.to}: ${error}`);
    return { ok: false, error, mode };
  }
}

function logMock(message: MailMessage): void {
  const reply = message.replyTo ? ` (svara till ${message.replyTo})` : "";
  console.info(
    `[driva:email] Från ${message.from}: ${message.subject} till ${message.to}${reply}. Ingen riktig e-post skickas i demon.`
  );
  const cta = message.text.split("\n").find((line) => line.startsWith("http"));
  if (cta) console.info(`[driva:email] CTA ${cta}`);
}

async function sendViaResend(message: MailMessage): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      reply_to: message.replyTo || undefined,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body.slice(0, 240)}`);
  }
}
