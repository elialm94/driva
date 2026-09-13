"use client";

import { useActionState } from "react";
import { acceptTermsAction, type AcceptTermsState } from "./actions";

export function AcceptTermsForm({ next, version }: { next: string; version: string }) {
  const [state, submit, pending] = useActionState<AcceptTermsState, FormData>(acceptTermsAction, {});
  return (
    <form action={submit} className="space-y-4" data-terms-gate-form>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="version" value={version} />
      <label className="flex items-start gap-2.5 text-[15px] text-ink" htmlFor="godkann-villkor">
        <input
          id="godkann-villkor"
          name="acceptTerms"
          type="checkbox"
          required
          className="mt-1 size-4 shrink-0 rounded border-line-strong accent-accent"
          data-terms-gate-checkbox
        />
        <span>Jag har läst och godkänner de nya villkoren (version {version}) och integritetspolicyn.</span>
      </label>
      {state.error ? (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-[14px] text-danger">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-accent px-4 py-3 text-[15px] font-medium text-white transition-colors hover:bg-accent-deep disabled:opacity-60 sm:w-auto"
        data-terms-gate-submit
      >
        {pending ? "Sparar …" : "Godkänn och fortsätt"}
      </button>
    </form>
  );
}
