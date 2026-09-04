import type { DocLine, Invoice, InvoiceType } from "../types";

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

/**
 * Första kolumnen i fakturaregistret: dokumentets namn, inte statusordet "Utkast".
 * Utfärdad: "#1042". Utkast: rubrik → första rad → "Faktura till {kund}".
 * Löpnummer tilldelas inte här.
 */
export type InvoiceListTitleSource = Pick<Invoice, "number" | "status" | "type" | "lines">;

export interface InvoiceListTitleContext {
  customerName?: string;
  quoteTitle?: string;
  jobTitle?: string;
  invoiceTitle?: string;
}

function firstNonEmpty(value: string | undefined | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "";
}

export function firstInvoiceLineDescription(lines: Pick<DocLine, "description">[] | undefined): string {
  if (!lines) return "";
  for (const line of lines) {
    const description = firstNonEmpty(line.description);
    if (description) return description;
  }
  return "";
}

/** Utfärdad faktura i listan: har status annat än utkast och ett riktigt nummer. */
export function invoiceHasIssuedListNumber(invoice: Pick<Invoice, "number" | "status">): boolean {
  return invoice.status !== "utkast" && invoice.number != null;
}

export function invoiceListTitle(
  invoice: InvoiceListTitleSource,
  ctx: InvoiceListTitleContext = {}
): string {
  if (invoiceHasIssuedListNumber(invoice)) {
    return `#${invoice.number}`;
  }
  const rubrik =
    firstNonEmpty(ctx.invoiceTitle) || firstNonEmpty(ctx.quoteTitle) || firstNonEmpty(ctx.jobTitle);
  if (rubrik) return rubrik;
  const line = firstInvoiceLineDescription(invoice.lines);
  if (line) return line;
  const customer = firstNonEmpty(ctx.customerName);
  return customer ? `Faktura till ${customer}` : "Faktura";
}

/**
 * Sekundär typetikett bredvid listtiteln. "Delbetalning" bara när typen är
 * delbetalning – aldrig som ersättning för utkastets namn.
 */
export function invoiceListTypeLabel(type: InvoiceType): string {
  switch (type) {
    case "delbetalning":
      return "Delbetalning";
    case "slutfaktura":
      return "Slutfaktura";
    case "kredit":
      return "Kredit";
    default:
      return "";
  }
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
