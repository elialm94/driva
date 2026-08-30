import { datumLang, kr } from "../format";

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
  bankidEnabled: boolean;
  footer: string;
}

export function quoteEmail(input: QuoteEmailInput): { subject: string; text: string; html: string } {
  const subject = `Offert #${input.quoteNumber} från ${input.businessName}`;
  const valid = datumLang(input.validUntil);
  const bankid = input.bankidEnabled
    ? "Du godkänner offerten med BankID via länken."
    : "Öppna länken för att läsa offerten.";
  const text = [
    `Hej ${input.customerName},`,
    "",
    `Här är offert #${input.quoteNumber} från ${input.businessName} för ${input.title} på ${kr(input.amount)}.`,
    `Giltig till ${valid}.`,
    bankid,
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
      <p style="margin:0;font-size:15px;color:#6b665c;">Giltig till ${escapeHtml(valid)}. ${escapeHtml(bankid)}</p>
      ${cta(input.url, "Visa offert")}
    `,
  });
  return { subject, text, html };
}

export interface InvoiceEmailInput {
  businessName: string;
  customerName: string;
  invoiceNumber: number;
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
  const subject = `Faktura #${input.invoiceNumber} från ${input.businessName}`;
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
  const subject = `Påminnelse om faktura #${input.invoiceNumber}`;
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
  const subject = `Påminnelse: offert #${input.quoteNumber} från ${input.businessName}`;
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
