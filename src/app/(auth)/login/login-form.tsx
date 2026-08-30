"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type AuthFormState } from "@/app/auth-actions";
import { signupHrefWithNext } from "@/lib/auth/signup-flow";
import { FieldError, useNativeFieldErrors } from "@/components/form-validation";
import { ResendVerification } from "./resend-verification";

const initialState: AuthFormState = {};

export function LoginForm({
  next,
  defaultEmail = "",
}: {
  next: string;
  defaultEmail?: string;
  /** Behålls så parallella login-ändringar kan skicka med banner-state utan att bryta props. */
  signupSuccess?: boolean;
}) {
  const [loginState, submitLogin, loginPending] = useActionState(loginAction, initialState);
  const { errors, formProps, fieldProps } = useNativeFieldErrors({
    email: "Ange en giltig e-postadress.",
    password: "Ange ditt lösenord.",
  });

  return (
    <form action={submitLogin} className="space-y-4" {...formProps()}>
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
          defaultValue={defaultEmail}
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500"
          placeholder="du@foretaget.se"
          {...fieldProps("email", "auth-email-fel")}
        />
        <FieldError id="auth-email-fel">{errors.email}</FieldError>
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
          autoComplete="current-password"
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500"
          placeholder="Ditt lösenord"
          {...fieldProps("password", "auth-password-fel")}
        />
        <FieldError id="auth-password-fel">{errors.password}</FieldError>
      </div>

      {loginState.error ? (
        <div className="space-y-2">
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {loginState.error}
          </p>
          {loginState.needsVerification && (loginState.email || defaultEmail) ? (
            <ResendVerification
              email={loginState.email || defaultEmail}
              label="Skicka bekräftelsemejl igen"
            />
          ) : null}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loginPending}
        className="w-full rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
      >
        {loginPending ? "Vänta …" : "Logga in"}
      </button>

      <p className="text-center text-sm text-stone-500">
        Har du inget konto?{" "}
        <Link href={signupHrefWithNext(next)} className="font-medium text-stone-900 underline">
          Skapa konto
        </Link>
      </p>
    </form>
  );
}
