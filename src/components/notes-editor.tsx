"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";

export function NotesEditor({
  initial,
  placeholder,
  save,
}: {
  initial: string;
  placeholder: string;
  save: (notes: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dirty = value !== initial && !saved;

  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-none rounded-xl border border-line bg-canvas/50 px-3.5 py-2.5 text-[14px] leading-relaxed text-ink placeholder:text-muted focus:border-accent focus:bg-card"
      />
      <div className="mt-1.5 flex h-6 items-center justify-end gap-2 text-[13px]">
        {saved ? (
          <span className="flex items-center gap-1 text-ok">
            <Check className="size-3.5" /> Sparat
          </span>
        ) : dirty ? (
          <button
            className="font-medium text-accent hover:text-accent-deep disabled:opacity-50"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await save(value);
                setSaved(true);
              })
            }
          >
            {isPending ? "Sparar …" : "Spara anteckning"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
