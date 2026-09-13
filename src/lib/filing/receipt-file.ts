/**
 * Kvittensfilen från en manuell inlämning (PDF eller bild från e-tjänsten).
 *
 * Lagras exakt som kvitton (receipts/receipt-file.ts): privata bucketen
 * `receipts` under <business_id>/<inlämnings-id>/<filnamn> när fillagring
 * finns, annars inline på raden. Samma tenantpolicy (bara medlemmar i
 * företaget), samma tak och samma tillåtna typer. Bucketen är krypterad i
 * vila hos leverantören och nås bara via servern efter behörighetskontroll
 * (/api/bokforing/inlamning/<id>/kvittens). Bevaras som bokföringsunderlag:
 * kvittensen visar att deklarationen lämnades, och följer företagets data
 * vid export och radering.
 */
import type { FilingReceiptFile, FilingSubmission } from "../types";
import { supabaseAuthAdminClient } from "../platform/supabase-admin";
import {
  RECEIPT_BUCKET,
  receiptContentTypeFor,
  storeReceiptFile,
  type ReceiptFileInput,
} from "../receipts/receipt-file";

import { RECEIPT_FILE_FIELD } from "./receipt-field";

export { RECEIPT_FILE_FIELD };

/** Läser kvittensfilen ur server actionens FormData; null när inget valdes. */
export async function filingReceiptFromForm(form: FormData): Promise<(ReceiptFileInput & { filename: string }) | null> {
  const entry = form.get(RECEIPT_FILE_FIELD);
  if (!(entry instanceof Blob) || entry.size === 0) return null;
  const filename = (entry instanceof File && entry.name.trim()) || "kvittens";
  return {
    bytes: Buffer.from(await entry.arrayBuffer()),
    contentType: receiptContentTypeFor(filename, entry.type),
    filename,
  };
}

/**
 * Sparar kvittensen under inlämningens id. Kastar begripliga fel (typ,
 * storlek) – då rapporteras ingen inlämning, för rapporten utan kvittensen
 * vore en annan rapport än den användaren gjorde.
 */
export async function storeFilingReceiptFile(
  submissionId: string,
  file: ReceiptFileInput & { filename: string }
): Promise<FilingReceiptFile> {
  const safeName = file.filename.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "kvittens";
  const meta = await storeReceiptFile({ id: submissionId, filename: `kvittens-${safeName}` }, file);
  return {
    filename: safeName,
    contentType: meta.contentType ?? file.contentType,
    sizeBytes: meta.sizeBytes ?? file.bytes.length,
    ...(meta.storagePath ? { storagePath: meta.storagePath } : {}),
    ...(meta.contentBase64 ? { contentBase64: meta.contentBase64 } : {}),
  };
}

/** Filens bytes, eller undefined när den inte går att läsa (bucket saknas). */
export async function filingReceiptFileContent(
  submission: Pick<FilingSubmission, "manualReceipt">
): Promise<ReceiptFileInput | undefined> {
  const file = submission.manualReceipt?.file;
  if (!file) return undefined;
  if (file.contentBase64) {
    try {
      return { bytes: Buffer.from(file.contentBase64, "base64"), contentType: file.contentType };
    } catch {
      return undefined;
    }
  }
  if (file.storagePath) {
    const admin = supabaseAuthAdminClient();
    if (!admin) return undefined;
    const { data, error } = await admin.storage.from(RECEIPT_BUCKET).download(file.storagePath);
    if (error || !data) return undefined;
    return { bytes: Buffer.from(await data.arrayBuffer()), contentType: data.type || file.contentType };
  }
  return undefined;
}
