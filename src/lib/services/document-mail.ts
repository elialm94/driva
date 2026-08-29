import { db } from "../store";
import { absoluteAppUrl, isLiveMailConfigured, mailFromAddress, sendMail, type MailMessage, type MailResult } from "../mail";
import { getInvoice, getQuote, currentVersion, invoiceOutstanding, invoiceTotals, quoteTotals, requireCustomer } from "./data";
import { deliverInvoice, issueInvoice, sendReminder, type Actor } from "./invoices";
import { followUpQuote, sendQuote } from "./quotes";
import { kr, datumLang } from "../format";

/**
 * E-postleverans av offerter, fakturor och påminnelser.
 *
 * Domäntjänsterna (sendQuote/deliverInvoice/…) äger tillståndet och är synkrona.
 * Det här lagret bygger mejlet, skickar via mail.ts (Resend när RESEND_API_KEY +
 * MAIL_FROM finns, annars mock som bara loggar) och rapporterar ärligt läge
 * tillbaka: "skickad med e-post" ≠ "markerad som skickad utan e-post".
 *
 * Vid misslyckad live-leverans rullas ingenting tillbaka: en utfärdad faktura
 * behåller nummer, snapshot och bokföring – bara leveransen får göras om.
 */

export type DeliveryOutcome = { mode: MailResult["mode"]; ok: boolean; error?: string };

function fromAddress(): string {
  const s = db().settings;
  return mailFromAddress() || s.email || s.name;
}

function footer(): string {
  const s = db().settings;
  return [s.name, s.phone, s.email].filter(Boolean).join(" · ");
}

function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:sans-serif;line-height:1.5;white-space:pre-wrap">${esc}</div>`;
}

function buildMessage(input: { to: string; subject: string; lines: string[] }): MailMessage {
  const text = [...input.lines, "", footer()].join("\n");
  return {
    to: input.to,
    from: fromAddress(),
    replyTo: db().settings.email || undefined,
    subject: input.subject,
    text,
    html: textToHtml(text),
  };
}

/** Skicka mejl till kund. Live-läge kräver mottagaradress; mock loggar bara. */
async function deliverToCustomer(email: string, message: () => MailMessage): Promise<DeliveryOutcome> {
  if (isLiveMailConfigured() && !email.trim()) {
    return { mode: "live", ok: false, error: "Kunden saknar e-postadress. Lägg till den på kundkortet eller dela länken manuellt." };
  }
  const result = await sendMail(message());
  return result.ok ? { mode: result.mode, ok: true } : { mode: result.mode, ok: false, error: result.error };
}

/** Skicka offerten: markera skickad + e-posta kundlänken. */
export async function sendQuoteWithEmail(quoteId: string): Promise<{ outcome: DeliveryOutcome }> {
  const quote = getQuote(quoteId);
  if (!quote) throw new Error("Offerten finns inte");
  const customer = requireCustomer(quote.customerId);
  const version = currentVersion(quote);
  const t = quoteTotals(quote);

  const outcome = await deliverToCustomer(customer.email, () =>
    buildMessage({
      to: customer.email,
      subject: `Offert #${quote.number} från ${db().settings.name}`,
      lines: [
        `Hej ${customer.name},`,
        "",
        `Här är vår offert för ${version.title} på ${kr(t.toPay)}.`,
        `Du kan läsa och godkänna den här (giltig till ${datumLang(version.validUntil)}):`,
        absoluteAppUrl(`/offert/${quote.token}`),
      ],
    })
  );
  if (outcome.ok) {
    sendQuote(quoteId, outcome);
  }
  return { outcome };
}

/** Utfärda (nummer + snapshot + bokföring) och e-posta fakturan. Leveransfel rullar aldrig tillbaka utfärdandet. */
export async function issueAndEmailInvoice(invoiceId: string, createdBy: Actor = "anvandare"): Promise<{ outcome: DeliveryOutcome }> {
  issueInvoice(invoiceId, createdBy);
  return emailInvoice(invoiceId, createdBy);
}

