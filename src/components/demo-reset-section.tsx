"use client";

import { useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { buttonClasses, Card } from "./ui";
import { resetDemoAction } from "@/app/actions";

/**
 * Demo-/utvecklingssektion på Inställningar-sidan (flyttad hit från
 * sidofältets fot). Servergrindad i installningar/page.tsx till JSON-läget –
 * samma villkor som resetDemoData själv kräver (assertJsonMode), så
 * produktionsanvändare ser den aldrig.
 */
export function DemoResetSection() {
  const [isResetting, startReset] = useTransition();
  return (
    <section aria-labelledby="demo-sektion-rubrik" className="mt-10">
      <h2
        id="demo-sektion-rubrik"
        className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted"
      >
        Demo &amp; utveckling
      </h2>
      <Card className="mt-3 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-[14px] font-medium text-ink">Återställ demodata</p>
          <p className="text-[13px] text-muted">
            Ersätter kunder, offerter, fakturor och bokföringsposter med exempeldatat.
          </p>
        </div>
        <button
          type="button"
          className={buttonClasses("secondary", "sm")}
          disabled={isResetting}
          onClick={() => {
            if (
              !window.confirm(
                "Återställa demodata? Alla kunder, offerter, fakturor och bokföringsposter ersätts med exempeldatat. Detta går inte att ångra."
              )
            )
              return;
            startReset(async () => resetDemoAction());
          }}
        >
          <RotateCcw className="size-3.5" />
          {isResetting ? "Återställer …" : "Återställ demodata"}
        </button>
      </Card>
    </section>
  );
}
