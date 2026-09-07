"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { buttonClasses } from "./ui";
import { uploadInboxDocumentAction } from "@/app/actions";
import { inboxDocumentForm } from "@/lib/receipts/read-file";

export function InboxUploadButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <label className={buttonClasses("secondary", "sm") + " cursor-pointer max-lg:min-h-11"}>
        <Plus className="size-3.5" />
        {pending ? "Läser in …" : "Lägg till dokument"}
        <input
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          disabled={pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError(null);
            startTransition(async () => {
              try {
                // Filen följer med som File i en FormData: underlaget bevaras och tolkas.
                const result = await uploadInboxDocumentAction(inboxDocumentForm(file));
                if (!result.ok) setError(result.error);
                else router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Kunde inte läsa filen.");
              }
            });
          }}
        />
      </label>
      {error ? <p className="text-[13px] text-danger">{error}</p> : null}
    </div>
  );
}
