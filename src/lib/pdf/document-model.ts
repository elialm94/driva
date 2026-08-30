/**
 * Kanonisk dokumentmodell för offert- och faktura-PDF.
 * Samma snapshots och docTotals som webbvyn – ingen egen ekonomi.
 */

import type {
  BankIDSignature,
  CompanySettings,
  Customer,
  DocLine,
  Invoice,
  Quote,
  QuoteHousingSnapshot,
  QuoteVersion,
} from "../types";
import { docTotals, lineTotal, vatBreakdown, type DocTotals, type VatBreakdownRow } from "../calc";
import { kr, datumLang, datumNumeriskt, datumTid } from "../format";
import { lineKindLabel } from "../economic-line-type";
import { richTextToPlain } from "../richtext";
import {
  housingLinesFromDetails,
  resolveInvoiceView,
  resolveQuoteView,
} from "../invoices/snapshot";
import { invoiceNumberLabel, invoiceTypeLabel, sameCalendarDay } from "../invoices/display";
import {
  getInvoiceTaxReductionDisclaimer,
  getTaxReductionTerms,
  taxReductionCalcHintText,
  taxReductionDeductionLabel,
} from "../tax-reduction-terms";
import { signedWithBankIdBy } from "../status-labels";
import { db } from "../store";
import { currentVersion, getQuote, quoteSignature, requireCustomer } from "../services/data";

export type PdfLine = {
  description: string;
  kind: string;
  qty: string;
  unitPrice: string;
  vat: string;
  sum: string;
};

export type PdfMeta = { label: string; value: string };

export type PdfKv = { label: string; value: string; emphasis?: boolean };

export type BusinessPdfModel = {
  kind: "offert" | "faktura";
  draft: boolean;
  docType: string;
  docNumber: string;
  title?: string;
  intro?: string;
  richText?: string;
  seller: CompanySettings;
  buyerName: string;
  buyerAddress: string[];
  meta: PdfMeta[];
  lines: PdfLine[];
  totals: PdfKv[];
  toPayLabel: string;
  toPay: string;
  housing?: string[];
  rotHeading?: string;
  rotBody?: string;
  rotHint?: string;
  paymentPlan?: { label: string; value: string }[];
  paymentTerms?: string;
  terms?: string;
  paymentBox?: { label: string; value: string }[];
  paymentNote?: string;
  signHeading?: string;
  signBody?: string;
  related?: string;
  creditNote?: string;
  paidNote?: string;
  filename: string;
};

function addressLines(party: { address?: string; postalCode?: string; city?: string; orgNumber?: string }): string[] {
  const lines: string[] = [];
  if (party.address?.trim()) lines.push(party.address.trim());
  const city = [party.postalCode, party.city].filter(Boolean).join(" ").trim();
  if (city) lines.push(city);
  if (party.orgNumber?.trim()) lines.push(`Org.nr ${party.orgNumber.trim()}`);
  return lines;
}

function housingBits(housing: QuoteHousingSnapshot | null | undefined): string[] {
  if (!housing) return [];
  const bits: string[] = [];
  if (housing.label) bits.push(housing.label);
  if (housing.workAddress) bits.push(housing.workAddress);
  if (housing.housing?.dwellingType === "smahus" && housing.housing.propertyDesignation) {
    bits.push(`Fastighetsbeteckning ${housing.housing.propertyDesignation}`);
  }
  if (housing.housing?.dwellingType === "bostadsratt") {
    if (housing.housing.brfOrgNumber) bits.push(`BRF org.nr ${housing.housing.brfOrgNumber}`);
    if (housing.housing.apartmentNumber) bits.push(`Lgh ${housing.housing.apartmentNumber}`);
  }
  return bits;
}

function totalsRows(t: DocTotals, vat: VatBreakdownRow[], rot: QuoteVersion["rot"]): PdfKv[] {
  const rows: PdfKv[] = [{ label: "Summa exkl. moms", value: kr(t.subtotal) }];
  for (const v of vat) {
    rows.push({ label: `Moms ${v.rate} %`, value: kr(v.vat) });
  }
  if (vat.length > 1) rows.push({ label: "Moms totalt", value: kr(t.vat) });
  rows.push({ label: "Totalt inkl. moms", value: kr(t.total), emphasis: true });
  if (rot) {
    rows.push({ label: "Arbetskostnad inkl. moms", value: kr(t.laborInclVat) });
    rows.push({ label: taxReductionDeductionLabel(rot.type), value: `−${kr(t.deduction)}` });
  }
  return rows;
}

