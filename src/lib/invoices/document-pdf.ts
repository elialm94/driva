import { buildSimplePdf, type PdfRule, type PdfTextLine } from "../pdf/simple-pdf";
import { kr, datumLang } from "../format";
import type { CompanySettings, Invoice } from "../types";
import { invoiceTotals } from "../services/data";
import { paymentBlockRows } from "./payment-copy";

/**
 * Enkel A4-PDF av fakturan att bifoga i mejlet. Webb-PDF:en (print-CSS) är
 * den snygga versionen kunden öppnar via länken; bilagan är till för den
 * som betalar från mejlet utan att klicka.
 */
export function invoicePdfBytes(invoice: Invoice, seller: CompanySettings, customerName: string): Buffer {
  const t = invoiceTotals(invoice);
  const ocr = invoice.ocr ?? "";
  const number = invoice.number != null ? `#${invoice.number}` : "utkast";
  const pay = paymentBlockRows({
    seller,
    ocr,
    dueDate: invoice.dueDate,
    amount: t.toPay,
  });

  const lines: PdfTextLine[] = [
    { x: 48, y: 48, text: seller.name, size: 16, bold: true },
    { x: 48, y: 70, text: `Faktura ${number}`, size: 13, bold: true },
    { x: 48, y: 90, text: customerName, size: 11 },
    { x: 48, y: 108, text: `Förfallodatum ${datumLang(invoice.dueDate)} · ${kr(t.toPay)}`, size: 11 },
    { x: 48, y: 140, text: "Så betalar du", size: 12, bold: true },
  ];
  pay.forEach((row, i) => {
    lines.push({ x: 48, y: 162 + i * 18, text: `${row.label}: ${row.value}`, size: 11 });
  });
  lines.push({
    x: 48,
    y: 162 + pay.length * 18 + 28,
    text: "Öppna fakturan via länken i mejlet för specificerade rader.",
    size: 10,
  });

  const rules: PdfRule[] = [{ x: 48, y: 128, width: 499, thickness: 0.6 }];
  return buildSimplePdf({ lines, rules });
}

export function quotePdfBytes(input: {
  companyName: string;
  customerName: string;
  quoteNumber: number;
  title: string;
  amount: number;
  validUntil: string;
}): Buffer {
  const lines: PdfTextLine[] = [
    { x: 48, y: 48, text: input.companyName, size: 16, bold: true },
    { x: 48, y: 70, text: `Offert #${input.quoteNumber}`, size: 13, bold: true },
    { x: 48, y: 90, text: input.customerName, size: 11 },
    { x: 48, y: 112, text: input.title, size: 11 },
    { x: 48, y: 136, text: `Att betala ${kr(input.amount)} · giltig till ${datumLang(input.validUntil)}`, size: 11 },
    { x: 48, y: 168, text: "Godkänn offerten via länken i mejlet.", size: 11 },
  ];
  return buildSimplePdf({ lines, rules: [{ x: 48, y: 152, width: 499, thickness: 0.6 }] });
}
