/**
 * Kundmejl efter hel kredit. Förbereds i tenantkontext (företag, mottagare,
 * rubrik) och skickas av actionen via next/server after() så att krediteringen
 * aldrig väntar på e-posttjänsten.
 *
 * Demo, demoföretag (is_demo) och saknad provider: ingen Resend.
 * Mottagare är fakturakundens e-post – aldrig företagets/snickarens inkorg.
 * Returnerar null när inget ska skickas. Får aldrig kasta.
 */

import { isDemoBusiness, isDemoMode } from "../demo";
import { prepareCreditInvoiceMail } from "../email/service";
import { invoiceHeading } from "../invoices/display";
import { isEmailFormat } from "../settings-validation";
import { db } from "../store";
import { mailProviderAvailable, sendMail, type MailMessage, type MailSendMeta } from "../mail";
import type { Invoice } from "../types";
import { getInvoice, requireCustomer } from "./data";

export interface PreparedCreditMail {
  message: MailMessage;
  meta: MailSendMeta;
}

function customerRecipient(credit: Invoice, original: Invoice): string | null {
  const customer = requireCustomer(credit.customerId);
  const live = customer.email?.trim();
  if (live && isEmailFormat(live)) return live;
  const fromCredit = credit.issuedSnapshot?.buyer.email?.trim();
  if (fromCredit && isEmailFormat(fromCredit)) return fromCredit;
  const fromOriginal = original.issuedSnapshot?.buyer.email?.trim();
  if (fromOriginal && isEmailFormat(fromOriginal)) return fromOriginal;
  return null;
}

export function prepareCreditInvoiceNotice(credit: Invoice): PreparedCreditMail | null {
  try {
    if (isDemoBusiness() || isDemoMode()) return null;
    if (!mailProviderAvailable()) return null;
    if (credit.type !== "kredit" || credit.number == null) return null;
    if (!credit.creditsInvoiceId) return null;
    const original = getInvoice(credit.creditsInvoiceId);
    if (!original || original.number == null || original.status !== "krediterad") return null;
    const to = customerRecipient(credit, original);
    if (!to) return null;
    const company = credit.issuedSnapshot?.seller.name?.trim() || db().settings.name?.trim();
    if (!company) return null;
    const customer = requireCustomer(credit.customerId);
    return prepareCreditInvoiceMail({
      to,
      creditId: credit.id,
      company,
      customerName: customer.name,
      title: invoiceHeading(credit),
      originalNumber: original.number,
      creditNumber: credit.number,
      token: credit.token?.trim() || undefined,
    });
  } catch {
    return null;
  }
}

/** Skickar kreditnotisen. Får aldrig kasta – krediteringen är redan sparad. */
export async function sendCreditInvoiceNotice(notice: PreparedCreditMail): Promise<void> {
  try {
    await sendMail(notice.message, notice.meta);
  } catch {
    // Mejlet är sekundärt – krediteringen är redan sparad.
  }
}
