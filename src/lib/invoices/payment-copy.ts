import { kr, datumLang } from "../format";
import type { CompanySettings } from "../types";
import { invoicePaymentRows, invoicePaymentTermsLine } from "./document-view";

/**
 * Betalningsblocket – samma rader på fakturan, i mejlet och i PDF-bilagan.
 * En källa så OCR, bankgiro och förfallodag aldrig skiljer sig åt.
 */
export function paymentBlockRows(input: {
  seller: Pick<CompanySettings, "bankgiro" | "plusgiro" | "bankAccount" | "iban" | "bic">;
  ocr: string;
  dueDate: string;
  amount: number;
}): { label: string; value: string }[] {
  return invoicePaymentRows(input);
}

/** Textversion för mejl: en rad per uppgift, tomt om inget finns att betala med. */
export function paymentBlockText(input: {
  seller: Pick<CompanySettings, "bankgiro" | "plusgiro" | "bankAccount" | "iban" | "bic">;
  ocr?: string;
  dueDate: string;
  amount: number;
  terms?: Pick<{ paymentTermsDays: number; lateInterestRate?: number }, "paymentTermsDays" | "lateInterestRate">;
}): string {
  const rows = paymentBlockRows({
    seller: input.seller,
    ocr: input.ocr?.trim() ?? "",
    dueDate: input.dueDate,
    amount: input.amount,
  });
  const lines = ["Så betalar du", ...rows.map((r) => `${r.label}: ${r.value}`)];
  if (input.terms) lines.push(invoicePaymentTermsLine(input.terms));
  return lines.join("\n");
}

export function paymentBlockHtml(input: {
  seller: Pick<CompanySettings, "bankgiro" | "plusgiro" | "bankAccount" | "iban" | "bic">;
  ocr?: string;
  dueDate: string;
  amount: number;
}): string {
  const rows = paymentBlockRows({
    seller: input.seller,
    ocr: input.ocr?.trim() ?? "",
    dueDate: input.dueDate,
    amount: input.amount,
  });
  const cells = rows
    .map(
      (r) =>
        `<tr><td style="padding:4px 12px 4px 0;font-size:13px;color:#6b665c;">${escape(r.label)}</td><td style="padding:4px 0;font-size:14px;font-weight:600;">${escape(r.value)}</td></tr>`
    )
    .join("");
  return `<table style="margin:16px 0 0;border-collapse:collapse;"><caption style="text-align:left;font-size:13px;font-weight:600;padding-bottom:6px;">Så betalar du</caption>${cells}</table>`;
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

export function paymentAmountLabel(amount: number, dueDate: string): string {
  return `${kr(amount)} senast ${datumLang(dueDate)}`;
}
