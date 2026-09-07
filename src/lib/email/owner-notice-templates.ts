/**
 * Mejl till företagaren om sådant som hände utanför appen. Kort, konkret och
 * med EN knapp som landar exakt där nästa steg tas. Samma layout som
 * kundmejlen (templates.ts) så avsändaren känns igen.
 */

import { kr } from "../format";
import { emailCta, emailLayout, escapeHtml } from "./templates";

export interface BuiltMail {
  subject: string;
  text: string;
  html: string;
}

function paragraph(text: string, muted = false): string {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;${muted ? "color:#6b665c;" : ""}">${text}</p>`;
}

function build(input: {
  businessName: string;
  footer: string;
  subject: string;
  lead: string;
  leadHtml: string;
  detail?: string;
  cta: { href: string; label: string };
}): BuiltMail {
  const text = ["Hej,", "", input.lead, ...(input.detail ? [input.detail] : []), "", `${input.cta.label}:`, input.cta.href].join(
    "\n",
  );
  const html = emailLayout({
    title: input.businessName,
    footer: input.footer,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:16px;">Hej,</p>
      ${paragraph(input.leadHtml)}
      ${input.detail ? paragraph(escapeHtml(input.detail), true) : ""}
      ${emailCta(input.cta.href, input.cta.label)}
    `,
  });
  return { subject: input.subject, text, html };
}

/* ------------------------------ Offert avböjd ------------------------------ */

export interface QuoteDeclinedEmailInput {
  businessName: string;
  quoteNumber: number;
  title: string;
  customerName: string;
  amount: number;
  reason?: string;
  url: string;
  footer: string;
}

export function quoteDeclinedEmail(input: QuoteDeclinedEmailInput): BuiltMail {
  const reason = input.reason?.trim();
  return build({
    businessName: input.businessName,
    footer: input.footer,
    subject: `Offert #${input.quoteNumber} avböjdes av ${input.customerName}`,
    lead: `${input.customerName} avböjde offert #${input.quoteNumber} (${input.title}) på ${kr(input.amount)}.${reason ? ` Skäl: ”${reason}”` : ""}`,
    leadHtml: `<strong>${escapeHtml(input.customerName)}</strong> avböjde offert <strong>#${input.quoteNumber}</strong> (${escapeHtml(input.title)}) på <strong>${escapeHtml(kr(input.amount))}</strong>.${reason ? ` Skäl: <em>”${escapeHtml(reason)}”</em>` : ""}`,
    detail: reason
      ? "Ett samtal löser ofta det som ett nej i formuläret inte gör – offerten går att justera och skicka igen."
      : "Kunden lämnade inget skäl. Offerten går att justera och skicka igen.",
    cta: { href: input.url, label: "Öppna offerten" },
  });
}

/* ----------------------------- Dokument i inkorgen ------------------------- */

export type InboxNoticeOutcome = "bokford" | "kontrollera" | "vantar";

export interface InboxDocumentEmailInput {
  businessName: string;
  /** "faktura" | "kvitto" | "dokument" – bestämmer rubrikens ord. */
  documentWord: "faktura" | "kvitto" | "dokument";
  supplier?: string;
  amount?: number;
  outcome: InboxNoticeOutcome;
  /** Ämnesraden på mejlet som kom in – visas när avsändare/belopp saknas. */
  subject?: string;
  url: string;
  footer: string;
}

export function inboxDocumentEmail(input: InboxDocumentEmailInput): BuiltMail {
  const who = input.supplier?.trim() || input.subject?.trim() || "okänd avsändare";
  const word = input.documentWord;
  const Word = word.charAt(0).toUpperCase() + word.slice(1);
  // Faktura är femininum/utrum (en, bokförd); kvitto och dokument är neutrum (ett, bokfört).
  const neuter = word !== "faktura";
  const booked = neuter ? "bokfört" : "bokförd";
  const article = neuter ? "Ett" : "En";
  const amount = input.amount != null ? kr(input.amount) : undefined;

  const subject =
    input.outcome === "bokford"
      ? `${Word} från ${who} är ${booked}${amount ? ` – ${amount}` : ""}`
      : input.outcome === "kontrollera"
        ? `${Word} från ${who} behöver kontrolleras`
        : `Nytt dokument i inkorgen${input.supplier ? ` från ${input.supplier}` : ""}`;

  const arrived = `${article} ${word} från ${who}${amount ? ` på ${amount}` : ""} kom in via mejl`;
  const arrivedHtml = `${article} ${word} från <strong>${escapeHtml(who)}</strong>${amount ? ` på <strong>${escapeHtml(amount)}</strong>` : ""} kom in via mejl`;

  const tail =
    input.outcome === "bokford"
      ? word === "faktura"
        ? " och är bokförd. Betalningen ligger klar att godkänna när det passar."
        : " och är bokfört. Ingenting mer att göra."
      : input.outcome === "kontrollera"
        ? ". Uppgifterna kunde inte läsas säkert – kontrollera dem mot dokumentet, sedan bokförs det."
        : ". Det väntar i inkorgen tills du tittat på det.";

  return build({
    businessName: input.businessName,
    footer: input.footer,
    subject,
    lead: `${arrived}${tail}`,
    leadHtml: `${arrivedHtml}${escapeHtml(tail)}`,
    cta: { href: input.url, label: input.outcome === "kontrollera" ? "Kontrollera" : "Öppna i inboxen" },
  });
}

