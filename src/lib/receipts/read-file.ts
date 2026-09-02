/** Klientsidan: läs ett valt kvitto som data-URL för server actionen. */

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export function receiptFileToDataUrl(file: File): Promise<string> {
  if (file.size > RECEIPT_MAX_BYTES) {
    return Promise.reject(new Error("Kvittot är för stort (max 5 MB)."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Kvittofilen kunde inte läsas."));
    reader.readAsDataURL(file);
  });
}
