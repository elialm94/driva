import type {
  CompanySettings,
  Customer,
  DB,
  Invoice,
  InvoiceBuyerSnapshot,
  InvoiceIssuedSnapshot,
  InvoiceSellerSnapshot,
} from "../types";
import { docTotals, vatBreakdown } from "../calc";
import { ocrForInvoice } from "../ids";
import { normalizePersonnummer } from "../personnummer";
import { buyerVatNumber } from "./reverse-charge";

export function sellerSnapshot(settings: CompanySettings): InvoiceSellerSnapshot {
  return {
    name: settings.name,
    orgNumber: settings.orgNumber,
    vatNumber: settings.vatNumber,
    address: settings.address,
    postalCode: settings.postalCode,
    city: settings.city,
    sate: settings.sate?.trim() || settings.city,
    country: settings.country?.trim() || "Sverige",
    email: settings.email,
    phone: settings.phone,
    websiteUrl: settings.websiteUrl,
    bankgiro: settings.bankgiro,
    plusgiro: settings.plusgiro,
    bankAccount: settings.bankAccount,
    iban: settings.iban,
    bic: settings.bic,
    logoInitials: settings.logoInitials,
    logoDataUrl: settings.logoDataUrl,
  };
}

export function buyerSnapshot(
  customer: Customer,
  opts: { includePersonalIdentityNumber?: boolean; includeVatNumber?: boolean } = {}
): InvoiceBuyerSnapshot {
  const pn = customer.personalIdentityNumber?.trim();
  const vat = opts.includeVatNumber ? buyerVatNumber(customer) : "";
  return {
    // Omvänd byggmoms: lagen kräver köparens momsnummer på fakturan.
    ...(vat ? { vatNumber: vat } : {}),
    name: customer.name,
    kind: customer.kind,
    orgNumber: customer.orgNumber,
    address: customer.address?.trim() ?? "",
    postalCode: customer.postalCode?.trim() ?? "",
    city: customer.city?.trim() ?? "",
    country: "Sverige",
    email: customer.email,
    phone: customer.phone,
    contactPerson: customer.contactPerson?.trim() || undefined,
    // Känsligt: fryses bara när dokumentet behöver det (ROT/RUT).
    ...(opts.includePersonalIdentityNumber && pn ? { personalIdentityNumber: normalizePersonnummer(pn) } : {}),
  };
}

export function sellerAsCompany(seller: InvoiceSellerSnapshot, fallback?: CompanySettings): CompanySettings {
  return {
    name: seller.name,
    orgNumber: seller.orgNumber,
    vatNumber: seller.vatNumber,
    email: seller.email,
    phone: seller.phone,
    websiteUrl: seller.websiteUrl,
    address: seller.address,
    postalCode: seller.postalCode,
    city: seller.city,
    sate: seller.sate,
    country: seller.country ?? "Sverige",
    bankgiro: seller.bankgiro,
    plusgiro: seller.plusgiro,
    bankAccount: seller.bankAccount,
    iban: seller.iban,
    bic: seller.bic,
    logoInitials: seller.logoInitials,
    logoDataUrl: seller.logoDataUrl,
    websiteNotificationEmail: fallback?.websiteNotificationEmail,
    fSkattPerMonth: fallback?.fSkattPerMonth ?? 0,
    payrollReservePerMonth: fallback?.payrollReservePerMonth ?? 0,
    paymentTermsDays: fallback?.paymentTermsDays ?? 30,
    lateInterestRate: fallback?.lateInterestRate ?? 0,
    quoteValidityDays: fallback?.quoteValidityDays ?? 30,
    defaultVatRate: fallback?.defaultVatRate ?? 25,
  };
}

/** Skickad/låst offert: snapshot. Utkast: live företagsuppgifter. */
export function resolveQuoteCompany(
  version: { lockedAt?: string; sellerSnapshot?: InvoiceSellerSnapshot },
  live: CompanySettings
): CompanySettings {
  if (version.sellerSnapshot) return sellerAsCompany(version.sellerSnapshot, live);
  return live;
}

