import { datumLang, kr } from "../format";
import { documentFromCompanySubject, reminderFromCompanySubject } from "./rubrik";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function layout(opts: { title: string; bodyHtml: string; footer: string }): string {
  return `<!DOCTYPE html>
<html lang="sv">
<body style="margin:0;padding:0;background:#f6f5f2;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1916;">
  <div style="max-width:560px;margin:24px auto;padding:28px 24px;background:#fff;border-radius:16px;border:1px solid #e8e4dc;">
    <p style="margin:0 0 20px;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#6b665c;">${escapeHtml(opts.title)}</p>
    ${opts.bodyHtml}
    <p style="margin:28px 0 0;font-size:13px;line-height:1.5;color:#6b665c;">${escapeHtml(opts.footer)}</p>
  </div>
</body>
</html>`;
}

function cta(href: string, label: string): string {
  return `<p style="margin:24px 0 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#1a1916;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-size:15px;font-weight:600;">${escapeHtml(label)}</a></p>`;
}

export interface QuoteEmailInput {
  businessName: string;
  customerName: string;
  quoteNumber: number;
  title: string;
  amount: number;
  validUntil: string;
  url: string;
  footer: string;
}

/** Hur kunden svarar – samma formulering i mejl och på offertlänken. */
const QUOTE_ACCEPT_HINT = "Du läser och godkänner offerten direkt via länken.";

