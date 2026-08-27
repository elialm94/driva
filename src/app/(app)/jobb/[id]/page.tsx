import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, CalendarDays, FileText, ReceiptText, BadgeCheck } from "lucide-react";
import { db } from "@/lib/store";
import { getJob, getQuote, currentVersion, quoteSignature, requireCustomer, invoiceTotals } from "@/lib/services/data";
import { remainingToInvoiceForJob } from "@/lib/services/attention";
import { kr, datumKort, datumTid } from "@/lib/format";
import { Avatar, Card, SectionTitle, Badge, ButtonLink } from "@/components/ui";
import { InvoiceStatusBadge, JobStatusBadge } from "@/components/status";
import { Checklist, JobStatusControls } from "@/components/job-controls";
import { NotesEditor } from "@/components/notes-editor";
import { updateJobNotesAction } from "@/app/actions";
import { docTotals } from "@/lib/calc";
import type { QuoteVersion } from "@/lib/types";

function quoteToPay(version: QuoteVersion): number {
  return docTotals(version.lines, version.rot).toPay;
}

export const metadata = { title: "Jobb" };

export default async function JobPage(props: PageProps<"/jobb/[id]">) {
  const { id } = await props.params;
  const job = getJob(id);
  if (!job) notFound();
  const customer = requireCustomer(job.customerId);
  const quote = job.quoteId ? getQuote(job.quoteId) : undefined;
  const version = quote ? currentVersion(quote) : undefined;
  const signature = quote ? quoteSignature(quote.id) : undefined;
  const invoices = db().invoices.filter((i) => i.jobId === job.id);
  const remaining = remainingToInvoiceForJob(job.id);

  return (
    <div className="animate-fade-up">
      <Link href="/jobb" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Jobb
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[26px] font-semibold tracking-tight">{job.title}</h1>
            <JobStatusBadge status={job.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[14px] text-soft">
            <Link href={`/kunder/${customer.id}` as never} className="flex items-center gap-2 font-medium text-ink hover:underline">
              <Avatar name={customer.name} size="sm" /> {customer.name}
            </Link>
            {job.address ? (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5 text-muted" /> {job.address}
              </span>
            ) : null}
            {job.startDate ? (
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-3.5 text-muted" />
                {datumKort(job.startDate)}
                {job.endDate ? ` – ${datumKort(job.endDate)}` : ""}
              </span>
            ) : null}
          </div>
        </div>
        <JobStatusControls
          jobId={job.id}
          status={job.status}
          customerName={customer.name}
          remainingAmount={remaining > 0 ? kr(remaining) : null}
        />
      </div>

      {job.description ? (
        <Card className="mb-6 px-6 py-5">
          <p className="whitespace-pre-line text-[14px] leading-relaxed text-soft">{job.description}</p>
        </Card>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-8">
          <div>
            <SectionTitle>Checklista</SectionTitle>
            <Card className="px-4 py-4">
              <Checklist jobId={job.id} items={job.checklist} />
            </Card>
          </div>

          <div>
            <SectionTitle>Anteckningar</SectionTitle>
            <Card className="px-5 py-4">
              <NotesEditor
                initial={job.notes}
                placeholder="Leveranser, avvikelser, saker att komma ihåg …"
                save={updateJobNotesAction.bind(null, job.id)}
              />
            </Card>
          </div>
        </div>

        <div className="space-y-8">
          {quote && version ? (
            <div>
              <SectionTitle>Offert</SectionTitle>
              <Link href={`/pengar/offerter/${quote.id}` as never}>
                <Card className="flex items-center gap-4 px-5 py-4 transition-all hover:-translate-y-0.5 hover:shadow-pop">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-bankid-soft">
                    <FileText className="size-5 text-bankid" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium">
                      Offert #{quote.number} · {kr(quoteToPay(version))}
                    </p>
                    {signature ? (
                      <p className="mt-0.5 flex items-center gap-1 text-[13px] text-ok">
                        <BadgeCheck className="size-3.5" />
                        Godkänd med BankID av {signature.signerName}, {datumTid(signature.signedAt)}
                      </p>
                    ) : null}
                  </div>
                </Card>
              </Link>
            </div>
          ) : null}

          <div>
            <SectionTitle
              right={
                remaining > 0 && job.status === "klart" ? <Badge tone="warn">{kr(remaining)} kvar att fakturera</Badge> : undefined
              }
            >
              Fakturor
            </SectionTitle>
            <Card className="divide-y divide-line/70">
              {invoices.length === 0 ? (
                <p className="px-5 py-4 text-[14px] text-muted">
                  Inget fakturerat ännu.
                  {quote && version && version.paymentPlan.length > 1
                    ? " Betalningsplanen har delbetalningar – skapa första fakturan från offerten."
                    : ""}
                </p>
              ) : (
                invoices.map((inv) => (
                  <Link
                    key={inv.id}
                    href={`/pengar/fakturor/${inv.id}` as never}
                    className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-canvas/60 first:rounded-t-[calc(1.25rem-1px)] last:rounded-b-[calc(1.25rem-1px)]"
                  >
                    <ReceiptText className="size-4 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium">Faktura #{inv.number}</p>
                      <p className="text-[13px] text-muted">{kr(invoiceTotals(inv).toPay)}</p>
                    </div>
                    <InvoiceStatusBadge invoice={inv} />
                  </Link>
                ))
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
