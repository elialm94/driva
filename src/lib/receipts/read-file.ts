/**
 * Klientsidan: paketera ett valt kvitto för uploadReceiptAction.
 *
 * Filen skickas som File i en FormData – INTE som data-URL-sträng. React
 * Flight (server actions) har ett tak på ~1e6 tecken för strängargument;
 * en data-URL för ett kvitto över ~730 kB stoppades därför redan i
 * dekodningen med ett rått engelskt Next-fel i UI:t. Blob/File räknas inte
 * mot det taket och begränsas bara av serverActions.bodySizeLimit (8 MB).
 */

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export function receiptUploadForm(expenseId: string, file: File): FormData {
  if (file.size > RECEIPT_MAX_BYTES) {
    throw new Error("Kvittot är för stort (max 5 MB).");
  }
  const form = new FormData();
  form.set("expenseId", expenseId);
  form.set("file", file, file.name || "kvitto");
  return form;
}
