"use client";

import { useActionState, useState } from "react";
import { loginAction, signupAction, type AuthFormState } from "@/app/auth-actions";

const initialState: AuthFormState = {};

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loginState, submitLogin, loginPending] = useActionState(loginAction, initialState);
  const [signupState, submitSignup, signupPending] = useActionState(signupAction, initialState);

  const state = mode === "login" ? loginState : signupState;
  const pending = mode === "login" ? loginPending : signupPending;

  return (
    <form action={mode === "login" ? submitLogin : submitSignup} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="auth-email" className="block text-sm font-medium text-stone-700">
          E-post
        </label>
        <input
          id="auth-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500"
          placeholder="du@foretaget.se"
        />
      </div>
      <div>
        <label htmlFor="auth-password" className="block text-sm font-medium text-stone-700">
          Lösenord
        </label>
        <input
          id="auth-password"
          name="password"
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500"
          placeholder={mode === "signup" ? "Minst 8 tecken" : "Ditt lösenord"}
        />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {state.notice}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
      >
        {pending ? "Vänta …" : mode === "login" ? "Logga in" : "Skapa konto"}
      </button>

      <p className="text-center text-sm text-stone-500">
        {mode === "login" ? (
          <>
            Ny på Driva?{" "}
            <button type="button" className="font-medium text-stone-900 underline" onClick={() => setMode("signup")}>
              Skapa konto
            </button>
          </>
        ) : (
          <>
            Har du redan ett konto?{" "}
            <button type="button" className="font-medium text-stone-900 underline" onClick={() => setMode("login")}>
              Logga in
            </button>
          </>
        )}
      </p>
    </form>
  );
}
