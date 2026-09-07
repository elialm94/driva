"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { ButtonLink, buttonClasses } from "@/components/ui";

/**
 * Segmentgräns för (app): kraschar en sida stannar sidomenyn och bottennavet
 * kvar, så användaren kan gå vidare till en annan del av appen i stället för
 * att stå med en tom skärm. Rotens error.tsx tar bara fel i layouten själv.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg pt-10">
      <div className="card flex flex-col items-center px-8 py-14 text-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-warn-soft">
          <AlertTriangle className="size-6 text-warn" />
        </div>
        <p className="text-[16px] font-semibold text-ink">Sidan kunde inte visas</p>
        <p className="mt-1 max-w-sm text-sm text-soft">
          Något gick fel när innehållet hämtades. Ingenting har gått förlorat – försök igen, eller gå vidare till en
          annan del av appen.
        </p>
        {error.digest ? <p className="mt-3 font-mono text-[11px] text-muted">{error.digest}</p> : null}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => retry()} className={buttonClasses("primary", "md")}>
            Försök igen
          </button>
          <ButtonLink href="/" variant="secondary">
            Till Hem
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
