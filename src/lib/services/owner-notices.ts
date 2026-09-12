/**
 * Notiser till företagaren – serverdelen.
 *
 * Kuvertet byggs INNE i tenantkontexten (företagsnamn, mottagare, länkar) och
 * skickas av anroparen efter svaret (next/server `after`), så att kunden,
 * webhooken eller grossistens mejl aldrig väntar på e-posttjänsten.
 * Får aldrig kasta: en notis som inte går fram påverkar aldrig händelsen.
 */

import { db, save } from "../store";
import { isDemoBusiness } from "../demo";
import { absoluteAppUrl, mailFromAddress, mailProviderAvailable, sendMail, type MailMessage, type MailSendMeta } from "../mail";
import { tenantContext } from "../storage/context";
import { isEmailFormat } from "../settings-validation";
import type { InboxItem, OwnerNoticeKind, OwnerNoticeSettings } from "../types";
import {
  OWNER_NOTICE_KINDS,
  normalizeOwnerNoticeSettings,
  ownerNoticeEnabled,
  ownerNoticeRecipient,
} from "../notices/owner-notices";
import {
  inboxDocumentEmail,
  orderConfirmationEmail,
  ownerNoticeTestEmail,
  quoteDeclinedEmail,
  type BuiltMail,
} from "../email/owner-notice-templates";
import { currentVersion, getQuote, quoteTotals, requireCustomer } from "./data";
import { amountIsCertain } from "../inbox/workflow";
import { connectionLabel, DEVIATION_LABELS } from "../wholesalers/labels";
import { logActivity } from "./activity";

export interface PreparedOwnerNotice {
  kind: OwnerNoticeKind | "test";
  message: MailMessage;
  meta: MailSendMeta;
}

/* -------------------------------- inställningar ----------------------------- */

export interface OwnerNoticeSettingsInput {
  email: string;
  off: OwnerNoticeKind[];
}

export function getOwnerNoticeSettings(): { email: string; off: OwnerNoticeKind[]; recipient?: string } {
  const s = db().settings;
  return {
    email: s.notices?.email ?? "",
    off: OWNER_NOTICE_KINDS.filter((k) => !ownerNoticeEnabled(s, k)),
    recipient: ownerNoticeRecipient(s),
  };
}

export function updateOwnerNoticeSettings(input: OwnerNoticeSettingsInput): OwnerNoticeSettings | undefined {
  const email = input.email.trim();
  if (email && !isEmailFormat(email)) throw new Error("Ange en giltig e-postadress.");
  const s = db().settings;
  const next = normalizeOwnerNoticeSettings({ email, off: input.off }, s);
  if (next) s.notices = next;
  else delete s.notices;
  logActivity("Inställningarna för notiser uppdaterades.");
  save();
  return next;
}

/* --------------------------------- gemensamt -------------------------------- */

function footer(): string {
  const s = db().settings;
  return [s.name, s.phone, s.email].filter(Boolean).join(" · ");
}

function envelope(to: string, built: BuiltMail): MailMessage {
  return { to, from: mailFromAddress(), subject: built.subject, text: built.text, html: built.html };
}

/**
 * Bygger en notis om händelsen är på, det finns en giltig mottagare och en
 * riktig utskicksväg. Demoföretaget skickar aldrig notiser – det är publikt.
 */
function prepare(kind: OwnerNoticeKind, documentId: string | undefined, build: () => BuiltMail): PreparedOwnerNotice | undefined {
  try {
    const settings = db().settings;
    if (isDemoBusiness()) return undefined;
    if (!mailProviderAvailable()) return undefined;
    if (!ownerNoticeEnabled(settings, kind)) return undefined;
    const to = ownerNoticeRecipient(settings);
    if (!to) return undefined;
    return {
      kind,
      message: envelope(to, build()),
      meta: { kind: `notis:${kind}`, documentId, businessId: tenantContext()?.businessId },
    };
  } catch {
    return undefined;
  }
}

/** Skicka förberedda notiser – sekundärt, sväljer alla fel. För `after()`. */
export async function sendOwnerNotices(notices: PreparedOwnerNotice[] | undefined): Promise<void> {
  for (const notice of notices ?? []) {
    try {
      await sendMail(notice.message, notice.meta);
    } catch {
      // Notisen är sekundär – händelsen är redan sparad.
    }
  }
}

/* ------------------------------- offert avböjd ------------------------------ */

