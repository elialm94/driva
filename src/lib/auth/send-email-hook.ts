/**
 * Supabase Auth → Send Email-hook.
 *
 * När hooken är på i projektet slutar GoTrue skicka "Supabase Auth"-mejlen.
 * Vi skickar i stället Driva-mallar via samma Resend-väg som offerter.
 *
 * Hemlighet: SEND_EMAIL_HOOK_SECRET (dashboard: v1,whsec_… – v1,-prefixet
 * strippas). Signaturen är Standard Webhooks, samma algoritm som Resend.
 */
import { authEmail, type AuthEmailKind } from "@/lib/email/auth-templates";
import {
  resendWebhookHeadersFromRequest,
  verifyResendWebhookSignature,
} from "@/lib/inbox/resend-signature";
import {
  MAIL_NOT_CONFIGURED,
  appOrigin,
  mailFromAddress,
  sendMail,
  type MailMessage,
  type MailResult,
} from "@/lib/mail";
import { safeAuthNext, sanitizeAuthEmail } from "./signup-flow";

export const SEND_EMAIL_HOOK_SECRET_MISSING =
  "SEND_EMAIL_HOOK_SECRET saknas. Auth-mejlen kan inte tas emot.";

export const AUTH_MAIL_REQUIRES_LIVE =
  "Bekräftelsemejlet kunde inte skickas: e-posttjänsten är inte konfigurerad (RESEND_API_KEY och RESEND_FROM_EMAIL).";

const ACTION_KINDS = new Set<string>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
  "reauthentication",
  "password_changed_notification",
  "email_changed_notification",
  "phone_changed_notification",
  "identity_linked_notification",
  "identity_unlinked_notification",
  "mfa_factor_enrolled_notification",
  "mfa_factor_unenrolled_notification",
]);

const LINK_ACTIONS = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

export interface SendEmailHookUser {
  email?: string;
  new_email?: string;
}

export interface SendEmailHookEmailData {
  token?: string;
  token_hash?: string;
  redirect_to?: string;
  email_action_type?: string;
  site_url?: string;
  token_new?: string;
  token_hash_new?: string;
}

export interface SendEmailHookPayload {
  user: SendEmailHookUser;
  email_data: SendEmailHookEmailData;
}

export interface AuthEmailJob {
  to: string;
  kind: AuthEmailKind;
  otpType: string;
  tokenHash?: string;
  token?: string;
  confirmUrl?: string;
  newEmail?: string;
}

export function sendEmailHookSecret(): string | undefined {
  const raw = process.env.SEND_EMAIL_HOOK_SECRET?.trim();
  if (!raw) return undefined;
  return raw.replace(/^v1,/i, "");
}

function filled(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function originFromRedirect(redirectTo: string | undefined): string {
  if (redirectTo) {
    try {
      const url = new URL(redirectTo);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      /* fall through */
    }
  }
  return appOrigin();
}

function nextFromRedirect(redirectTo: string | undefined, action: string): string {
  if (redirectTo) {
    try {
      const next = safeAuthNext(new URL(redirectTo).searchParams.get("next"));
      if (next !== "/") return next;
    } catch {
      /* fall through */
    }
  }
  return action === "recovery" ? "/uppdatera-losenord" : "/";
}

export function authConfirmUrl(input: {
  tokenHash: string;
  type: string;
  redirectTo?: string;
}): string {
  const url = new URL("/auth/bekrafta", originFromRedirect(input.redirectTo));
  url.searchParams.set("token_hash", input.tokenHash);
  url.searchParams.set("type", input.type);
  const next = nextFromRedirect(input.redirectTo, input.type);
  if (next !== "/") url.searchParams.set("next", next);
  return url.toString();
}

export function parseSendEmailHookPayload(raw: unknown): SendEmailHookPayload | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Ogiltig JSON" };
  const rec = raw as { user?: unknown; email_data?: unknown };
  if (!rec.user || typeof rec.user !== "object") return { error: "Saknar user" };
  if (!rec.email_data || typeof rec.email_data !== "object") return { error: "Saknar email_data" };
  const user = rec.user as Record<string, unknown>;
  const emailData = rec.email_data as Record<string, unknown>;
  const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
  return {
    user: { email: str(user.email), new_email: str(user.new_email) },
    email_data: {
      token: str(emailData.token),
      token_hash: str(emailData.token_hash),
      redirect_to: str(emailData.redirect_to),
      email_action_type: str(emailData.email_action_type),
      site_url: str(emailData.site_url),
      token_new: str(emailData.token_new),
      token_hash_new: str(emailData.token_hash_new),
    },
  };
}

function kindForAction(action: string, variant?: "current" | "new"): AuthEmailKind {
  if (action === "email_change") {
    return variant === "current" ? "email_change_current" : "email_change_new";
  }
  if (action === "email") return "magiclink";
  if (ACTION_KINDS.has(action) && action !== "email_change") {
    return action as AuthEmailKind;
  }
  return "notification";
}

