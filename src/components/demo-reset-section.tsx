"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { buttonClasses, Card } from "./ui";
import { resetDemoAction } from "@/app/actions";

/**
 * Demo-sektion på Inställningar-sidan. Servergrindad i installningar/page.tsx:
 * JSON-läget (lokal utveckling) eller den publika demosessionen – riktiga
 * produktionsanvändare ser den aldrig, och servervägen vägrar dessutom för
 * alla företag som inte skapades som demo.
 */
export function DemoResetSection() {
  const [isResetting, startReset] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-labelledby="demo-sektion-rubrik" className="mt-10">
      <h2
        id="demo-sektion-rubrik"
        className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted"
      >
        Demo
      </h2>
      <Card className="mt-3 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-[14px] font-medium text-ink">Återställ demo</p>
          <p className="text-[13px] text-muted">
            Alla ändringar du gjort i demon återställs till exempeldatat.
          </p>
          {error ? (
            <p role="alert" className="mt-1 text-[13px] text-red-700">
              {error}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className={buttonClasses("secondary", "sm")}
          disabled={isResetting}
          onClick={() => {
            if (
              !window.confirm(
                "Återställ demo? Alla ändringar du gjort i demon återställs till exempeldatat. Detta går inte att ångra."
              )
            )
              return;
            setError(null);
            startReset(async () => {
              const result = await resetDemoAction();
              if (!result.ok) setError(result.error);
            });
          }}
        >
          <RotateCcw className="size-3.5" />
          {isResetting ? "Återställer …" : "Återställ demo"}
        </button>
      </Card>
    </section>
  );
}