function lineRows(lines: DocLine[]): PdfLine[] {
  return lines.map((line) => ({
    description: line.description,
    kind: lineKindLabel(line.kind),
    qty: `${line.qty} ${line.unit}`,
    unitPrice: kr(line.unitPrice),
    vat: `${line.vatRate} %`,
    sum: kr(lineTotal(line)),
  }));
}

export function quotePdfModel(
  quote: Quote,
  live: { seller: CompanySettings; buyer: Customer },
  version = currentVersion(quote),
  signature?: BankIDSignature
): BusinessPdfModel {
  const view = resolveQuoteView(quote, version, live);
  const t = docTotals(version.lines, version.rot);
  const vat = vatBreakdown(version.lines);
  const terms = version.taxReductionTerms ?? (version.rot ? getTaxReductionTerms(version.rot.type) : null);
  const draft = quote.status === "utkast";
  const paymentTerms = [
    `Betalningsvillkor: ${version.paymentTermsDays} dagar per faktura.`,
    version.lateInterestRate
      ? `Vid försenad betalning debiteras dröjsmålsränta med ${version.lateInterestRate} % per år.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    kind: "offert",
    draft,
    docType: "Offert",
    docNumber: `#${quote.number}`,
    title: version.title,
    intro: version.intro,
    richText: richTextToPlain(version.richText) || undefined,
    seller: view.seller,
    buyerName: view.buyer.name,
    buyerAddress: addressLines(view.buyer),
    meta: [
      { label: "Datum", value: datumNumeriskt(version.createdAt) },
      { label: "Giltig till", value: datumNumeriskt(version.validUntil) },
      { label: "Version", value: String(version.version) },
      { label: "Offertnummer", value: String(quote.number) },
    ],
    lines: lineRows(version.lines),
    totals: totalsRows(t, vat, version.rot),
    toPayLabel: "Att betala",
    toPay: kr(t.toPay),
    housing: version.rot ? housingBits(view.housing) : undefined,
    rotHeading: version.rot ? terms?.heading : undefined,
    rotBody: version.rot ? terms?.body : undefined,
    rotHint: version.rot ? taxReductionCalcHintText(version.rot.type, t.laborInclVat) : undefined,
    paymentPlan:
      version.paymentPlan.length > 0
        ? version.paymentPlan.map((p) => ({
            label: `${p.label} (${p.percent} %)`,
            value: kr(Math.round((t.toPay * p.percent) / 100)),
          }))
        : undefined,
    paymentTerms,
    terms: version.terms,
    signHeading: signature ? signedWithBankIdBy(signature.signerName) : "Signeras med BankID",
    signBody: signature
      ? datumTid(signature.signedAt)
      : `Offerten signeras tryggt och juridiskt bindande med BankID via länken i e-postmeddelandet. Giltig till ${datumLang(version.validUntil)}.`,
    filename: "",
  };
}