/** Skickad/låst offert: kundsnapshot. Utkast (eller äldre data utan snapshot): live-kund. */
export function resolveQuoteCustomer(
  version: { buyerSnapshot?: InvoiceBuyerSnapshot },
  live: Customer
): Customer {
  if (version.buyerSnapshot) return buyerAsCustomer(version.buyerSnapshot, live);
  return live;
}

export function buyerAsCustomer(buyer: InvoiceBuyerSnapshot, fallback?: Customer): Customer {
  return {
    id: fallback?.id ?? "snapshot",
    kind: buyer.kind,
    name: buyer.name,
    orgNumber: buyer.orgNumber,
    email: buyer.email,
    phone: buyer.phone,
    address: buyer.address,
    postalCode: buyer.postalCode,
    city: buyer.city,
    notes: fallback?.notes ?? "",
    createdAt: fallback?.createdAt ?? "",
    contactPerson: buyer.contactPerson ?? fallback?.contactPerson,
    // Historiskt dokument: snapshotens personnummer vinner alltid över dagens kundkort.
    personalIdentityNumber: buyer.personalIdentityNumber ?? fallback?.personalIdentityNumber,
    workLocations: fallback?.workLocations,
    defaultWorkLocationId: fallback?.defaultWorkLocationId,
  };
}

export function buildIssuedSnapshot(input: {
  invoice: Invoice;
  seller: CompanySettings;
  buyer: Customer;
  issuedAt: string;
  number: number;
  ocr: string;
  creditsInvoiceNumber?: number;
}): InvoiceIssuedSnapshot {
  const { invoice } = input;
  const lines = invoice.lines.map((l) => ({ ...l }));
  return {
    issuedAt: input.issuedAt,
    number: input.number,
    ocr: input.ocr,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    paymentTermsDays: invoice.paymentTermsDays,
    lateInterestRate: invoice.lateInterestRate,
    currency: "SEK",
    serviceDate: invoice.serviceDate,
    seller: sellerSnapshot(input.seller),
    // Personnummer fryses bara på ROT/RUT-fakturor – dokumentet ska kunna
    // rendera skattereduktionens person utan live-uppslag på kundkortet.
    buyer: buyerSnapshot(input.buyer, {
      includePersonalIdentityNumber: Boolean(invoice.rot),
      includeVatNumber: invoice.reverseCharge === true,
    }),
    lines,
    // Villkorligt: äldre snapshots utan fältet förblir värde-exakta.
    ...(invoice.reverseCharge ? { reverseCharge: true } : {}),
    ...(invoice.richText ? { richText: invoice.richText } : {}),
    rot: invoice.rot ? { ...invoice.rot } : null,
    taxReductionTerms: invoice.taxReductionTerms ? { ...invoice.taxReductionTerms } : null,
    taxReductionDetails: invoice.taxReductionDetails ? { ...invoice.taxReductionDetails, housing: invoice.taxReductionDetails.housing ? { ...invoice.taxReductionDetails.housing } : undefined } : null,
    totals: { ...docTotals(lines, invoice.rot) },
    vatBreakdown: vatBreakdown(lines),
    creditsInvoiceId: invoice.creditsInvoiceId,
    creditsInvoiceNumber: input.creditsInvoiceNumber,
  };
}

/** Dokumentvy: utfärdad faktura från snapshot, utkast från live säljare/köpare. */
export function resolveInvoiceView(
  invoice: Invoice,
  live: { seller: CompanySettings; buyer: Customer }
): { seller: CompanySettings; buyer: Customer; invoice: Invoice } {
  const snap = invoice.status !== "utkast" ? invoice.issuedSnapshot : undefined;
  if (!snap) return { seller: live.seller, buyer: live.buyer, invoice };
  return {
    seller: sellerAsCompany(snap.seller, live.seller),
    buyer: buyerAsCustomer(snap.buyer, live.buyer),
    invoice: {
      ...invoice,
      number: snap.number,
      ocr: snap.ocr,
      issueDate: snap.issueDate,
      dueDate: snap.dueDate,
      paymentTermsDays: snap.paymentTermsDays,
      lateInterestRate: snap.lateInterestRate,
      serviceDate: snap.serviceDate,
      lines: snap.lines,
      reverseCharge: snap.reverseCharge,
      // Alltid från snapshoten: en muterad live-rad får aldrig synas på utfärdat dokument.
      richText: snap.richText,
      rot: snap.rot,
      taxReductionTerms: snap.taxReductionTerms,
      taxReductionDetails: snap.taxReductionDetails,
    },
  };
}

