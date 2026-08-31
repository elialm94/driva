import type { CompanySettings, Customer, Invoice } from "../types";
import { docTotals, isSupportedVatRate, lineTotal, vatBreakdown } from "../calc";
import { taxReductionExceedsMaxError } from "../tax-reduction-terms";
import { getInvoice, requireCustomer } from "../services/data";
import { db } from "../store";
import { radLabel } from "../form-requirements";
import { isBankgiroFormat, isIbanFormat, isOrgnrFormat, isPlusgiroFormat, isVatNumberFormat, vatMatchesOrgnr } from "./formats";
import { taxReductionSendBlockers, taxReductionSendInputFromCustomer } from "../tax-reduction-send";
import { missingEmailForSend } from "../customer-validation";

export interface IssueBlocker {
  code: string;
  message: string;
  href?: string;
  /** Kort länktext, t.ex. "Komplettera företagsuppgifter". */
  actionLabel?: string;
}

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

export function collectSellerBlockers(seller: CompanySettings): IssueBlocker[] {
  const blockers: IssueBlocker[] = [];
  const href = "/installningar?flik=foretag";
  const complete = "Komplettera företagsuppgifter";
  const payHref = "/installningar?flik=fakturering";
  const completePay = "Komplettera betalningsuppgifter";
  if (missing(seller.name)) {
    blockers.push({ code: "seller_name", message: "Företagsnamn saknas i företagsuppgifterna.", href, actionLabel: complete });
  }
  if (missing(seller.orgNumber)) {
    blockers.push({ code: "seller_orgnr", message: "Organisationsnummer saknas i företagsuppgifterna.", href, actionLabel: complete });
  } else if (!isOrgnrFormat(seller.orgNumber)) {
    blockers.push({
      code: "seller_orgnr_format",
      message: "Ange ett giltigt organisationsnummer med 10 siffror.",
      href,
      actionLabel: complete,
    });
  }
  if (missing(seller.vatNumber)) {
    blockers.push({ code: "seller_vat", message: "Momsregistreringsnummer saknas i företagsuppgifterna.", href, actionLabel: complete });
  } else if (!isVatNumberFormat(seller.vatNumber)) {
    blockers.push({
      code: "seller_vat_format",
      message: "Momsregistreringsnumret ska anges som SE följt av 12 siffror (t.ex. SE559123456701).",
      href,
      actionLabel: complete,
    });
  } else if (isOrgnrFormat(seller.orgNumber) && !vatMatchesOrgnr(seller.vatNumber, seller.orgNumber)) {
    blockers.push({
      code: "seller_vat_orgnr",
      message: "Momsregistreringsnumret stämmer inte med organisationsnumret (förväntat SE + org.nr + 01).",
      href,
      actionLabel: complete,
    });
  }
  if (missing(seller.address) || missing(seller.postalCode) || missing(seller.city)) {
    blockers.push({
      code: "seller_address",
      message: "Företagets adress, postnummer och ort måste fyllas i.",
      href,
      actionLabel: complete,
    });
  }
  const hasBankgiro = !missing(seller.bankgiro);
  const hasPlusgiro = !missing(seller.plusgiro);
  const hasIban = !missing(seller.iban);
  const hasAccount = !missing(seller.bankAccount);
  if (!hasBankgiro && !hasPlusgiro && !hasIban && !hasAccount) {
    blockers.push({
      code: "seller_bankgiro",
      message: "Betalningsuppgifter saknas – fyll i bankgiro, PlusGiro, bankkonto eller IBAN.",
      href: payHref,
      actionLabel: completePay,
    });
  } else {
    if (hasBankgiro && !isBankgiroFormat(seller.bankgiro)) {
      blockers.push({
        code: "seller_bankgiro_format",
        message: "Ange ett giltigt Bankgiro med 7–8 siffror.",
        href: payHref,
        actionLabel: completePay,
      });
    }
    if (hasPlusgiro && seller.plusgiro && !isPlusgiroFormat(seller.plusgiro)) {
      blockers.push({
        code: "seller_plusgiro_format",
        message: "PlusGiro har fel format. Vi kontrollerar inte mot PlusGirot.",
        href: payHref,
        actionLabel: completePay,
      });
    }
    if (hasIban && seller.iban && !isIbanFormat(seller.iban)) {
      blockers.push({
        code: "seller_iban_format",
        message: "IBAN har fel format. Vi kontrollerar inte mot banken.",
        href: payHref,
        actionLabel: completePay,
      });
    }
  }
  return blockers;
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

export function collectPaymentBlockers(invoice: Invoice, _seller?: CompanySettings): IssueBlocker[] {
  const blockers: IssueBlocker[] = [];
  if (!invoice.dueDate) {
    blockers.push({ code: "due_date", message: "Förfallodatum saknas." });
  }
  if (!invoice.paymentTermsDays || invoice.paymentTermsDays < 1) {
    blockers.push({ code: "payment_terms", message: "Betalningsvillkor (antal dagar) saknas." });
  }
  // Betalningsuppgifter (bankgiro/PlusGiro/konto/IBAN) ägs av collectSellerBlockers
  // (seller_bankgiro). Duplicera inte här – samma sak visades två gånger i checklistan.
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
  const seenCodes = new Set<string>();
  const seenMessages = new Set<string>();
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
    const messageKey = b.message.trim().toLocaleLowerCase("sv");
    if (seenCodes.has(b.code) || seenMessages.has(messageKey)) return false;
    seenCodes.add(b.code);
    seenMessages.add(messageKey);
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

/**
 * Kanonisk lista för utkast: checklista, disabled Skicka och serverside
 * send-validering. Samma källa – ingen separat e-postif-sats i UI.
 */
export function getInvoiceSendBlockers(invoiceId: string): IssueBlocker[] {
  const invoice = getInvoice(invoiceId);
  if (!invoice) return [{ code: "missing", message: "Fakturan finns inte." }];
  const seller = db().settings;
  const buyer = requireCustomer(invoice.customerId);
  const blockers = collectIssueErrors({ invoice, seller, buyer });
  const email = missingEmailForSend(buyer);
  if (email && !blockers.some((b) => b.code === email.code)) {
    blockers.push({
      ...email,
      href: `/kunder/${buyer.id}`,
    });
  }
  return blockers;
}

export function invoiceCanSend(invoiceId: string): boolean {
  return getInvoiceSendBlockers(invoiceId).length === 0;
}

export function assertInvoiceReadyToIssue(invoiceId: string): void {
  const blockers = validateInvoiceForIssue(invoiceId);
  if (blockers.length) throw new InvoiceNotReadyError(blockers);
}