/** E-posta en utfärdad faktura (första gången eller igen). */
export async function emailInvoice(invoiceId: string, createdBy: Actor = "anvandare"): Promise<{ outcome: DeliveryOutcome }> {
  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new Error("Fakturan finns inte");
  if (invoice.status === "utkast") throw new Error("Utkast kan inte skickas innan fakturan är utfärdad.");
  const customer = requireCustomer(invoice.customerId);
  const t = invoiceTotals(invoice);

  const outcome = await deliverToCustomer(customer.email, () =>
    buildMessage({
      to: customer.email,
      subject: `Faktura #${invoice.number} från ${db().settings.name}`,
      lines: [
        `Hej ${customer.name},`,
        "",
        `Här kommer faktura #${invoice.number} på ${kr(t.toPay)}.`,
        `Förfallodatum: ${datumLang(invoice.dueDate)}. OCR: ${invoice.ocr}.`,
        `Du hittar fakturan här:`,
        absoluteAppUrl(`/faktura/${invoice.token}`),
      ],
    })
  );
  if (outcome.ok) {
    deliverInvoice(invoiceId, createdBy, outcome);
  } else {
    // Ärlig logg – utfärdandet står kvar, bara leveransen misslyckades.
    const { logActivity } = await import("./activity");
    logActivity(`Faktura #${invoice.number} kunde inte e-postas till ${customer.name}: ${outcome.error}`, {
      customerId: customer.id,
      entity: { type: "faktura", id: invoice.id },
      createdBy,
    });
  }
  return { outcome };
}

/** E-posta betalningspåminnelse för en försenad faktura. */
export async function remindInvoiceByEmail(invoiceId: string, by: Actor = "anvandare"): Promise<{ outcome: DeliveryOutcome }> {
  const invoice = getInvoice(invoiceId);
  if (!invoice || !(invoice.status === "skickad" || invoice.status === "delbetald") || invoice.type === "kredit") {
    return { outcome: { mode: "mock", ok: false, error: "Fakturan kan inte påminnas." } };
  }
  const customer = requireCustomer(invoice.customerId);
  const due = invoiceOutstanding(invoice);
  const outcome = await deliverToCustomer(customer.email, () =>
    buildMessage({
      to: customer.email,
      subject: `Påminnelse: faktura #${invoice.number} från ${db().settings.name}`,
      lines: [
        `Hej ${customer.name},`,
        "",
        invoice.status === "delbetald"
          ? `En vänlig påminnelse om faktura #${invoice.number}: ${kr(due)} återstår att betala (förföll ${datumLang(invoice.dueDate)}).`
          : `En vänlig påminnelse om faktura #${invoice.number} på ${kr(due)} som förföll ${datumLang(invoice.dueDate)}.`,
        `OCR: ${invoice.ocr}.`,
        absoluteAppUrl(`/faktura/${invoice.token}`),
      ],
    })
  );
  if (outcome.ok) sendReminder(invoiceId, by, outcome);
  return { outcome };
}

/** E-posta en påminnelse om en obesvarad offert. */
export async function followUpQuoteByEmail(quoteId: string, by: "anvandare" | "assistent" = "anvandare"): Promise<{ outcome: DeliveryOutcome }> {
  const quote = getQuote(quoteId);
  if (!quote || quote.status !== "skickad") {
    return { outcome: { mode: "mock", ok: false, error: "Offerten väntar inte på svar." } };
  }
  const customer = requireCustomer(quote.customerId);
  const version = currentVersion(quote);
  const outcome = await deliverToCustomer(customer.email, () =>
    buildMessage({
      to: customer.email,
      subject: `Påminnelse: offert #${quote.number} från ${db().settings.name}`,
      lines: [
        `Hej ${customer.name},`,
        "",
        `Har du hunnit titta på vår offert för ${version.title}?`,
        `Du kan läsa och godkänna den här (giltig till ${datumLang(version.validUntil)}):`,
        absoluteAppUrl(`/offert/${quote.token}`),
      ],
    })
  );
  if (outcome.ok) followUpQuote(quoteId, by, outcome);
  return { outcome };
}
