"use client";

import { useState, useTransition } from "react";
import { Download, Send } from "lucide-react";
import { emailAccountantPackAction } from "@/app/bokforing-actions";
import { buttonClasses } from "./ui";

export function AccountantPackActions({
  yearLabel,
  fiscalYearId,
}: {
  yearLabel: string;
  fiscalYearId?: string;
}) {
  const [pending, start] = useTransition();
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function downloadBase64(filename: string, bytesBase64: string) {
    const bytes = Uint8Array.from(atob(bytesBase64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <a
        href={`/api/bokforing/export?typ=sie&ar=${encodeURIComponent(yearLabel)}`}
        className={buttonClasses("secondary", "sm")}
      >
        <Download className="size-3.5" />
        SIE-fil {yearLabel}
      </a>
      <label className="block">
        <span className="sr-only">Mejladress till redovisningskonsulten</span>
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="konsult@exempel.se"
          className="h-9 w-52 rounded-xl border border-line bg-card px-3 text-[13px] outline-none focus:border-accent"
        />
      </label>
      <button
        type="button"
        className={buttonClasses("secondary", "sm")}
        disabled={pending}
        onClick={() => {
          setError(null);
          setNote(null);
          start(async () => {
            const res = await emailAccountantPackAction(to, fiscalYearId);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            if (res.mode === "download" && res.filename && res.bytesBase64) {
              downloadBase64(res.filename, res.bytesBase64);
              setNote("Ingen mejlnyckel är satt. Paketet laddas ned i stället.");
              return;
            }
            setNote("Paketet är skickat.");
          });
        }}
      >
        <Send className="size-3.5" />
        {pending ? "Skickar …" : "Skicka till redovisningskonsult"}
      </button>
      {error ? <p className="w-full text-[12px] text-danger">{error}</p> : null}
      {note ? <p className="w-full text-[12px] text-soft">{note}</p> : null}
    </div>
  );
}
