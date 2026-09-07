import type { EkonomiTab } from "./nav";

/**
 * ?atgard=<action-id> är åtgärdsmotorns djuplänk från Hem/Bokföring in i
 * Ekonomi-registret. Här översätts den till raden som ska markeras och
 * scrollas fram – aldrig till en åtgärd som utförs bara av att länken öppnas.
 *   bank-<txId>            → banktransaktionen (fliken Bank)
 *   question-/receipt-<id> → utgiften (fliken Utgifter)
 *   supplier-<id>          → leverantörsfakturan (fliken Utgifter)
 */
export function highlightFromAtgard(atgard: string | undefined, tab: EkonomiTab): string | undefined {
  const id = (atgard ?? "").trim();
  if (!id) return undefined;
  if (tab === "bank") {
    return id.startsWith("bank-") && id !== "bank-unexplained" ? id.slice("bank-".length) : undefined;
  }
  if (tab === "utgifter") {
    for (const prefix of ["question-", "receipt-", "supplier-"]) {
      if (id.startsWith(prefix)) return id.slice(prefix.length) || undefined;
    }
  }
  return undefined;
}
