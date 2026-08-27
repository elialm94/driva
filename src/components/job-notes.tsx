"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { buttonClasses, Card } from "./ui";
import { Modal } from "./modal";
import { datumTid } from "@/lib/format";
import type { JobNoteEntry } from "@/lib/services/jobs";
import { appendJobNoteAction } from "@/app/actions";

export function JobNotes({ jobId, notes }: { jobId: string; notes: JobNoteEntry[] }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [isPending, startTransition] = useTransition();

  function add() {
    const value = text.trim();
    if (!value) return;
    startTransition(async () => {
      await appendJobNoteAction(jobId, value);
      setText("");
      setOpen(false);
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Anteckningar</h2>
        <button type="button" className={buttonClasses("ghost", "sm")} onClick={() => setOpen(true)}>
          <Plus className="size-3.5" /> Lägg till anteckning
        </button>
      </div>

      {notes.length > 0 ? (
        <Card className="divide-y divide-line/70">
          {notes.map((note, i) => (
            <div key={`${note.at ?? "legacy"}-${i}`} className="px-5 py-3.5">
              <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink">{note.text}</p>
              {note.at ? <p className="mt-1 text-[12px] text-muted">{datumTid(note.at)}</p> : null}
            </div>
          ))}
        </Card>
      ) : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Ny anteckning"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setOpen(false)}>
              Avbryt
            </button>
            <button type="button" className={buttonClasses("primary")} disabled={isPending || !text.trim()} onClick={add}>
              {isPending ? "Sparar …" : "Spara"}
            </button>
          </div>
        }
      >
        <div className="px-6 py-5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            autoFocus
            placeholder="Leveranser, avvikelser, saker att komma ihåg …"
            className="w-full resize-none rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent"
          />
        </div>
      </Modal>
    </div>
  );
}
