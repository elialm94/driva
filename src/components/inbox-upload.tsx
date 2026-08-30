"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { buttonClasses } from "./ui";
import { uploadInboxDocumentAction } from "@/app/actions";

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
              const result = await uploadInboxDocumentAction({
                filename: file.name,
                contentType: file.type || "application/pdf",
              });
              if (!result.ok) setError(result.error);
              else router.refresh();
            });
          }}
        />
      </label>
      {error ? <p className="text-[13px] text-danger">{error}</p> : null}
    </div>
  );
}
