import Link from "next/link";
import { FileDiff, Plus } from "lucide-react";
import type { JobChange } from "@/lib/types";
import { docTotals } from "@/lib/calc";
import { kr, datumKort } from "@/lib/format";
import { jobChangeStatusLabel, jobChangeStatusTone } from "@/lib/services/job-changes";
import { Badge, SectionTitle, buttonClasses } from "./ui";

/**
 * "Ändringar och tillägg" på uppdraget. Visar gällande versioner (ersatta
 * göms bakom en rad) med status och belopp; ny ändring är en egen sida.
 */
export function JobChangesSection({ jobId, changes }: { jobId: string; changes: JobChange[] }) {
  const current = changes.filter((c) => c.status !== "ersatt");
  const superseded = changes.length - current.length;
  const newHref = `/uppdrag/${jobId}/andringar/ny`;
  const approvedTotal = current
    .filter((c) => c.status === "godkand")
    .reduce((s, c) => s + docTotals(c.lines, null).total, 0);

  return (
    <div className="mb-8" data-testid="job-changes-section">
      <SectionTitle
        right={
          <Link href={newHref as never} className={buttonClasses("secondary", "sm")} data-testid="job-change-new">
            <Plus className="size-3.5" /> Ny ändring
          </Link>
        }
      >
        Ändringar och tillägg
      </SectionTitle>
      {current.length === 0 ? (
        <p className="text-[14px] text-soft">
          Inga ändringar ännu. Blev det något utöver offerten? Skriv upp det här så kunden kan godkänna innan du fakturerar.
        </p>
      ) : (
        <>
          <div className="divide-y divide-line/70 rounded-2xl border border-line/80">
            {current.map((c) => {
              const t = docTotals(c.lines, null);
              return (
                <Link
                  key={c.id}
                  href={`/uppdrag/${jobId}/andringar/${c.id}` as never}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-canvas/60 first:rounded-t-[calc(1rem-1px)] last:rounded-b-[calc(1rem-1px)]"
                  data-testid="job-change-row"
                >
                  <FileDiff className="size-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">
                      Ändring {c.number}
                      {c.version > 1 ? ` v${c.version}` : ""} · {c.title}
                    </p>
                    <p className="text-[13px] text-muted">
                      {kr(t.total)} inkl. moms · {datumKort(c.sentAt ?? c.createdAt)}
                    </p>
                  </div>
                  <Badge tone={jobChangeStatusTone(c)}>{jobChangeStatusLabel(c)}</Badge>
                </Link>
              );
            })}
          </div>
          <p className="mt-2 text-[13px] text-muted">
            {approvedTotal !== 0 ? `Godkända tillägg: ${kr(approvedTotal)} inkl. moms.` : null}
            {superseded > 0 ? ` ${superseded} äldre ${superseded === 1 ? "version" : "versioner"} ersatt.` : null}
          </p>
        </>
      )}
    </div>
  );
}
