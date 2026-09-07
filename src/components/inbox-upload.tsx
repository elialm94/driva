"use client";

import { ReceiptUpload } from "@/components/receipt-upload";
import { uploadInboxDocumentAction } from "@/app/actions";
import { inboxDocumentForm } from "@/lib/receipts/read-file";

export function InboxUploadZone() {
  return (
    <ReceiptUpload
      variant="landing"
      title="Släpp kvitton och fakturor här"
      subtitle="Eller tryck för att välja, fota med kameran eller klistra in en skärmdump. De läses av och hamnar i inboxen."
      pasteAnywhere
      upload={async (file) => {
        // Filen följer med som File i en FormData: underlaget bevaras och tolkas.
        const result = await uploadInboxDocumentAction(inboxDocumentForm(file));
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, note: result.autoBooked ? "Bokfört" : "I inboxen – kontrollera uppgifterna" };
      }}
    />
  );
}
