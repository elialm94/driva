import type { Receipt } from "../types";

/* Rena hjälpare utan serverberoenden – får importeras från listor/klientkod. */

/** Finns själva filen sparad (inte bara uppgifterna om den)? */
export function receiptFileStored(receipt: Pick<Receipt, "storagePath" | "contentBase64">): boolean {
  return Boolean(receipt.storagePath || receipt.contentBase64);
}
