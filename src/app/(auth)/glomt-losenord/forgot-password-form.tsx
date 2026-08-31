"use client";

import { useActionState } from "react";
import { requestPasswordResetAction, type AuthFormState } from "@/app/auth-actions";
import { FieldError, useNativeFieldErrors } from "@/components/form-validation";

const initialState: AuthFormState = {};

export function ForgotPasswordForm() {
  const [state, submit, pending] = useActionState(requestPasswordResetAction, initialState);
  const { errors, formProps, fieldProps } = useNativeFieldErrors({
    email: "Ange en giltig e-postadress.",
  });

  return (
    <form action={submit} className="space-y-4" {...formProps()}>
      <div>
        <label htmlFor="reset-email" className="block text-sm font-medium text-stone-700">
          E-post
        </label>
        <input
          id="reset-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={state.email ?? ""}
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500"
          placeholder="du@foretaget.se"
          {...fieldProps("email", "reset-email-fel")}
        />
        <FieldError id="reset-email-fel">{errors.email}</FieldError>
      </div>

      {state.notice ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.notice}
        </p>
      ) : null}
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
        {pending ? "Skickar …" : "Skicka återställningslänk"}
      </button>
    </form>
  );
}