/* ------------------------------ Orderbekräftelse --------------------------- */

export type OrderConfirmationNoticeStatus = "stammer" | "avviker" | "okopplad";

export interface OrderConfirmationEmailInput {
  businessName: string;
  wholesalerName: string;
  orderNumber?: string;
  jobTitle?: string;
  status: OrderConfirmationNoticeStatus;
  /** Läsbara avvikelser (DEVIATION_LABELS), tomt när allt stämmer. */
  deviations: string[];
  url: string;
  footer: string;
}

export function orderConfirmationEmail(input: OrderConfirmationEmailInput): BuiltMail {
  const order = input.orderNumber ? ` (order ${input.orderNumber})` : "";
  const job = input.jobTitle ? ` till ${input.jobTitle}` : "";
  const subject =
    input.status === "stammer"
      ? `Orderbekräftelse från ${input.wholesalerName} stämmer med beställningen`
      : input.status === "avviker"
        ? `Orderbekräftelse från ${input.wholesalerName} avviker från beställningen`
        : `Orderbekräftelse från ${input.wholesalerName} kunde inte kopplas till en beställning`;

  const lead =
    input.status === "stammer"
      ? `${input.wholesalerName} bekräftade beställningen${job}${order}. Allt stämmer med det du beställde.`
      : input.status === "avviker"
        ? `${input.wholesalerName} bekräftade beställningen${job}${order}, men något skiljer sig: ${input.deviations.join(", ").toLowerCase()}.`
        : `En orderbekräftelse från ${input.wholesalerName} kom in men matchade ingen skickad beställning. Välj vilken den hör till.`;

  const leadHtml =
    input.status === "stammer"
      ? `<strong>${escapeHtml(input.wholesalerName)}</strong> bekräftade beställningen${escapeHtml(job)}${escapeHtml(order)}. Allt stämmer med det du beställde.`
      : input.status === "avviker"
        ? `<strong>${escapeHtml(input.wholesalerName)}</strong> bekräftade beställningen${escapeHtml(job)}${escapeHtml(order)}, men något skiljer sig: <strong>${escapeHtml(input.deviations.join(", ").toLowerCase())}</strong>.`
        : `En orderbekräftelse från <strong>${escapeHtml(input.wholesalerName)}</strong> kom in men matchade ingen skickad beställning. Välj vilken den hör till.`;

  return build({
    businessName: input.businessName,
    footer: input.footer,
    subject,
    lead,
    leadHtml,
    detail:
      input.status === "avviker"
        ? "Materialraderna på uppdraget uppdateras när du godkänt avvikelserna – kundpriset följer med."
        : undefined,
    cta: {
      href: input.url,
      label: input.status === "okopplad" ? "Välj beställning" : input.status === "avviker" ? "Granska avvikelserna" : "Visa bekräftelsen",
    },
  });
}

/* --------------------------------- Testnotis -------------------------------- */

export function ownerNoticeTestEmail(input: { businessName: string; footer: string; url: string }): BuiltMail {
  return build({
    businessName: input.businessName,
    footer: input.footer,
    subject: `Så här ser notiser från Driva ut`,
    lead: "Det här är ett testmejl från Inställningar → Notiser. När en kund svarar på en offert, en förfrågan kommer in från hemsidan eller en faktura landar i inkorgen får du ett mejl som det här.",
    leadHtml:
      "Det här är ett testmejl från <strong>Inställningar → Notiser</strong>. När en kund svarar på en offert, en förfrågan kommer in från hemsidan eller en faktura landar i inkorgen får du ett mejl som det här.",
    detail: "Du väljer själv vilka händelser som mejlas, och till vilken adress.",
    cta: { href: input.url, label: "Öppna Driva" },
  });
}
