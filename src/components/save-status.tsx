"use client";

import { autosaveStatusText, type AutosaveState, type AutosaveStatus } from "@/lib/autosave";
import { cx } from "./ui";

export function SaveStatus({
  state,
  onRetry,
  className,
}: {
  state: AutosaveState;
  onRetry?: () => void;
  className?: string;
}) {
  const text = autosaveStatusText(state);
  const error = state.status === "error";

  return (
    <span
      className={cx("inline-flex min-h-5 items-center justify-end gap-2 text-right text-[12px]", className)}
      aria-live="polite"
      data-save-status={state.status}
    >
      {text ? (
        <>
          <span
            className={
              error ? "font-medium text-danger" : state.status === "saved" ? "font-medium text-ok" : "text-muted"
            }
          >
            {text}
          </span>
          {error && onRetry ? (
            <button type="button" className="font-medium text-accent hover:text-accent-deep" onClick={onRetry}>
              Försök igen
            </button>
          ) : null}
        </>
      ) : null}
    </span>
  );
}

/** Kompatibel alias för äldre anrop med separat status/error. */
export function SaveHint({
  status,
  error,
  onRetry,
}: {
  status: AutosaveStatus;
  error: string | null;
  onRetry: () => void;
}) {
  return <SaveStatus state={{ status, error }} onRetry={onRetry} />;
}