export function invoicePdfModel(invoice: Invoice, live: { seller: CompanySettings; buyer: Customer }): BusinessPdfModel {
  const view = resolveInvoiceView(invoice, live);
  const seller = view.seller;
  const buyer = view.buyer;
  const doc = view.invoice;
  const t = docTotals(doc.lines, doc.rot);
  const vat = vatBreakdown(doc.lines);
  const isCredit = doc.type === "kredit";
  const draft = invoice.status === "utkast";
  const showServiceDate = Boolean(doc.serviceDate && !sameCalendarDay(doc.serviceDate, doc.issueDate));
  const originalNumber = doc.issuedSnapshot?.creditsInvoiceNumber ?? invoice.issuedSnapshot?.creditsInvoiceNumber;
  const data = db();
  const quote = invoice.quoteId ? data.quotes.find((q) => q.id === invoice.quoteId) : undefined;
  const job = invoice.jobId ? data.jobs.find((j) => j.id === invoice.jobId) : undefined;
  const related = [quote ? `Offert #${quote.number}` : null, job?.title ? `Uppdrag ${job.title}` : null]
    .filter(Boolean)
    .join(" · ");

  const paymentBox: { label: string; value: string }[] = [];
  if (seller.bankgiro) paymentBox.push({ label: "Bankgiro", value: seller.bankgiro });
  if (seller.plusgiro) paymentBox.push({ label: "PlusGiro", value: seller.plusgiro });
  if (seller.iban) paymentBox.push({ label: "IBAN", value: seller.iban });
  if (seller.bankAccount && !seller.iban) paymentBox.push({ label: "Bankkonto", value: seller.bankAccount });
  paymentBox.push({ label: "OCR", value: doc.ocr || "–" });
  paymentBox.push({ label: "Belopp", value: kr(t.toPay) });

  const meta: PdfMeta[] = [
    { label: "Fakturadatum", value: datumNumeriskt(doc.issueDate) },
    { label: "Förfallodatum", value: datumNumeriskt(doc.dueDate) },
    { label: "OCR / referens", value: doc.ocr || "–" },
    { label: "Valuta", value: "SEK" },
    { label: "Betalningsvillkor", value: `${doc.paymentTermsDays} dagar netto` },
  ];
  if (doc.number != null) meta.push({ label: "Fakturanummer", value: String(doc.number) });
  if (showServiceDate && doc.serviceDate) {
    meta.push({ label: "Utförandedatum", value: datumNumeriskt(doc.serviceDate) });
  }

  return {
    kind: "faktura",
    draft,
    docType: invoiceTypeLabel(doc.type),
    docNumber: invoiceNumberLabel(doc),
    richText: richTextToPlain(doc.richText) || undefined,
    seller,
    buyerName: buyer.name,
    buyerAddress: addressLines(buyer),
    meta,
    lines: lineRows(doc.lines),
    totals: totalsRows(t, vat, doc.rot),
    toPayLabel: isCredit ? "Att kreditera" : "Att betala nu",
    toPay: kr(t.toPay),
    housing: doc.rot ? housingBits(housingLinesFromDetails(doc.taxReductionDetails)) : undefined,
    rotBody: doc.rot ? getInvoiceTaxReductionDisclaimer(doc.taxReductionTerms?.version) : undefined,
    rotHint: doc.rot ? taxReductionCalcHintText(doc.rot.type, t.laborInclVat) : undefined,
    paymentTerms: `${doc.paymentTermsDays} dagar netto.${
      doc.lateInterestRate ? ` Efter förfallodagen debiteras dröjsmålsränta med ${doc.lateInterestRate} % per år.` : ""
    }`,
    paymentBox: !isCredit && invoice.status !== "betald" ? paymentBox : undefined,
    paymentNote:
      !isCredit && invoice.status !== "betald"
        ? `Betala senast ${datumLang(doc.dueDate)}. Ange OCR-numret som referens.`
        : undefined,
    related: related || undefined,
    creditNote: isCredit
      ? `Denna kreditfaktura krediterar${originalNumber != null ? ` faktura #${originalNumber}` : " tidigare skickad faktura"} i sin helhet.`
      : undefined,
    paidNote:
      invoice.status === "betald" && invoice.paidAt
        ? `Betald. Betalningen mottogs ${datumLang(invoice.paidAt)}. Tack!`
        : undefined,
    filename: "",
  };
}

/** Bygg offert-PDF-modell från id – samma data som kundvyn. */
export function quotePdfModelById(quoteId: string): BusinessPdfModel | null {
  const quote = getQuote(quoteId);
  if (!quote) return null;
  const version = currentVersion(quote);
  const buyer = requireCustomer(quote.customerId);
  const model = quotePdfModel(quote, { seller: db().settings, buyer }, version, quoteSignature(quote.id));
  return model;
}

export function invoicePdfModelById(invoiceId: string): BusinessPdfModel | null {
  const invoice = db().invoices.find((i) => i.id === invoiceId);
  if (!invoice) return null;
  const buyer = requireCustomer(invoice.customerId);
  return invoicePdfModel(invoice, { seller: db().settings, buyer });
}

/** Exponerat så tester kan verifiera att PDF-belopp = docTotals. */
export function modelTotalsMatchEngine(model: BusinessPdfModel, t: DocTotals): boolean {
  return model.toPay === kr(t.toPay) && model.totals.some((row) => row.value === kr(t.total));
}

