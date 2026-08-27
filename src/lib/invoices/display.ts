import type { Invoice, InvoiceType } from "../types";

const TYPE_LABEL: Record<InvoiceType, string> = {
  faktura: "Faktura",
  delbetalning: "Delbetalning",
  slutfaktura: "Slutfaktura",
  kredit: "Kreditfaktura",
};

export function invoiceTypeLabel(type: InvoiceType): string {
  return TYPE_LABEL[type];
}

/** "#1048" eller "Utkast" – utkast utan löpnummer ska inte se ut som en utfärdad faktura. */
export function invoiceNumberLabel(invoice: Pick<Invoice, "number">): string {
  return invoice.number == null ? "Utkast" : `#${invoice.number}`;
}

export function invoiceHeading(invoice: Pick<Invoice, "number" | "type">): string {
  return invoice.number == null
    ? `${TYPE_LABEL[invoice.type]} (utkast)`
    : `${TYPE_LABEL[invoice.type]} ${invoiceNumberLabel(invoice)}`;
}

export function sameCalendarDay(a: string, b: string): boolean {
  const da = a.slice(0, 10);
  const db = b.slice(0, 10);
  return da.length === 10 && da === db;
}
