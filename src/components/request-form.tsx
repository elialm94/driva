"use client";

import { useState, useTransition } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Modal } from "./modal";
import { buttonClasses } from "./ui";
import { createRequestAction } from "@/app/actions";
import type { RequestSource } from "@/lib/types";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";

export function NewRequestButton({ customerId, customerName }: { customerId: string; customerName: string }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<RequestSource>("telefon");
  const [isPending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      await createRequestAction({
        customerId,
        title: String(formData.get("title") ?? ""),
        message: String(formData.get("message") ?? ""),
        source,
      });
      setOpen(false);
    });
  }

  return (
    <>
      <button className={buttonClasses("secondary", "sm")} onClick={() => setOpen(true)}>
        <MessageSquarePlus className="size-3.5" />
        Ny förfrågan
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Ny förfrågan från ${customerName}`} size="md">
        <form action={submit} className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1 block text-[13px] font-medium text-soft">Vad gäller det?</label>
            <input name="title" required className={inputCls} placeholder="T.ex. Platsbyggd bokhylla" />
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-soft">Beskrivning</label>
            <textarea
              name="message"
              rows={4}
              required
              className={inputCls}
              placeholder="Anteckna vad kunden vill ha gjort, önskat datum, budget …"
            />
            <p className="mt-1 text-[12px] text-muted">Driva tolkar automatiskt typ av arbete, önskat datum och budget.</p>
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-soft">Kom via</label>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["telefon", "Telefon"],
                  ["email", "E-post"],
                  ["manuell", "Annat"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSource(key)}
                  className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    source === key ? "border-ink bg-ink text-white" : "border-line-strong text-soft hover:border-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setOpen(false)}>
              Avbryt
            </button>
            <button type="submit" className={buttonClasses("primary")} disabled={isPending}>
              {isPending ? "Sparar …" : "Spara förfrågan"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
