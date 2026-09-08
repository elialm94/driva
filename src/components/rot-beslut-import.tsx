"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClasses } from "./ui";
import { importTaxReductionBeslutAction } from "@/app/actions";

export function RotBeslutImport({ jobId, invoiceId }: { jobId?: string; invoiceId?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  return (
    <div className="mt-3">
      <p className="text-[13px] font-medium text-ink">Importera beslut från Skatteverket</p>
      <p className="mt-0.5 text-[12px] text-muted">JSON från e-tjänsten. Driva fyller i utfallet så du inte skriver om beloppet.</p>
      <input
        type="file"
        accept="application/json,.json"
        className="mt-2 block text-[13px]"
        disabled={isPending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          start(async () => {
            setError(null);
            const text = await file.text();
            const result = await importTaxReductionBeslutAction({ jobId, invoiceId, json: text });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
          });
        }}
      />
      {error ? <p className="mt-1 text-[13px] text-danger">{error}</p> : null}
      <button type="button" className={`${buttonClasses("ghost", "sm")} mt-1 sr-only`} tabIndex={-1}>
        Importera
      </button>
    </div>
  );
}
