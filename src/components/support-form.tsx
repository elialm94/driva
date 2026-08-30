"use client";

/**
 * Kundens supportformulär: kort beskrivning + valfri bild/PDF. Ingen teknisk
 * information efterfrågas – kontext (konto, företag, rutt, enhet, version)
 * bifogas automatiskt av servern.
 */
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { createSupportTicketAction, type SupportFormState } from "@/app/support-actions";
import { buttonClasses } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClasses("primary", "md")}>
      {pending ? "Skickar …" : "Skicka"}
    </button>
  );
}

export function SupportForm() {
  const [state, formAction] = useActionState<SupportFormState, FormData>(
    createSupportTicketAction,
    {}
  );
  const params = useSearchParams();
  const fran = params.get("fran") ?? "";

  if (state.notice) {
    return (
      <div className="card px-5 py-6">
        <p className="text-[15px] font-medium text-ink">{state.notice}</p>
        <p className="mt-1.5 text-sm text-soft">
          Svaret kommer till din inloggade e-postadress. Du kan stänga den här sidan.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="card flex flex-col gap-4 px-5 py-5">
      <input type="hidden" name="route" value={fran} />
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Vad behöver du hjälp med?</span>
        <textarea
          name="message"
          required
          minLength={5}
          rows={5}
          placeholder="Beskriv kort vad som hänt eller vad du vill göra."
          className="rounded-xl border border-line bg-card px-3.5 py-2.5 text-[15px] leading-relaxed outline-none transition-colors focus:border-accent"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">
          Bifoga en bild eller PDF <span className="font-normal text-muted">(valfritt, max 1,5 MB)</span>
        </span>
        <input
          type="file"
          name="attachment"
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
          className="text-sm text-soft file:mr-3 file:rounded-lg file:border file:border-line file:bg-canvas file:px-3 file:py-1.5 file:text-sm file:text-ink"
        />
      </label>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          Ditt konto och företag följer med automatiskt – du behöver inte skriva några tekniska
          uppgifter.
        </p>
        <SubmitButton />
      </div>
    </form>
  );
}
