import type { CompanySettings } from "../types";
import { isBankgiroFormat, isIbanFormat, isOrgnrFormat, isPlusgiroFormat, isVatNumberFormat, vatMatchesOrgnr } from "./formats";

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

/** Klient-säker – ingen store/fs. Samma regler som utfärdande av faktura. */
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
