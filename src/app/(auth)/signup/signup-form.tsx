"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { signupAction, type AuthFormState } from "@/app/auth-actions";
import { loginHrefWithNext } from "@/lib/auth/signup-flow";

const initialState: AuthFormState = {};

export function SignupForm({ next }: { next: string }) {
  const [signupState, submitSignup, signupPending] = useActionState(signupAction, initialState);

  // Tillbaka-navigering / pageshow: rensa transient pending-känsla. Success
  // redirectar med history replace, så den här sidan ska aldrig se "klart".
  useEffect(() => {
    const resetIfRestored = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", resetIfRestored);
    return () => window.removeEventListener("pageshow", resetIfRestored);
  }, []);

  return (
    <form action={submitSignup} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="signup-email" className="block text-sm font-medium text-stone-700">
          E-post
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500"
          placeholder="du@foretaget.se"
        />
      </div>
      <div>
        <label htmlFor="signup-password" className="block text-sm font-medium text-stone-700">
          Lösenord
        </label>
        <input
          id="signup-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500"
          placeholder="Minst 8 tecken"
        />
      </div>

      {signupState.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {signupState.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={signupPending}
        className="w-full rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
      >
        {signupPending ? "Vänta …" : "Skapa konto"}
      </button>

      <p className="text-center text-sm text-stone-500">
        Har du redan ett konto?{" "}
        <Link href={loginHrefWithNext(next)} className="font-medium text-stone-900 underline">
          Logga in
        </Link>
      </p>
    </form>
  );
}
