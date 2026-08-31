import type { CompanySettings, Customer, Invoice } from "../types";
import { docTotals, isSupportedVatRate, lineTotal, vatBreakdown } from "../calc";
import { taxReductionExceedsMaxError } from "../tax-reduction-terms";
import { getInvoice, requireCustomer } from "../services/data";
import { db } from "../store";
import { radLabel } from "../form-requirements";
import { taxReductionSendBlockers, taxReductionSendInputFromCustomer } from "../tax-reduction-send";
import { collectSellerBlockers, type IssueBlocker } from "./seller-blockers";

export type { IssueBlocker } from "./seller-blockers";
export {
  BUSINESS_LEVEL_BLOCKER_CODES,
  QUOTE_BUSINESS_BLOCKER_CODES,
  collectSellerBlockers,
  isBusinessLevelBlocker,
  partitionSendBlockers,
  sellerHasPaymentMethod,
} from "./seller-blockers";

export class InvoiceNotReadyError extends Error {
  readonly blockers: IssueBlocker[];
  constructor(blockers: IssueBlocker[]) {
    super(blockers.map((b) => b.message).join(" "));
    this.name = "InvoiceNotReadyError";
    this.blockers = blockers;
  }
}

function missing(value: string | undefined | null): boolean {
  return !value || !value.trim();
}

export function collectBuyerBlockers(buyer: Customer): IssueBlocker[] {
  const href = `/kunder/${buyer.id}`;
  const blockers: IssueBlocker[] = [];
  if (missing(buyer.name)) {
    blockers.push({ code: "buyer_name", message: "Kundens namn saknas.", href });
  }
  if (missing(buyer.address) || missing(buyer.postalCode) || missing(buyer.city)) {
    blockers.push({
      code: "buyer_address",
      message: `Kundens adress saknas för ${buyer.name}. Gatuadress, postnummer och ort krävs.`,
      href,
    });
  }
  return blockers;
}

export function collectLineBlockers(invoice: Invoice): IssueBlocker[] {
  const blockers: IssueBlocker[] = [];
  if (invoice.lines.length === 0) {
    blockers.push({ code: "lines_empty", message: "Fakturan har inga rader." });
    return blockers;
  }
  invoice.lines.forEach((line, i) => {
    const name = line.description?.trim();
    // "raden ”Montör”" när beskrivning finns, annars "första raden" osv.
    const label = name ? `raden ”${name}”` : radLabel(i);
    if (missing(line.description)) {
      blockers.push({ code: "line_description", message: `Beskrivning saknas på ${radLabel(i)}.` });
    }
    if (!Number.isFinite(line.qty)) {
      blockers.push({ code: "line_qty", message: `Antalet på ${label} är ogiltigt.` });
    }
    if (missing(line.unit)) {
      blockers.push({ code: "line_unit", message: `Enhet saknas på ${label}.` });
    }
    if (!Number.isFinite(line.unitPrice)) {
      blockers.push({ code: "line_price", message: `À-priset på ${label} är ogiltigt.` });
    }
    if (!isSupportedVatRate(line.vatRate)) {
      blockers.push({
        code: "line_vat",
        message: `Momssatsen ${line.vatRate} % på ${label} stöds inte. V1 tillåter bara 0, 6, 12 och 25 %.`,
      });
    }
  });
  return blockers;
}

export function collectTotalsBlockers(invoice: Invoice): IssueBlocker[] {
  const t = docTotals(invoice.lines, invoice.rot);
  const blockers: IssueBlocker[] = [];
  if (![t.subtotal, t.vat, t.total, t.toPay, t.deduction].every((n) => Number.isFinite(n))) {
    blockers.push({ code: "totals_nan", message: "Fakturans belopp kunde inte räknas ut. Kontrollera raderna." });
    return blockers;
  }
  const lineSum = invoice.lines.reduce((s, l) => s + lineTotal(l), 0);
  if (lineSum !== t.subtotal) {
    blockers.push({ code: "totals_mismatch", message: "Summan exkl. moms stämmer inte med raderna." });
  }
  const vatSum = vatBreakdown(invoice.lines).reduce((s, r) => s + r.vat, 0);
  if (vatSum !== t.vat) {
    blockers.push({ code: "vat_mismatch", message: "Momssumman stämmer inte med raderna." });
  }
  if (t.total !== t.subtotal + t.vat) {
    blockers.push({ code: "total_mismatch", message: "Totalt inkl. moms stämmer inte med underlag och moms." });
  }
  if (
    invoice.rot &&
    invoice.rot.appliedTaxReduction != null &&
    invoice.rot.appliedTaxReduction > t.calculatedEligibleTaxReduction
  ) {
    blockers.push({
      code: "tax_reduction_applied",
      message: taxReductionExceedsMaxError(t.calculatedEligibleTaxReduction, "faktura"),
    });
  }
  return blockers;
}

export function collectPaymentBlockers(invoice: Invoice, seller: CompanySettings): IssueBlocker[] {
  const blockers: IssueBlocker[] = [];
  if (!invoice.dueDate) {
    blockers.push({ code: "due_date", message: "Förfallodatum saknas." });
  }
  if (!invoice.paymentTermsDays || invoice.paymentTermsDays < 1) {
    blockers.push({ code: "payment_terms", message: "Betalningsvillkor (antal dagar) saknas." });
  }
  const hasPayment =
    !missing(seller.bankgiro) || !missing(seller.plusgiro) || !missing(seller.iban) || !missing(seller.bankAccount);
  if (!hasPayment) {
    blockers.push({
      code: "payment_bankgiro",
      message: "Betalningsuppgifter saknas – fyll i bankgiro, PlusGiro, bankkonto eller IBAN.",
      href: "/installningar?flik=fakturering",
      actionLabel: "Komplettera betalningsuppgifter",
    });
  }
  return blockers;
}

export function collectIssueErrors(input: {
  invoice: Invoice;
  seller: CompanySettings;
  buyer: Customer;
}): IssueBlocker[] {
  const { invoice, seller, buyer } = input;
  if (invoice.status !== "utkast" && invoice.type !== "kredit") {
    return [];
  }
  const seen = new Set<string>();
  const all = [
    ...collectSellerBlockers(seller),
    ...collectBuyerBlockers(buyer),
    ...collectLineBlockers(invoice),
    ...collectTotalsBlockers(invoice),
    ...collectPaymentBlockers(invoice, seller),
    ...taxReductionSendBlockers(
      taxReductionSendInputFromCustomer(buyer, {
        kind: "faktura",
        documentId: invoice.id,
        taxReduction: invoice.rot,
        workLocationId: invoice.workLocationId,
      })
    ),
  ];
  return all.filter((b) => {
    if (seen.has(b.code)) return false;
    seen.add(b.code);
    return true;
  });
}

/** Server-side källa till sanning. Anropas av issueInvoice. */
export function validateInvoiceForIssue(invoiceId: string): IssueBlocker[] {
  const invoice = getInvoice(invoiceId);
  if (!invoice) return [{ code: "missing", message: "Fakturan finns inte." }];
  const seller = db().settings;
  const buyer = requireCustomer(invoice.customerId);
  return collectIssueErrors({ invoice, seller, buyer });
}

export function assertInvoiceReadyToIssue(invoiceId: string): void {
  const blockers = validateInvoiceForIssue(invoiceId);
  if (blockers.length) throw new InvoiceNotReadyError(blockers);
}
