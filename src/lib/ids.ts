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

/** OCR-nummer med Luhn-kontrollsiffra utifrån fakturanummer. */
export function ocrForInvoice(invoiceNumber: number): string {
  const base = `${invoiceNumber}77`;
  let sum = 0;
  const digits = base.split("").reverse();
  for (let i = 0; i < digits.length; i++) {
    let d = parseInt(digits[i], 10) * (i % 2 === 0 ? 2 : 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return base + ((10 - (sum % 10)) % 10).toString();
}