export function quoteEmail(input: QuoteEmailInput): { subject: string; text: string; html: string } {
  const subject = documentFromCompanySubject("Offert", input.businessName, input.title);
  const valid = datumLang(input.validUntil);
  const text = [
    `Hej ${input.customerName},`,
    "",
    `Här är offert #${input.quoteNumber} från ${input.businessName} för ${input.title} på ${kr(input.amount)}.`,
    `Giltig till ${valid}.`,
    QUOTE_ACCEPT_HINT,
    "",
    "Visa offert:",
    input.url,
  ].join("\n");
  const html = layout({
    title: input.businessName,
    footer: input.footer,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:16px;">Hej ${escapeHtml(input.customerName)},</p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Här är offert <strong>#${input.quoteNumber}</strong> för ${escapeHtml(input.title)} på <strong>${escapeHtml(kr(input.amount))}</strong>.</p>
      <p style="margin:0;font-size:15px;color:#6b665c;">Giltig till ${escapeHtml(valid)}. ${escapeHtml(QUOTE_ACCEPT_HINT)}</p>
      ${cta(input.url, "Visa offert")}
    `,
  });
  return { subject, text, html };
}

export interface QuoteAcceptedEmailInput {
  businessName: string;
  quoteNumber: number;
  title: string;
  acceptedByName: string;
  /** Redan formaterad tidpunkt (Europe/Stockholm). */
  acceptedAtLabel: string;
  amount: number;
  /** Länk till offerten i appen. */
  url: string;
  footer: string;
}

/** Till företagaren: kunden har godkänt offerten. */
export function quoteAcceptedEmail(input: QuoteAcceptedEmailInput): { subject: string; text: string; html: string } {
  const subject = `Offert #${input.quoteNumber} är godkänd av ${input.acceptedByName}`;
  const lead = `${input.acceptedByName} godkände offert #${input.quoteNumber} (${input.title}) på ${kr(input.amount)} ${input.acceptedAtLabel}.`;
  const text = [
    "Hej,",
    "",
    lead,
    "Uppdraget finns nu i Driva och kan startas. Godkännandet är sparat tillsammans med offertens innehåll och tidpunkt.",
    "",
    "Öppna offerten:",
    input.url,
  ].join("\n");
  const html = layout({
    title: input.businessName,
    footer: input.footer,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:16px;">Hej,</p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;"><strong>${escapeHtml(input.acceptedByName)}</strong> godkände offert <strong>#${input.quoteNumber}</strong> (${escapeHtml(input.title)}) på <strong>${escapeHtml(kr(input.amount))}</strong> ${escapeHtml(input.acceptedAtLabel)}.</p>
      <p style="margin:0;font-size:15px;color:#6b665c;">Uppdraget finns nu i Driva och kan startas. Godkännandet är sparat tillsammans med offertens innehåll och tidpunkt.</p>
      ${cta(input.url, "Öppna offerten")}
    `,
  });
  return { subject, text, html };
}

export interface QuoteAcceptedCustomerEmailInput {
  businessName: string;
  customerName: string;
  quoteNumber: number;
  title: string;
  acceptedByName: string;
  acceptedAtLabel: string;
  amount: number;
  /** Publik godkänd offert. */
  url: string;
  /** Publik intygssida. */
  certificateUrl: string;
  footer: string;
}

/** Till kunden: bekräftelse på att offerten godkändes. Ingen e-legitimation. */
export function quoteAcceptedCustomerEmail(
  input: QuoteAcceptedCustomerEmailInput
): { subject: string; text: string; html: string } {
  const subject = `Bekräftelse: du har godkänt offert #${input.quoteNumber} från ${input.businessName}`;
  const lead = `Du har godkänt offert #${input.quoteNumber} (${input.title}) från ${input.businessName} på ${kr(input.amount)} ${input.acceptedAtLabel}.`;
  const method =
    "Godkännandet skedde genom att du skrev ditt namn och tryckte Godkänn offert på offertlänken.";
  const text = [
    `Hej ${input.customerName},`,
    "",
    lead,
    method,
    "",
    "Visa den godkända offerten:",
    input.url,
    "",
    "Intyg om godkännande:",
    input.certificateUrl,
  ].join("\n");
  const html = layout({
    title: input.businessName,
    footer: input.footer,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:16px;">Hej ${escapeHtml(input.customerName)},</p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">${escapeHtml(lead)}</p>
      <p style="margin:0;font-size:15px;color:#6b665c;">${escapeHtml(method)}</p>
      ${cta(input.url, "Visa den godkända offerten")}
      <p style="margin:16px 0 0;font-size:14px;"><a href="${escapeHtml(input.certificateUrl)}" style="color:#1a1916;">Intyg om godkännande</a></p>
    `,
  });
  return { subject, text, html };
}

export interface InvoiceEmailInput {
  businessName: string;
  customerName: string;
  invoiceNumber: number;
  /** Dokumentets rubrik (offerttitel, första rad, uppdrag) – inte löpnummer. */
  title: string;
  amount: number;
  dueDate: string;
  ocr?: string;
  bankgiro?: string;
  plusgiro?: string;
  url: string;
  footer: string;
}

function paymentLines(input: Pick<InvoiceEmailInput, "ocr" | "bankgiro" | "plusgiro">): string[] {
  const lines: string[] = [];
  if (input.ocr?.trim()) lines.push(`OCR: ${input.ocr.trim()}`);
  if (input.bankgiro?.trim()) lines.push(`Bankgiro: ${input.bankgiro.trim()}`);
  if (input.plusgiro?.trim()) lines.push(`PlusGiro: ${input.plusgiro.trim()}`);
  return lines;
}

export function invoiceEmail(input: InvoiceEmailInput): { subject: string; text: string; html: string } {
  const subject = documentFromCompanySubject("Faktura", input.businessName, input.title);
  const due = datumLang(input.dueDate);
  const pay = paymentLines(input);
  const text = [
    `Hej ${input.customerName},`,
    "",
    `Här kommer faktura #${input.invoiceNumber} från ${input.businessName} på ${kr(input.amount)}.`,
    `Förfallodatum: ${due}.`,
    ...pay,
    "",
    "Visa faktura:",
    input.url,
  ].join("\n");
  const html = layout({
    title: input.businessName,
    footer: input.footer,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:16px;">Hej ${escapeHtml(input.customerName)},</p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Här kommer faktura <strong>#${input.invoiceNumber}</strong> på <strong>${escapeHtml(kr(input.amount))}</strong>.</p>
      <p style="margin:0;font-size:15px;color:#6b665c;">Förfallodatum: ${escapeHtml(due)}${pay.length ? `. ${escapeHtml(pay.join(" · "))}` : "."}</p>
      ${cta(input.url, "Visa faktura")}
    `,
  });
  return { subject, text, html };
}

export interface InvoiceReminderEmailInput extends InvoiceEmailInput {
  outstanding: number;
  partial?: boolean;
}

export function invoiceReminderEmail(input: InvoiceReminderEmailInput): { subject: string; text: string; html: string } {
  const subject = reminderFromCompanySubject("faktura", input.businessName, input.title);
  const due = datumLang(input.dueDate);
  const pay = paymentLines(input);
  const lead = input.partial
    ? `En vänlig påminnelse om faktura #${input.invoiceNumber}: ${kr(input.outstanding)} återstår att betala (förföll ${due}).`
    : `En vänlig påminnelse om faktura #${input.invoiceNumber} på ${kr(input.outstanding)} som förföll ${due}.`;
  const text = [`Hej ${input.customerName},`, "", lead, ...pay, "", input.url].join("\n");
  const html = layout({
    title: input.businessName,
    footer: input.footer,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:16px;">Hej ${escapeHtml(input.customerName)},</p>
      <p style="margin:0;font-size:15px;line-height:1.55;">${escapeHtml(lead)}</p>
      ${pay.length ? `<p style="margin:12px 0 0;font-size:15px;color:#6b665c;">${escapeHtml(pay.join(" · "))}</p>` : ""}
      ${cta(input.url, "Visa faktura")}
    `,
  });
  return { subject, text, html };
}

export interface CreditInvoiceEmailInput {
  businessName: string;
  customerName: string;
  /** Samma rubrik som på kreditdokumentet (`invoiceHeading`). */
  title: string;
  originalNumber: number;
  creditNumber: number;
  /** Publik kreditfaktura `/faktura/[token]` – utelämnas om länken saknas. */
  url?: string;
  footer: string;
}

/** Till fakturakunden efter hel kredit – inte till snickaren. */
export function creditInvoiceEmail(input: CreditInvoiceEmailInput): { subject: string; text: string; html: string } {
  const subject = `Kreditfaktura från ${input.businessName} – ${input.title}`;
  const lead = `Faktura #${input.originalNumber} är krediterad i sin helhet med kreditfaktura #${input.creditNumber}. Du ska inte betala faktura #${input.originalNumber}.`;
  const text = [
    `Hej ${input.customerName},`,
    "",
    lead,
    ...(input.url ? ["", "Visa kreditfakturan:", input.url] : []),
  ].join("\n");
  const html = layout({
    title: input.businessName,
    footer: input.footer,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:16px;">Hej ${escapeHtml(input.customerName)},</p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">${escapeHtml(lead)}</p>
      ${input.url ? cta(input.url, "Visa kreditfakturan") : ""}
    `,
  });
  return { subject, text, html };
}

export interface QuoteFollowUpEmailInput {
  businessName: string;
  customerName: string;
  quoteNumber: number;
  title: string;
  validUntil: string;
  url: string;
  footer: string;
}

export function quoteFollowUpEmail(input: QuoteFollowUpEmailInput): { subject: string; text: string; html: string } {
  const subject = reminderFromCompanySubject("offert", input.businessName, input.title);
  const valid = datumLang(input.validUntil);
  const text = [
    `Hej ${input.customerName},`,
    "",
    `Har du hunnit titta på vår offert för ${input.title}?`,
    `Du kan läsa och godkänna den här (giltig till ${valid}):`,
    input.url,
  ].join("\n");
  const html = layout({
    title: input.businessName,
    footer: input.footer,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:16px;">Hej ${escapeHtml(input.customerName)},</p>
      <p style="margin:0;font-size:15px;line-height:1.55;">Har du hunnit titta på vår offert för ${escapeHtml(input.title)}? Giltig till ${escapeHtml(valid)}.</p>
      ${cta(input.url, "Visa offert")}
    `,
  });
  return { subject, text, html };
}

export interface CollaborationInviteEmailInput {
  invitedByName: string;
  companyName: string;
  roleLabel: string;
  url: string;
  expiresDays: number;
}

export function collaborationInviteEmail(input: CollaborationInviteEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `${input.invitedByName} bjuder in dig till ${input.companyName} i Driva`;
  const text = [
    `${input.invitedByName} bjuder in dig som ${input.roleLabel.toLowerCase()} för ${input.companyName} i Driva.`,
    "",
    "Öppna länken för att acceptera:",
    input.url,
    "",
    `Länken kan bara användas en gång och slutar gälla om ${input.expiresDays} dagar.`,
  ].join("\n");
  const html = layout({
    title: "Driva",
    footer: `Länken kan bara användas en gång och slutar gälla om ${input.expiresDays} dagar.`,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">${escapeHtml(input.invitedByName)} bjuder in dig som ${escapeHtml(input.roleLabel.toLowerCase())} för <strong>${escapeHtml(input.companyName)}</strong> i Driva.</p>
      ${cta(input.url, "Acceptera inbjudan")}
    `,
  });
  return { subject, text, html };
}
