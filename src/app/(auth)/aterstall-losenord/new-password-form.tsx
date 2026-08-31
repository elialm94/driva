"use client";

import { useActionState } from "react";
import { updatePasswordAction, type AuthFormState } from "@/app/auth-actions";
import { FieldError, useNativeFieldErrors } from "@/components/form-validation";

const initialState: AuthFormState = {};

export function NewPasswordForm() {
  const [state, submit, pending] = useActionState(updatePasswordAction, initialState);
  const { errors, formProps, fieldProps } = useNativeFieldErrors({
    password: "Lösenordet behöver minst 8 tecken.",
  });

  return (
    <form action={submit} className="space-y-4" {...formProps()}>
      <div>
        <label htmlFor="new-password" className="block text-sm font-medium text-stone-700">
          Nytt lösenord
        </label>
        <input
          id="new-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500"
          placeholder="Minst 8 tecken"
          {...fieldProps("password", "new-password-fel")}
        />
        <FieldError id="new-password-fel">{errors.password}</FieldError>
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
        {pending ? "Sparar …" : "Spara nytt lösenord"}
      </button>
    </form>
  );
}
