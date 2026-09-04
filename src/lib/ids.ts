import { randomBytes, randomUUID } from "crypto";

export function uid(): string {
  return randomUUID();
}

/** Publik, ogissbar token för kundlänkar. */
export function publicToken(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  let out = "";
  for (let i = 0; i < 20; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * Bankgirot OCR-10, mjuk variant (utan längdsiffra).
 *
 * Bas = enbart siffror. Kontrollsiffra = modulus-10 med vikterna 2-1-2…
 * från höger. Produkt > 9 → siffrorna summeras (samma som −9 för en
 * ensiffrig dubblering).
 *
 * Hård OCR (längdsiffra + nummer + kontroll) dokumenteras inte i
 * betalstacken – vi inför inte ett tredje schema.
 */
export function bankgirotModulus10CheckDigit(baseDigits: string): string {
  if (!/^\d+$/.test(baseDigits)) {
    throw new Error("OCR-bas måste vara enbart siffror.");
  }
  let sum = 0;
  const digits = baseDigits.split("").reverse();
  for (let i = 0; i < digits.length; i++) {
    let d = parseInt(digits[i], 10) * (i % 2 === 0 ? 2 : 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return ((10 - (sum % 10)) % 10).toString();
}

/**
 * OCR för utfärdad kundfaktura: fakturanummer (siffror) + OCR-10-kontrollsiffra.
 * Anropas när numret tilldelas – inte vid förhandsvisning av utkast.
 */
export function ocrForInvoice(invoiceNumber: number): string {
  const base = String(invoiceNumber).replace(/\D/g, "");
  if (!base) return "";
  return base + bankgirotModulus10CheckDigit(base);
}

/** True när strängen är siffror med giltig Bankgirot OCR-10-kontrollsiffra (2–25 tecken). */
export function isValidBankgirotOcr(ocr: string | null | undefined): boolean {
  const digits = ocr?.trim() ?? "";
  if (!/^\d{2,25}$/.test(digits)) return false;
  const base = digits.slice(0, -1);
  return digits === base + bankgirotModulus10CheckDigit(base);
}

/**
 * Behåll giltigt sparat OCR (även äldre schema som fortfarande verifierar).
 * Tomt eller ogiltigt fylls från fakturanumret. Skriver aldrig över en giltig snapshot.
 */
export function issuedOcrForInvoice(invoiceNumber: number, existingOcr?: string | null): string {
  const stored = existingOcr?.trim() ?? "";
  if (stored && isValidBankgirotOcr(stored)) return stored;
  return ocrForInvoice(invoiceNumber);
}