export function prepareQuoteDeclinedNotice(quoteId: string): PreparedOwnerNotice | undefined {
  return prepare("offert_avbojd", quoteId, () => {
    const quote = getQuote(quoteId);
    if (!quote) throw new Error("Offerten finns inte.");
    const customer = requireCustomer(quote.customerId);
    return quoteDeclinedEmail({
      businessName: db().settings.name,
      quoteNumber: quote.number,
      title: currentVersion(quote).title,
      customerName: customer.name,
      amount: quoteTotals(quote).toPay,
      reason: quote.declineReason,
      url: absoluteAppUrl(`/ekonomi/offerter/${quote.id}`),
      footer: footer(),
    });
  });
}

/* ----------------------------- dokument via mejl ---------------------------- */

/**
 * Efter ingest av ett INKOMMANDE mejl (aldrig egna uppladdningar – då står
 * användaren redan i appen). Orderbekräftelser har egen händelsetyp.
 */
export function prepareInboxArrivalNotice(item: InboxItem, opts: { created: boolean }): PreparedOwnerNotice | undefined {
  if (!opts.created || item.source !== "email") return undefined;
  if (item.documentType === "orderbekraftelse") return prepareOrderConfirmationNotice(item);

  return prepare("inkorg", item.id, () => {
    const booked = item.status === "bokford";
    const needsReview = !booked && (item.status === "ny" || !amountIsCertain(item));
    const word: "faktura" | "kvitto" | "dokument" =
      item.documentType === "kvitto" ? "kvitto" : item.parsedInvoiceNumber || item.supplierInvoiceId ? "faktura" : "dokument";
    const outcome = booked ? "bokford" : needsReview && (item.parsedSupplier || item.parsedAmount != null) ? "kontrollera" : "vantar";
    return inboxDocumentEmail({
      businessName: db().settings.name,
      documentWord: word,
      supplier: item.parsedSupplier,
      amount: item.parsedAmount,
      outcome,
      subject: item.subject,
      url: absoluteAppUrl(outcome === "kontrollera" && !amountIsCertain(item) ? `/bokforing/underlag/${item.id}/kontrollera` : `/bokforing/underlag/${item.id}`),
      footer: footer(),
    });
  });
}

function prepareOrderConfirmationNotice(item: InboxItem): PreparedOwnerNotice | undefined {
  return prepare("orderbekraftelse", item.id, () => {
    const data = db();
    const confirmation = item.purchaseOrderConfirmationId
      ? (data.purchaseOrderConfirmations ?? []).find((c) => c.id === item.purchaseOrderConfirmationId)
      : undefined;
    const order = confirmation ? (data.purchaseOrders ?? []).find((o) => o.id === confirmation.orderId) : undefined;
    const connection = order ? (data.wholesalerConnections ?? []).find((c) => c.id === order.connectionId) : undefined;
    const job = order ? data.jobs.find((j) => j.id === order.jobId) : undefined;
    const wholesalerName = connection ? connectionLabel(connection) : item.parsedSupplier?.trim() || item.fromAddress;
    const deviations = Array.from(new Set(confirmation?.deviations ?? [])).map((d) => DEVIATION_LABELS[d]);
    const status = !order ? "okopplad" : deviations.length > 0 || confirmation?.status === "needs_review" ? "avviker" : "stammer";
    return orderConfirmationEmail({
      businessName: data.settings.name,
      wholesalerName,
      orderNumber: confirmation?.wholesalerOrderNumber ?? order?.wholesalerOrderNumber,
      jobTitle: job?.title,
      status,
      deviations,
      url: absoluteAppUrl(order ? `/uppdrag/${order.jobId}/bestallning/${order.id}` : `/bokforing/underlag/${item.id}`),
      footer: footer(),
    });
  });
}

/* ---------------------------------- testnotis -------------------------------- */

/** Testmejl från Inställningar → Notiser. Går alltid till den sparade mottagaren. */
export function prepareOwnerNoticeTest(): { ok: true; notice: PreparedOwnerNotice; to: string } | { ok: false; error: string } {
  const settings = db().settings;
  if (isDemoBusiness()) return { ok: false, error: "Demoföretaget skickar inga riktiga mejl." };
  const to = ownerNoticeRecipient(settings);
  if (!to) return { ok: false, error: "Ange en giltig e-postadress först – under Företag eller här." };
  const built = ownerNoticeTestEmail({ businessName: settings.name, footer: footer(), url: absoluteAppUrl("/") });
  return {
    ok: true,
    to,
    notice: { kind: "test", message: envelope(to, built), meta: { kind: "notis:test", businessId: tenantContext()?.businessId } },
  };
}
