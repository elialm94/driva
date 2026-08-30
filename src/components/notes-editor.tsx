"use client";

import { useRef, useState } from "react";
import { SaveStatus } from "./save-status";
import { useAutosaveLoop } from "./use-autosave";

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
  const valueRef = useRef(initial);
  const { state, loop } = useAutosaveLoop();

  function persistLatest() {
    return loop.notify(valueRef.current, async () => {
      try {
        await save(valueRef.current);
        return { ok: true } as const;
      } catch {
        return { ok: false, error: "Kunde inte spara" } as const;
      }
    });
  }

  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          valueRef.current = next;
          setValue(next);
          persistLatest();
        }}
        onBlur={() => {
          void loop.flush();
        }}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-none rounded-xl border border-line bg-canvas/50 px-3.5 py-2.5 text-[14px] leading-relaxed text-ink placeholder:text-muted focus:border-accent focus:bg-card"
      />
      <div className="mt-1.5 flex min-h-6 items-center justify-end">
        <SaveStatus state={state} onRetry={() => void loop.flush()} />
      </div>
    </div>
  );
}
