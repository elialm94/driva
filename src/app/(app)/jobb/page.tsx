import Link from "next/link";
import { Hammer, MapPin } from "lucide-react";
import { db } from "@/lib/store";
import { datumKort, relativ } from "@/lib/format";
import { Avatar, Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { JobStatusBadge } from "@/components/status";
import type { Job } from "@/lib/types";

export const metadata = { title: "Jobb" };

function JobCard({ job }: { job: Job }) {
  const customer = db().customers.find((c) => c.id === job.customerId);
  const doneCount = job.checklist.filter((c) => c.done).length;
  return (
    <Link href={`/jobb/${job.id}` as never}>
      <Card className="flex h-full flex-col p-5 transition-all hover:-translate-y-0.5 hover:shadow-pop">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[15px] font-semibold leading-snug">{job.title}</p>
          <JobStatusBadge status={job.status} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          {customer ? <Avatar name={customer.name} size="sm" /> : null}
          <p className="text-[13px] text-soft">{customer?.name}</p>
        </div>
        <div className="mt-auto space-y-1 pt-3 text-[13px] text-muted">
          {job.address ? (
            <p className="flex items-center gap-1.5">
              <MapPin className="size-3.5" /> {job.address}
            </p>
          ) : null}
          {job.status === "kommande" && job.startDate ? <p>Startar {relativ(job.startDate)}</p> : null}
          {job.status === "pagar" && job.endDate ? <p>Planerat klart {datumKort(job.endDate)}</p> : null}
          {job.status === "klart" && job.completedAt ? <p>Klart {datumKort(job.completedAt)}</p> : null}
          {job.checklist.length > 0 && job.status !== "klart" ? (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${(doneCount / job.checklist.length) * 100}%` }}
                />
              </div>
              <span className="text-[12px] tabular">
                {doneCount}/{job.checklist.length}
              </span>
            </div>
          ) : null}
        </div>
      </Card>
    </Link>
  );
}

export default function JobsPage() {
  const jobs = db().jobs;
  const groups: { key: Job["status"]; title: string; jobs: Job[] }[] = [
    { key: "pagar", title: "Pågår", jobs: jobs.filter((j) => j.status === "pagar") },
    {
      key: "kommande",
      title: "Kommande",
      jobs: jobs
        .filter((j) => j.status === "kommande")
        .sort((a, b) => (a.startDate ?? "9").localeCompare(b.startDate ?? "9")),
    },
    {
      key: "klart",
      title: "Klara",
      jobs: jobs
        .filter((j) => j.status === "klart")
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Jobb"
        subtitle="Jobb skapas automatiskt när en offert godkänns med BankID."
      />
      {jobs.length === 0 ? (
        <EmptyState
          icon={Hammer}
          title="Inga jobb ännu"
          text="När en kund godkänner en offert med BankID dyker jobbet upp här av sig självt."
        />
      ) : (
        <div className="space-y-9">
          {groups
            .filter((g) => g.jobs.length > 0)
            .map((g) => (
              <div key={g.key}>
                <SectionTitle>
                  {g.title} · {g.jobs.length}
                </SectionTitle>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {g.jobs.map((job) => (
                    <JobCard key={job.id} job={job} />
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
