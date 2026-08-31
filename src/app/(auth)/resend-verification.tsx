"use client";

import { useActionState } from "react";
import { resendVerificationAction, type AuthFormState } from "@/app/auth-actions";

const initialState: AuthFormState = {};

export function ResendVerification({
  email,
  label,
  next,
}: {
  email: string;
  label: string;
  /** Bevaras genom bekräftelselänken (t.ex. inbjudan). */
  next?: string;
}) {
  const [state, submit, pending] = useActionState(resendVerificationAction, initialState);

  return (
    <form action={submit} className="space-y-2">
      <input type="hidden" name="email" value={email} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <button
        type="submit"
        disabled={pending || !email}
        className="text-sm font-medium text-stone-900 underline disabled:opacity-60"
      >
        {pending ? "Skickar …" : label}
      </button>
      {state.notice ? (
        <p role="status" className="text-sm text-emerald-800">
          {state.notice}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
