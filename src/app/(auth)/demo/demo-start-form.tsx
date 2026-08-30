"use client";

import { useActionState } from "react";
import { startDemoAction, type DemoStartState } from "@/app/demo-actions";

const initialState: DemoStartState = {};

export function DemoStartForm() {
  const [state, submit, pending] = useActionState(startDemoAction, initialState);
  return (
    <form action={submit} className="space-y-3">
      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-stone-900 px-4 py-3.5 text-base font-semibold text-white hover:bg-stone-800 disabled:opacity-60"
      >
        {pending ? "Öppnar demo …" : "Öppna demo"}
      </button>
    </form>
  );
}
