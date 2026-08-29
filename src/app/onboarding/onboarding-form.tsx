"use client";

import { useActionState } from "react";
import { onboardingAction, type OnboardingFormState } from "@/app/auth-actions";

const initialState: OnboardingFormState = {};

export function OnboardingForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, submit, pending] = useActionState(onboardingAction, initialState);

  const field = "mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500";

  return (
    <form action={submit} className="space-y-4">
      <div>
        <label htmlFor="ob-name" className="block text-sm font-medium text-stone-700">
          Företagsnamn
        </label>
        <input id="ob-name" name="name" required minLength={2} className={field} placeholder="Söders Snickeri AB" />
      </div>
      <div>
        <label htmlFor="ob-orgnr" className="block text-sm font-medium text-stone-700">
          Organisationsnummer
        </label>
        <input
          id="ob-orgnr"
          name="orgNumber"
          required
          pattern="\d{6}-?\d{4}"
          className={field}
          placeholder="556677-8899"
        />
      </div>
      <div>
        <label htmlFor="ob-email" className="block text-sm font-medium text-stone-700">
          Kontakt-e-post
        </label>
        <input id="ob-email" name="email" type="email" required defaultValue={defaultEmail} className={field} />
      </div>
      <div>
        <label htmlFor="ob-phone" className="block text-sm font-medium text-stone-700">
          Telefon <span className="font-normal text-stone-400">(valfritt)</span>
        </label>
        <input id="ob-phone" name="phone" type="tel" className={field} placeholder="070-123 45 67" />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
      >
        {pending ? "Skapar företag …" : "Kom igång"}
      </button>
    </form>
  );
}
