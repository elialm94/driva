/**
 * Omvänd byggmoms (byggmoms) – en sanning för fakturor, dokument och kontering.
 *
 * Reglerna i korthet: säljer ett byggföretag byggtjänster till ett annat
 * byggföretag fakturerar säljaren UTAN moms, och köparen redovisar både
 * utgående och ingående moms i sin egen deklaration. Säljarens omsättning
 * hamnar i ruta 41 i momsdeklarationen, köparens underlag i ruta 24.
 *
 * Två saker är medvetet inte automatiska:
 *   * Vem som är byggföretag. Bedömningen kräver kunskap om köparens
 *     verksamhet som produkten inte har, så det är en markering på kunden.
 *   * Vad som är en byggtjänst. Raderna sätts till 0 % av den som fakturerar;
 *     validate.ts blockerar bara fakturor där markeringen och raderna säger
 *     olika saker.
 */

import type { Customer, DocLine, Invoice } from "../types";
import { formatVatNumber } from "./formats";

/**
 * Laghänvisningen som ska stå på fakturan. Utan en uppgift om att omvänd
 * betalningsskyldighet gäller är fakturan inte en giltig faktura enligt
 * mervärdesskattelagens fakturakrav.
 */
export const REVERSE_CHARGE_CONSTRUCTION_NOTE =
  "Omvänd betalningsskyldighet för mervärdesskatt gäller enligt 1 kap. 2 § första stycket 4 b mervärdesskattelagen. Köparen är skyldig att redovisa mervärdesskatten.";

export const REVERSE_CHARGE_HEADING = "Omvänd byggmoms";

/** Momssatsen köparen redovisar på byggtjänster. Byggtjänster är alltid 25 %. */
export const REVERSE_CHARGE_VAT_RATE = 25;

/**
 * Gäller omvänd byggmoms mot den här kunden? Bara företagskunder – en
 * privatperson kan aldrig vara betalningsskyldig för säljarens moms.
 */
export function reverseChargeAppliesTo(
  customer: Pick<Customer, "kind" | "reverseChargeConstruction">
): boolean {
  return customer.kind === "foretag" && customer.reverseChargeConstruction === true;
}

/**
 * Köparens momsregistreringsnummer, härlett ur organisationsnummret.
 * Tom sträng när organisationsnummer saknas eller inte har tio siffror –
 * anroparen avgör om det är ett hinder.
 */
export function buyerVatNumber(customer: Pick<Customer, "orgNumber">): string {
  return formatVatNumber(customer.orgNumber ?? "");
}

/**
 * Fakturans egen markering. Utfärdade fakturor läser den frusna, utkast den
 * som sattes när utkastet skapades. Kundens markering används INTE här: en
 * utfärdad faktura ska bära det som gällde vid utfärdandet.
 */
export function invoiceHasReverseCharge(
  invoice: Pick<Invoice, "status" | "reverseCharge" | "issuedSnapshot">
): boolean {
  if (invoice.status !== "utkast" && invoice.issuedSnapshot) {
    return invoice.issuedSnapshot.reverseCharge === true;
  }
  return invoice.reverseCharge === true;
}

/** Rader som bär moms fastän köparen ska redovisa den. */
export function linesWithVat(lines: readonly DocLine[]): DocLine[] {
  return lines.filter((line) => line.vatRate > 0);
}

/**
 * Nollar momsen på raderna. Anropas när utkastet skapas eller sparas mot en
 * kund med omvänd byggmoms, så att den som fakturerar aldrig behöver komma
 * ihåg momssatsen – markeringen på kunden räcker.
 */
export function withoutVat(lines: DocLine[]): DocLine[] {
  return lines.map((line) => (line.vatRate === 0 ? line : { ...line, vatRate: 0 as const }));
}
