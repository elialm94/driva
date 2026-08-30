"use client";

/**
 * Kundens supportformulär. Kontext (konto, företag, rutt) bifogas av servern.
 */
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import { Plus, X } from "lucide-react";
import { createSupportTicketAction, type SupportFormState } from "@/app/support-actions";
import { buttonClasses, cx } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClasses("primary", "md")}>
      {pending ? "Skickar …" : "Skicka"}
    </button>
  );
}

export function SupportForm() {
  const [resetKey, setResetKey] = useState(0);
  const params = useSearchParams();
  const pathname = usePathname();
  const fran = params.get("fran") || pathname || "";
  return <SupportFormSession key={resetKey} route={fran} onRestart={() => setResetKey((n) => n + 1)} />;
}

function SupportFormSession({ route, onRestart }: { route: string; onRestart: () => void }) {
  const [state, formAction] = useActionState<SupportFormState, FormData>(createSupportTicketAction, {});

  if (state.notice) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-xl border border-line bg-card px-4 py-4">
          <p className="text-[15px] font-medium text-ink">✓ {state.notice}</p>
          <p className="mt-1 text-sm text-soft">Vi återkommer så snart vi kan.</p>
          {state.warning ? <p className="mt-2 text-sm text-warn">{state.warning}</p> : null}
        </div>
        <button type="button" onClick={onRestart} className={buttonClasses("secondary", "md")}>
          Skicka ett nytt ärende
        </button>
      </div>
    );
  }

  return <TicketForm action={formAction} state={state} route={route} />;
}

function TicketForm({
  action,
  state,
  route,
}: {
  action: (payload: FormData) => void;
  state: SupportFormState;
  route: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  function chooseFile(next: File | null) {
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return next && next.type.startsWith("image/") ? URL.createObjectURL(next) : null;
    });
    setFile(next);
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="route" value={route} />
      <label className="flex flex-col gap-1.5">
        <span className="sr-only">Beskriv vad du behöver hjälp med</span>
        <textarea
          name="message"
          required
          minLength={5}
          rows={4}
          placeholder="Beskriv vad du behöver hjälp med."
          className={cx(
            "rounded-xl border bg-card px-3.5 py-2.5 text-[15px] leading-relaxed outline-none transition-colors focus:border-accent",
            state.field === "message" && state.error ? "border-danger" : "border-line"
          )}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-soft">Bifoga bild eller PDF (valfritt)</p>
        <input
          ref={fileRef}
          type="file"
          name="attachment"
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
          className="sr-only"
          onChange={(e) => {
            const next = e.target.files?.[0] ?? null;
            setFileError(null);
            if (next && next.size > 5 * 1024 * 1024) {
              setFileError("Bilagan är för stor (max 5 MB).");
              e.target.value = "";
              chooseFile(null);
              return;
            }
            chooseFile(next);
          }}
        />
        {file ? (
          <div className="flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="size-9 rounded-md object-cover" />
            ) : (
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">PDF</span>
            )}
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{file.name}</span>
            <button
              type="button"
              aria-label="Ta bort fil"
              className="rounded-md p-1 text-muted hover:bg-canvas hover:text-ink"
              onClick={() => {
                chooseFile(null);
                setFileError(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={buttonClasses("secondary", "sm", "self-start")}
          >
            <Plus className="size-3.5" /> Lägg till fil
          </button>
        )}
        {fileError || (state.field === "attachment" && state.error) ? (
          <p className="text-sm text-danger">{fileError || state.error}</p>
        ) : null}
      </div>

      {state.error && state.field !== "attachment" ? <p className="text-sm text-danger">{state.error}</p> : null}

      <SubmitButton />
      <p className="text-[12px] leading-relaxed text-muted">Ditt konto och företag följer med automatiskt.</p>
    </form>
  );
}
