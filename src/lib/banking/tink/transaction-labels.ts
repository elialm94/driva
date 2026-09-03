/**
 * Motpart och beskrivning från Tink Data v2.
 *
 * Tink skickar flera texter på samma transaktion. Tidigare föll båda
 * kolumnerna tillbaka på `descriptions.display`, så Demo Bank (och många
 * kortköp) visade samma sträng två gånger. Här tar kolumnerna olika fält:
 *
 *   Motpart     merchantName → payer/payee.name → display → original
 *   Beskrivning original → detailed.unstructured → display
 *               (hoppas över om den är samma som motparten)
 *
 * Inget extra Tink-anrop – fälten finns redan i GET /data/v2/transactions.
 */
import type { TinkTransaction } from "./client";

export function firstBankText(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const text = value?.trim();
    if (text) return text;
  }
  return undefined;
}

export function sameBankLabel(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Första kandidaten som skiljer sig från motparten – annars tom (ingen dubblettkolumn). */
export function distinctBankLabel(candidates: Array<string | undefined>, counterpart: string): string {
  for (const candidate of candidates) {
    const text = candidate?.trim();
    if (text && !sameBankLabel(text, counterpart)) return text;
  }
  return "";
}

/** In: avsändare (payer). Ut: mottagare (payee). Andra sidan är reserv om banken bara fyllt en. */
export function counterpartFromTink(tx: TinkTransaction, amount: number): string {
  const incoming = amount > 0;
  const primary = incoming ? tx.counterparties?.payer?.name : tx.counterparties?.payee?.name;
  const other = incoming ? tx.counterparties?.payee?.name : tx.counterparties?.payer?.name;
  return (
    firstBankText(
      tx.merchantInformation?.merchantName,
      primary,
      other,
      tx.descriptions?.display,
      tx.descriptions?.original
    ) || "Okänd"
  );
}

export function descriptionFromTink(tx: TinkTransaction, counterpart: string): string {
  return distinctBankLabel(
    [tx.descriptions?.original, tx.descriptions?.detailed?.unstructured, tx.descriptions?.display],
    counterpart
  );
}
