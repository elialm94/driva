/**
 * Klientsidan: paketera en vald fil för en server action.
 *
 * Filen skickas som File i en FormData – INTE som data-URL-sträng. React
 * Flight (server actions) har ett tak på ~1e6 tecken för strängargument;
 * en data-URL för ett kvitto över ~730 kB stoppades därför redan i
 * dekodningen med ett rått engelskt Next-fel i UI:t. Blob/File räknas inte
 * mot det taket och begränsas bara av serverActions.bodySizeLimit (8 MB).
 *
 * Servern läser fältet "file" med receiptFileFromForm (receipt-file.ts) och
 * validerar där – storlekskontrollen här finns bara för att svara direkt i
 * webbläsaren, på svenska, innan filen skickas.
 */

import { UPLOAD_MAX_BYTES, UPLOAD_MAX_LABEL } from "../uploads/limits";

export const RECEIPT_MAX_BYTES = UPLOAD_MAX_BYTES;
/** Speglar serverns bodySizeLimit. */
export const VERIFICATION_ATTACHMENT_MAX_BYTES = UPLOAD_MAX_BYTES;

function fileForm(file: File, fallbackName: string): FormData {
  const form = new FormData();
  form.set("file", file, file.name || fallbackName);
  return form;
}

/** Kvitto till ett känt bankköp (uploadReceiptAction). */
export function receiptUploadForm(expenseId: string, file: File): FormData {
  if (file.size > RECEIPT_MAX_BYTES) {
    throw new Error(`Kvittot är för stort (max ${UPLOAD_MAX_LABEL}).`);
  }
  const form = fileForm(file, "kvitto");
  form.set("expenseId", expenseId);
  return form;
}

/** Fristående kvitto eller leverantörsfaktura till inboxen (uploadInboxDocumentAction). */
export function inboxDocumentForm(file: File): FormData {
  if (file.size > RECEIPT_MAX_BYTES) {
    throw new Error(`Filen är för stor (max ${UPLOAD_MAX_LABEL}).`);
  }
  return fileForm(file, "dokument");
}

/** Kvittot till en handregistrerad utgift (createManualExpenseAction). */
export function manualExpenseReceiptForm(file: File): FormData {
  if (file.size > RECEIPT_MAX_BYTES) {
    throw new Error(`Kvittot är för stort (max ${UPLOAD_MAX_LABEL}).`);
  }
  return fileForm(file, "kvitto");
}

/** Underlaget till ett manuellt verifikat (postManualVerificationAction). */
export function verificationAttachmentForm(file: File): FormData {
  if (file.size > VERIFICATION_ATTACHMENT_MAX_BYTES) {
    throw new Error(`Underlaget är för stort (max ${UPLOAD_MAX_LABEL}).`);
  }
  return fileForm(file, "underlag");
}
