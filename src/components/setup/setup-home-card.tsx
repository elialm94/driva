import { Sparkles } from "lucide-react";
import type { SetupSummary } from "@/lib/setup/tasks";
import { SETTINGS_HREF } from "@/lib/settings-routes";
import { AppLink } from "../app-link";
import { Card } from "../ui";
import { SetupTaskRow } from "./setup-task-list";

/** Så många rekommenderade uppgifter visas på Hem – resten under Inställningar → Kom igång. */
const HOME_TASKS = 3;

/**
 * "Gör Ferva redo" på Hem: den mest värdefulla uppgiften tydligast, aldrig en
 * blockerande wizard. Renderas bara när rekommenderade uppgifter återstår.
 */
export function SetupHomeCard({ summary }: { summary: SetupSummary }) {
  if (!summary.showHomeCard) return null;
  const shown = summary.open.slice(0, HOME_TASKS);
  const remaining = summary.open.length - shown.length;
  const doneCount = summary.done.length;
  const total = summary.tasks.filter((t) => t.relevance === "recommended").length;
  return (
    <Card className="mt-8 overflow-hidden" data-setup-home-card>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-deep">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="text-[16px] font-semibold text-ink">Gör Ferva redo</p>
            <p className="mt-0.5 text-[13px] text-soft">
              {doneCount > 0 ? `${doneCount} av ${total} klart. ` : ""}
              Börja där det ger mest – resten kan vänta.
            </p>
          </div>
        </div>
        <AppLink href={SETTINGS_HREF.komIgang} originLabel="Hem" className="text-[13px] font-medium text-accent hover:underline">
          Alla steg
        </AppLink>
      </div>
      <ul className="mt-3 divide-y divide-line/70 border-t border-line/70">
        {shown.map((task) => (
          <SetupTaskRow key={task.id} task={task} variant="compact" originLabel="Hem" />
        ))}
      </ul>
      {remaining > 0 ? (
        <div className="border-t border-line/70 px-5 py-2.5 text-[13px] text-muted">
          <AppLink href={SETTINGS_HREF.komIgang} originLabel="Hem" className="hover:text-ink">
            {remaining} {remaining === 1 ? "steg till" : "steg till"} under Kom igång
          </AppLink>
        </div>
      ) : null}
    </Card>
  );
}
