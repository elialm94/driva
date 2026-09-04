import type { CompanySettings } from "../types";
import {
  isBankgiroFormat,
  isForeignVatNumberFormat,
  isIbanFormat,
  isOrgnrFormat,
  isPlusgiroFormat,
  isSwedishCountry,
} from "./formats";

export interface IssueBlocker {
  code: string;
  message: string;
  href?: string;
  /** Kort länktext, t.ex. "Komplettera företagsuppgifter". */
  actionLabel?: string;
}

/** Fält som collectSellerBlockers läser – inget dokument eller kund. */
export type SellerBlockerInput = Pick<
  CompanySettings,
  | "name"
  | "orgNumber"
  | "vatNumber"
  | "country"
  | "address"
  | "postalCode"
  | "city"
  | "bankgiro"
  | "plusgiro"
  | "iban"
  | "bankAccount"
>;

/**
 * Koder från collectSellerBlockers (företagsnivå) plus payment_bankgiro,
 * som fakturans betalningscheck kan emitta för samma regel.
 * Dokument-/kundkoder (buyer_*, line_*, ROT, e-post, …) hör inte hit.
 */
export const BUSINESS_LEVEL_BLOCKER_CODES = new Set([
  "seller_name",
  "seller_orgnr",
  "seller_orgnr_format",
  "seller_vat",
  "seller_vat_format",
  "seller_address",
  "seller_bankgiro",
  "seller_bankgiro_format",
  "seller_plusgiro_format",
  "seller_iban_format",
  "payment_bankgiro",
]);

/**
 * Företagsfält som också stoppar Skicka offert. Moms och betalning gör det inte –
 * samma delmängd som quoteSendBlockers filtrerar på.
 */
export const QUOTE_BUSINESS_BLOCKER_CODES = new Set([
  "seller_name",
  "seller_orgnr",
  "seller_orgnr_format",
  "seller_address",
]);

export function isBusinessLevelBlocker(code: string): boolean {
  return BUSINESS_LEVEL_BLOCKER_CODES.has(code);
}

export function partitionSendBlockers(blockers: readonly IssueBlocker[]): {
  business: IssueBlocker[];
  document: IssueBlocker[];
} {
  const business: IssueBlocker[] = [];
  const document: IssueBlocker[] = [];
  for (const blocker of blockers) {
    if (isBusinessLevelBlocker(blocker.code)) business.push(blocker);
    else document.push(blocker);
  }
  return { business, document };
}

function missing(value: string | undefined | null): boolean {
  return !value || !value.trim();
}

/** Minst ett ifyllt betalningssätt mot kunden – Bankgiro, PlusGiro, bankkonto eller IBAN. */
export function sellerHasPaymentMethod(seller: SellerBlockerInput): boolean {
  return (
    !missing(seller.bankgiro) || !missing(seller.plusgiro) || !missing(seller.iban) || !missing(seller.bankAccount)
  );
}

/**
 * Kanoniska företagsblockers för fakturautskick. Samma regler och koder som
 * "Innan fakturan kan skickas" – Inställningar visar bara den här delmängden.
 */
export function collectSellerBlockers(seller: SellerBlockerInput): IssueBlocker[] {
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
  // Svenska företag: momsreg.nr härleds ur org.nr, så det kan varken saknas
  // eller ha fel format på egen hand – org.nr-blockern ovan täcker allt.
  // Bara utländska företag har ett eget momsnummer som kan saknas.
  if (!isSwedishCountry(seller.country)) {
    if (missing(seller.vatNumber)) {
      blockers.push({ code: "seller_vat", message: "Momsregistreringsnummer saknas i företagsuppgifterna.", href, actionLabel: complete });
    } else if (!isForeignVatNumberFormat(seller.vatNumber)) {
      blockers.push({
        code: "seller_vat_format",
        message: "Ange momsregistreringsnumret med landskod, t.ex. DE123456789.",
        href,
        actionLabel: complete,
      });
    }
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