/** Backfill snapshot på äldre utfärdade fakturor (seed / .data/db.json). Returnerar true om något skrevs. */
export function hydrateIssuedInvoices(data: DB): boolean {
  let changed = false;
  for (const inv of data.invoices) {
    if (inv.paymentTermsDays == null) {
      inv.paymentTermsDays = data.settings.paymentTermsDays;
      changed = true;
    }
    if (inv.status === "utkast") continue;
    if (inv.number == null) continue;
    // Utfärdad OCR är immutabel. Fyll bara om den saknas – ogiltiga
    // historiska värden lämnas (kunden kan redan ha betalat på dem).
    if (!inv.ocr?.trim()) {
      inv.ocr = ocrForInvoice(inv.number);
      changed = true;
    }
    if (inv.issuedSnapshot && !inv.issuedSnapshot.ocr?.trim() && inv.ocr.trim()) {
      inv.issuedSnapshot = { ...inv.issuedSnapshot, ocr: inv.ocr };
      changed = true;
    }
    if (!inv.issuedAt) {
      inv.issuedAt = inv.sentAt ?? inv.issueDate;
      changed = true;
    }
    if (inv.issuedSnapshot) {
      // Engångsbackfill: äldre ROT/RUT-snapshots fryser personnumret så att
      // dokumentet kan rendera skattereduktionens person utan live-uppslag.
      const snap = inv.issuedSnapshot;
      if (snap.rot && !snap.buyer.personalIdentityNumber) {
        const pn = data.customers.find((c) => c.id === inv.customerId)?.personalIdentityNumber?.trim();
        if (pn) {
          snap.buyer.personalIdentityNumber = normalizePersonnummer(pn);
          changed = true;
        }
      }
      continue;
    }
    const buyer = data.customers.find((c) => c.id === inv.customerId);
    if (!buyer) continue;
    inv.issuedSnapshot = buildIssuedSnapshot({
      invoice: inv,
      seller: data.settings,
      buyer,
      issuedAt: inv.issuedAt,
      number: inv.number,
      ocr: inv.ocr,
    });
    changed = true;
  }
  return changed;
}

/** Backfill företagssnapshot på skickade/godkända offerter. Utkast läser live. */
export function hydrateQuoteSellerSnapshots(data: DB): boolean {
  let changed = false;
  const snap = sellerSnapshot(data.settings);
  for (const version of data.quoteVersions) {
    if (version.sellerSnapshot) continue;
    const quote = data.quotes.find((q) => q.id === version.quoteId);
    if (!quote) continue;
    if (quote.status === "utkast" && !version.lockedAt) continue;
    version.sellerSnapshot = { ...snap };
    changed = true;
  }
  return changed;
}

/**
 * Backfill kundsnapshot på skickade/godkända offerter – samma princip som
 * säljarsnapshoten: bästa tillgängliga data är dagens kunduppgifter, och
 * snapshoten hindrar att SENARE kundändringar skriver om dokumentet.
 */
export function hydrateQuoteBuyerSnapshots(data: DB): boolean {
  let changed = false;
  for (const version of data.quoteVersions) {
    if (version.buyerSnapshot) continue;
    const quote = data.quotes.find((q) => q.id === version.quoteId);
    if (!quote) continue;
    if (quote.status === "utkast" && !version.lockedAt) continue;
    const customer = data.customers.find((c) => c.id === quote.customerId);
    if (!customer) continue;
    version.buyerSnapshot = buyerSnapshot(customer);
    changed = true;
  }
  return changed;
}
