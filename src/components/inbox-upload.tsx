"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileDropzone } from "@/components/file-dropzone";
import { uploadInboxDocumentAction } from "@/app/actions";
import { RECEIPT_MAX_BYTES, inboxDocumentForm } from "@/lib/receipts/read-file";

export function InboxUploadZone() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onFiles(files: File[]) {
    setError(null);
    startTransition(async () => {
      for (const file of files) {
        try {
          // Filen följer med som File i en FormData: underlaget bevaras och tolkas.
          const result = await uploadInboxDocumentAction(inboxDocumentForm(file));
          if (!result.ok) {
            setError(result.error);
            return;
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Kunde inte läsa filen.");
          return;
        }
      }
      router.refresh();
    });
  }

  return (
    <FileDropzone
      variant="landing"
      accept="image/*,.pdf,.heic,.heif"
      multiple
      busy={pending}
      error={error}
      maxBytes={RECEIPT_MAX_BYTES}
      title="Släpp kvitton och fakturor här"
      subtitle="Eller tryck för att välja från enheten. De läses av och hamnar i inboxen."
      formats="PDF, JPG, PNG, HEIC · max 5 MB per fil"
      onFiles={onFiles}
    />
  );
}
