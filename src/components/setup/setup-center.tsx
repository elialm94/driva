import { FileUp } from "lucide-react";
import type { SetupSummary } from "@/lib/setup/tasks";
import { IMPORT_HREF } from "@/lib/setup/routes";
import type { DataImport, OnboardingState } from "@/lib/types";
import { datumTid } from "@/lib/format";
import { AppLink } from "../app-link";
import { Badge, Card, buttonClasses } from "../ui";
import { SetupProfileForm } from "./setup-profile-form";
import { SetupTaskRow } from "./setup-task-list";

const KIND_LABEL: Record<DataImport["kind"], string> = {
  bokforing: "Bokföring",
  kunder: "Kunder",
  leverantorer: "Leverantörer",
  artiklar: "Artiklar och priser",
};

/**
 * Inställningar → Kom igång: profil, återstående/uppskjutna/bortvalda
 * uppgifter, genomförda importer och möjlighet att ladda upp fler filer.
 * Permanent åtkomlig – även när Hem-kortet är borta.
 */
export function SetupCenter({
  summary,
  onboarding,
  imports,
}: {
  summary: SetupSummary;
  onboarding: OnboardingState | null;
  imports: DataImport[];
}) {
  const origin = "Kom igång";
  const allDone = summary.open.length === 0;
  return (
    <div className="space-y-5" data-setup-center>
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Kom igång</p>
            <p className="mt-1 max-w-xl text-[14px] leading-relaxed text-soft">
              {allDone
                ? "Allt som behövs är på plats. Här kan du alltid ladda upp fler filer eller ta upp något du sköt på."
                : `${summary.done.length} av ${summary.tasks.filter((t) => t.relevance === "recommended").length} rekommenderade steg är klara. Du kan lämna och fortsätta när som helst.`}
            </p>
          </div>
          <AppLink href={IMPORT_HREF} originLabel={origin} className={buttonClasses("primary", "sm")} data-setup-import-link>
            <FileUp className="size-3.5" /> Ladda upp filer
          </AppLink>
        </div>
      </Card>

      <Card className="p-6">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Företagets profil</p>
        <p className="mt-1 mb-4 text-[13px] text-soft">Styr vad vi föreslår – aldrig vad du kan göra.</p>
        <SetupProfileForm
          profile={{
            industries: onboarding?.industries ?? [],
            otherIndustry: onboarding?.otherIndustry,
            payroll: onboarding?.payroll ?? null,
            bookkeeping: onboarding?.bookkeeping ?? null,
          }}
        />
      </Card>

      {summary.open.length > 0 ? (
        <TaskCard title="Att göra" tasks={summary.open} origin={origin} />
      ) : null}
      {summary.optional.length > 0 ? (
        <TaskCard title="Fler saker du kan göra" tasks={summary.optional} origin={origin} />
      ) : null}
      {summary.deferred.length > 0 ? (
        <TaskCard title="Gör senare" tasks={summary.deferred} origin={origin} />
      ) : null}
      {summary.dismissed.length > 0 ? (
        <TaskCard title="Behövs inte" tasks={summary.dismissed} origin={origin} />
      ) : null}
      {summary.done.length > 0 ? <TaskCard title="Klart" tasks={summary.done} origin={origin} /> : null}

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Genomförda importer</p>
            <p className="mt-1 text-[13px] text-soft">
              {imports.length === 0 ? "Inga filer har importerats ännu." : "Samma fil importeras aldrig två gånger av misstag."}
            </p>
          </div>
        </div>
        {imports.length > 0 ? (
          <ul className="mt-4 divide-y divide-line/70 rounded-2xl border border-line/80" data-setup-imports>
            {imports
              .slice()
              .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt))
              .map((imp) => (
                <li key={imp.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-ink">
                      {KIND_LABEL[imp.kind]} · {imp.filename}
                    </p>
                    <p className="text-[13px] text-soft">
                      {imp.status === "imported" ? imp.summary : imp.error ?? "Misslyckades"} · {datumTid(imp.completedAt ?? imp.createdAt)}
                    </p>
                    {imp.warnings.length > 0 ? (
                      <p className="text-[12.5px] text-muted">
                        {imp.warnings.length} {imp.warnings.length === 1 ? "anmärkning" : "anmärkningar"}
                      </p>
                    ) : null}
                  </div>
                  <Badge tone={imp.status === "imported" ? "ok" : "danger"}>{imp.status === "imported" ? "Importerad" : "Misslyckades"}</Badge>
                </li>
              ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}

function TaskCard({ title, tasks, origin }: { title: string; tasks: SetupSummary["tasks"]; origin: string }) {
  return (
    <Card className="overflow-hidden">
      <p className="px-5 pt-5 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</p>
      <ul className="mt-2 divide-y divide-line/70 border-t border-line/70">
        {tasks.map((task) => (
          <SetupTaskRow key={task.id} task={task} originLabel={origin} />
        ))}
      </ul>
    </Card>
  );
}
