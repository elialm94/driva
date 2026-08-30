/**
 * Server-side PDF för offerter och fakturor.
 *
 * Samma snapshots och docTotals som webbvyn. E-post kan bifoga samma bytes
 * senare via renderQuotePdf / renderInvoicePdf – SMS skickar bara länk.
 */

import { documentPdfFilename } from "./filename";
import { invoicePdfModel, invoicePdfModelById, quotePdfModel, quotePdfModelById } from "./document-model";
import { renderBusinessPdf } from "./render-document-pdf";
import type { BankIDSignature, CompanySettings, Customer, Invoice, Quote, QuoteVersion } from "../types";

export { documentPdfFilename } from "./filename";
export { contentDisposition } from "./filename";

export function renderQuotePdf(
  quote: Quote,
  live: { seller: CompanySettings; buyer: Customer },
  version?: QuoteVersion,
  signature?: BankIDSignature
): { bytes: Buffer; filename: string } {
  const model = quotePdfModel(quote, live, version, signature);
  model.filename = documentPdfFilename("offert", quote.number, model.buyerName);
  return renderBusinessPdf(model);
}

export function renderInvoicePdf(
  invoice: Invoice,
  live: { seller: CompanySettings; buyer: Customer }
): { bytes: Buffer; filename: string } {
  const model = invoicePdfModel(invoice, live);
  model.filename = documentPdfFilename("faktura", model.draft ? null : invoice.number, model.buyerName);
  return renderBusinessPdf(model);
}

export function renderQuotePdfById(quoteId: string): { bytes: Buffer; filename: string } | null {
  const model = quotePdfModelById(quoteId);
  if (!model) return null;
  model.filename = documentPdfFilename("offert", numberFromLabel(model.docNumber), model.buyerName);
  return renderBusinessPdf(model);
}

export function renderInvoicePdfById(invoiceId: string): { bytes: Buffer; filename: string } | null {
  const model = invoicePdfModelById(invoiceId);
  if (!model) return null;
  model.filename = documentPdfFilename("faktura", numberFromLabel(model.docNumber), model.buyerName);
  return renderBusinessPdf(model);
}

function numberFromLabel(label: string): number | null {
  const raw = label.replace(/^#/, "").trim();
  if (raw === "Utkast") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Samma PDF som nedladdning – redo att bifogas i e-post. */
export function quotePdfAttachment(quoteId: string): { filename: string; content: Buffer; contentType: "application/pdf" } | null {
  const pdf = renderQuotePdfById(quoteId);
  if (!pdf) return null;
  return { filename: pdf.filename, content: pdf.bytes, contentType: "application/pdf" };
}

export function invoicePdfAttachment(invoiceId: string): { filename: string; content: Buffer; contentType: "application/pdf" } | null {
  const pdf = renderInvoicePdfById(invoiceId);
  if (!pdf) return null;
  return { filename: pdf.filename, content: pdf.bytes, contentType: "application/pdf" };
}
