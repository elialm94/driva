import { missingEmailForSend } from "../customer-validation";
import { toE164Swedish } from "../validation/swedish";
import type { DocumentDelivery } from "../types";
import { SMS_INVALID_PHONE } from "./config";

export type SelectedChannels = {
  email: boolean;
  sms: boolean;
};

export function hasSendablePhone(phone?: string | null): boolean {
  return toE164Swedish(phone ?? "") != null;
}

export function recipientE164(phone?: string | null): { ok: true; to: string } | { ok: false; error: string } {
  const to = toE164Swedish(phone ?? "");
  if (!to) return { ok: false, error: SMS_INVALID_PHONE };
  return { ok: true, to };
}

export function hasSendableEmail(email?: string | null): boolean {
  return !missingEmailForSend({ email: email ?? "" });
}

/** Default när användaren öppnar Skicka: e-post om den finns, annars SMS. */
export function defaultSendChannels(email?: string | null, phone?: string | null): SelectedChannels {
  const emailOk = hasSendableEmail(email);
  const smsOk = hasSendablePhone(phone);
  return {
    email: emailOk,
    sms: smsOk && !emailOk,
  };
}

export function lastSuccessfulSendChannels(doc: {
  deliveries?: DocumentDelivery[];
  lastEmail?: { sentTo: string };
}): SelectedChannels {
  const sends = (doc.deliveries ?? []).filter((d) => d.kind === "send" && d.status === "sent");
  if (sends.length) {
    const latest = sends.reduce((max, d) => (d.sentAt && d.sentAt > max ? d.sentAt : max), "");
    const batch = latest ? sends.filter((d) => d.sentAt === latest) : [sends[sends.length - 1]!];
    return {
      email: batch.some((d) => d.channel === "EMAIL"),
      sms: batch.some((d) => d.channel === "SMS"),
    };
  }
  if (doc.lastEmail?.sentTo) return { email: true, sms: false };
  return { email: false, sms: false };
}

/** Påminnelse: samma kanaler som senaste fakturautskicket, annars e-post om den finns. */
export function defaultReminderChannels(
  invoice: { deliveries?: DocumentDelivery[]; lastEmail?: { sentTo: string } },
  customer: { email?: string | null; phone?: string | null }
): SelectedChannels {
  const last = lastSuccessfulSendChannels(invoice);
  const emailOk = hasSendableEmail(customer.email);
  const smsOk = hasSendablePhone(customer.phone);
  if (last.email || last.sms) {
    const email = last.email && emailOk;
    const sms = last.sms && smsOk;
    if (email || sms) return { email, sms };
  }
  return defaultSendChannels(customer.email, customer.phone);
}

export function normalizeSelectedChannels(
  requested: SelectedChannels | undefined,
  customer: { email?: string | null; phone?: string | null }
): SelectedChannels {
  if (!requested) return defaultSendChannels(customer.email, customer.phone);
  return {
    email: Boolean(requested.email),
    sms: Boolean(requested.sms),
  };
}

export function atLeastOneChannel(channels: SelectedChannels): boolean {
  return channels.email || channels.sms;
}

export function partialSuccessMessage(emailOk: boolean | undefined, smsOk: boolean | undefined): string | undefined {
  if (emailOk === true && smsOk === false) return "E-post skickades, men SMS kunde inte skickas.";
  if (emailOk === false && smsOk === true) return "SMS skickades, men e-post kunde inte skickas.";
  return undefined;
}
