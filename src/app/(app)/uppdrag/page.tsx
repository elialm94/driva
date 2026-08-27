import Link from "next/link";
import { Hammer, MapPin } from "lucide-react";
import { db } from "@/lib/store";
import { datumKort, kr, relativ } from "@/lib/format";
import { jobMoneySummary } from "@/lib/services/attention";
import { Avatar, Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { JobStatusBadge } from "@/components/status";
import { NewUppdragButton } from "@/components/uppdrag-form";
import type { Job } from "@/lib/types";

export const metadata = { title: "Uppdrag" };

function quoteFact(status: string | undefined) {
  if (status === "godkand") return "Offert godkänd";
  if (status === "skickad") return "Offert skickad";
  if (status === "utkast") return "Offertutkast";
  return null;
}

function UppdragCard({ job }: { job: Job }) {
  const customer = db().customers.find((c) => c.id === job.customerId);
  const money = jobMoneySummary(job.id);
  const secondary = [
    quoteFact(money.quote?.status),
    money.invoiced > 0 ? `${kr(money.invoiced)} fakturerat` : null,
    money.remaining > 0 && money.invoiced > 0 ? `${kr(money.remaining)} kvar` : null,
  ].filter(Boolean);

  return (
    <Link href={`/uppdrag/${job.id}` as never}>
      <Card className="flex h-full flex-col p-5 transition-all hover:-translate-y-0.5 hover:shadow-pop">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[15px] font-semibold leading-snug">{job.title}</p>
          <JobStatusBadge status={job.status} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          {customer ? <Avatar name={customer.name} size="sm" /> : null}
          <p className="text-[13px] text-soft">{customer?.name}</p>
        </div>
        {money.quoteAmount > 0 ? (
          <p className="mt-2 text-[15px] font-semibold tabular">{kr(money.quoteAmount)}</p>
        ) : null}
        <div className="mt-auto space-y-1 pt-3 text-[13px] text-muted">
          {job.address ? (
            <p className="flex items-center gap-1.5">
              <MapPin className="size-3.5" /> {job.address}
            </p>
          ) : null}
          {job.status === "kommande" && job.startDate ? <p>Startar {relativ(job.startDate)}</p> : null}
          {job.status === "pagar" && job.endDate ? <p>Planerat klart {datumKort(job.endDate)}</p> : null}
          {job.status === "klart" && job.completedAt ? <p>Klart {datumKort(job.completedAt)}</p> : null}
          {secondary.length > 0 ? <p className="text-[12px]">{secondary.join(" · ")}</p> : null}
        </div>
      </Card>
    </Link>
  );
}

export default function UppdragPage() {
  const data = db();
  const jobs = data.jobs;
  const customers = [...data.customers]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((c) => ({ id: c.id, name: c.name }));
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
      title: "Klart",
      jobs: jobs
        .filter((j) => j.status === "klart")
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Uppdrag"
        subtitle="Allt kring kunden – offert, arbete, faktura och betalning – på ett ställe."
        actions={customers.length > 0 ? <NewUppdragButton customers={customers} /> : undefined}
      />
      {jobs.length === 0 ? (
        <EmptyState
          icon={Hammer}
          title="Inga uppdrag ännu"
          text="När en kund godkänner en offert med BankID dyker uppdraget upp här. Du kan också skapa ett själv."
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
                    <UppdragCard key={job.id} job={job} />
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