function job(input: {
  to: string | undefined;
  kind: AuthEmailKind;
  otpType: string;
  tokenHash?: string;
  token?: string;
  redirectTo?: string;
  newEmail?: string;
}): AuthEmailJob | null {
  const to = sanitizeAuthEmail(input.to);
  if (!to) return null;
  const tokenHash = filled(input.tokenHash);
  const needsLink = LINK_ACTIONS.has(input.otpType);
  if (needsLink && !tokenHash) return null;
  return {
    to,
    kind: input.kind,
    otpType: input.otpType,
    tokenHash,
    token: filled(input.token),
    confirmUrl: tokenHash
      ? authConfirmUrl({ tokenHash, type: input.otpType, redirectTo: input.redirectTo })
      : undefined,
    newEmail: input.newEmail,
  };
}

/**
 * Ett eller två utskick per hook-anrop. email_change med säkert byte
 * (båda hash-paren) ger två mejl – hash-fälten är omvända enligt Supabase.
 */
export function planAuthEmails(payload: SendEmailHookPayload): AuthEmailJob[] {
  const action = filled(payload.email_data.email_action_type);
  if (!action) return [];
  const redirectTo = filled(payload.email_data.redirect_to);
  const currentEmail = payload.user.email;
  const newEmail = filled(payload.user.new_email);
  const token = filled(payload.email_data.token);
  const tokenHash = filled(payload.email_data.token_hash);
  const tokenNew = filled(payload.email_data.token_new);
  const tokenHashNew = filled(payload.email_data.token_hash_new);

  if (action === "email_change" && tokenHash && tokenHashNew && newEmail) {
    return [
      job({
        to: currentEmail,
        kind: kindForAction(action, "current"),
        otpType: "email_change",
        tokenHash: tokenHashNew,
        token,
        redirectTo,
        newEmail,
      }),
      job({
        to: newEmail,
        kind: kindForAction(action, "new"),
        otpType: "email_change",
        tokenHash,
        token: tokenNew,
        redirectTo,
        newEmail,
      }),
    ].filter((row): row is AuthEmailJob => Boolean(row));
  }

  const to = action === "email_change" ? newEmail || currentEmail : currentEmail;
  const planned = job({
    to,
    kind: kindForAction(action),
    otpType: action === "email_change" ? "email_change" : action,
    tokenHash,
    token,
    redirectTo,
    newEmail,
  });
  return planned ? [planned] : [];
}

export function prepareAuthMail(job: AuthEmailJob): MailMessage {
  const built = authEmail({
    kind: job.kind,
    confirmUrl: job.confirmUrl,
    token: job.kind === "reauthentication" ? job.token : undefined,
    newEmail: job.newEmail,
  });
  return {
    to: job.to,
    from: mailFromAddress(),
    subject: built.subject,
    text: built.text,
    html: built.html,
  };
}

export async function sendAuthMail(job: AuthEmailJob): Promise<MailResult> {
  const result = await sendMail(prepareAuthMail(job), { kind: `auth_${job.kind}` });
  if (!result.ok) return result;
  if (result.mode === "mock" || result.mode === "demo") {
    return { ok: false, error: AUTH_MAIL_REQUIRES_LIVE, mode: result.mode, code: "not_configured" };
  }
  return result;
}

export async function handleSendEmailHook(input: {
  rawBody: string;
  getHeader: (name: string) => string | null;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const secret = sendEmailHookSecret();
  if (!secret) {
    return {
      status: 503,
      body: { error: { http_code: 503, message: SEND_EMAIL_HOOK_SECRET_MISSING } },
    };
  }

  const headers = resendWebhookHeadersFromRequest(input.getHeader);
  if (!verifyResendWebhookSignature(input.rawBody, headers, secret)) {
    return {
      status: 401,
      body: { error: { http_code: 401, message: "Ogiltig eller saknad signatur" } },
    };
  }

  let json: unknown;
  try {
    json = input.rawBody ? JSON.parse(input.rawBody) : null;
  } catch {
    return { status: 400, body: { error: { http_code: 400, message: "Ogiltig JSON" } } };
  }

  const payload = parseSendEmailHookPayload(json);
  if ("error" in payload) {
    return { status: 400, body: { error: { http_code: 400, message: payload.error } } };
  }

  const jobs = planAuthEmails(payload);
  if (jobs.length === 0) {
    return { status: 400, body: { error: { http_code: 400, message: "Kunde inte bygga auth-mejlet" } } };
  }

  for (const row of jobs) {
    const result = await sendAuthMail(row);
    if (!result.ok) {
      const message = result.code === "not_configured" ? result.error || MAIL_NOT_CONFIGURED : result.error;
      const status = result.code === "not_configured" ? 503 : 500;
      return { status, body: { error: { http_code: status, message } } };
    }
  }

  return { status: 200, body: {} };
}
