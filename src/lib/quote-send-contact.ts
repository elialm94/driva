/**
 * Kontaktluckor på offerten: e-post och telefon är mjuka luckor,
 * inte "kan inte skicka". Skicka är grå bara när båda saknas
 * (inskrivet i fältet räknas) och övriga hard-blockers är borta.
 */

export type QuoteSendChannel = "email" | "sms";

export function quoteHasSendDestination(contact: { email?: string | null; phone?: string | null }): boolean {
  return Boolean(contact.email?.trim() || contact.phone?.trim());
}

export function quoteChannelEnabled(
  channel: QuoteSendChannel,
  contact: { email?: string | null; phone?: string | null }
): boolean {
  return channel === "email" ? Boolean(contact.email?.trim()) : Boolean(contact.phone?.trim());
}

export function quoteSendButtonEnabled(opts: {
  hardBlockers: number;
  email?: string | null;
  phone?: string | null;
}): boolean {
  if (opts.hardBlockers > 0) return false;
  return quoteHasSendDestination({ email: opts.email, phone: opts.phone });
}

export function quoteContactGapCopy(contact: { email?: string | null; phone?: string | null }): {
  missingEmail: boolean;
  missingPhone: boolean;
  banner: string | null;
} {
  const missingEmail = !contact.email?.trim();
  const missingPhone = !contact.phone?.trim();
  if (!missingEmail && !missingPhone) {
    return { missingEmail, missingPhone, banner: null };
  }
  if (missingEmail && missingPhone) {
    return {
      missingEmail,
      missingPhone,
      banner: "Kunden saknar e-post och telefon. Fyll i minst en när du skickar - det sparas på kunden.",
    };
  }
  if (missingEmail) {
    return {
      missingEmail,
      missingPhone,
      banner: "Kunden saknar e-post. Du kan skicka med SMS eller fylla i adressen när du skickar.",
    };
  }
  return {
    missingEmail,
    missingPhone,
      banner: "Kunden saknar telefon. Du kan skicka med e-post eller fylla i numret när du skickar.",
  };
}

export function defaultQuoteSendChoice(contact: { email?: string | null; phone?: string | null }): "email" | "sms" | "both" {
  const email = Boolean(contact.email?.trim());
  const sms = Boolean(contact.phone?.trim());
  if (email && sms) return "both";
  if (sms) return "sms";
  return "email";
}

export function channelsFromChoice(choice: "email" | "sms" | "both"): QuoteSendChannel[] {
  if (choice === "both") return ["email", "sms"];
  return [choice];
}
