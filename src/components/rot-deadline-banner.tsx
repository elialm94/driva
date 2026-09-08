import { Card } from "./ui";
import { datumKort } from "@/lib/format";
import type { RotDeadlineStatus } from "@/lib/tax-reduction-deadline";

export function RotDeadlineBanner({ status }: { status: RotDeadlineStatus }) {
  return (
    <Card className="mb-6 border-warn/30 bg-warn-soft/40 px-5 py-4" data-rot-deadline="">
      <p className="text-[15px] font-semibold text-ink">
        {status.due ? "Sista dagen för ROT har passerat" : "Ansök om ROT senast 31 januari"}
      </p>
      <p className="mt-1 text-[14px] leading-relaxed text-soft">
        Arbete från {status.workYear} ska begäras hos Skatteverket senast {datumKort(status.deadline)}.
        {status.due
          ? " Skapa underlaget nu – efter det kan utbetalningen nekas."
          : ` ${status.daysLeft} dagar kvar.`}
      </p>
    </Card>
  );
}
