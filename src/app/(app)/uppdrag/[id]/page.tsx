import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  MapPin,
  CalendarDays,
  FileText,
  ReceiptText,
  BadgeCheck,
  Hammer,
  Banknote,
  ImageIcon,
} from "lucide-react";
import { getJob, jobQuote, currentVersion, quoteSignature, requireCustomer, invoiceTotals } from "@/lib/services/data";
import { jobMoneySummary } from "@/lib/services/attention";
import { kr, datumKort, datumTid } from "@/lib/format";
import { Avatar, Card, SectionTitle, ButtonLink } from "@/components/ui";
import { InvoiceStatusBadge, JobStatusBadge, QuoteStatusBadge } from "@/components/status";
import { Checklist, CreateInvoiceButton, JobStatusControls } from "@/components/job-controls";
import { NotesEditor } from "@/components/notes-editor";
import { updateJobNotesAction } from "@/app/actions";
import type { Quote } from "@/lib/types";

export async function generateMetadata(props: PageProps<"/uppdrag/[id]">) {
  const { id } = await props.params;
  const job = getJob(id);
  return { title: job?.title ?? "Uppdrag" };
}

function offertStatus(quote: Quote) {
  switch (quote.status) {
    case "godkand":
      return "Godkänd med BankID";
    case "skickad":
      return "Skickad, väntar på BankID";
    case "utkast":
      return "Utkast";
    case "avbojd":
      return "Avböjd";
    case "utgangen":
      return "Utgången";
  }
}

export default async function UppdragPage(props: PageProps<"/uppdrag/[id]">) {
  const { id } = await props.params;
  const job = getJob(id);
  if (!job) notFound();
  const customer = requireCustomer(job.customerId);
  const quote = jobQuote(job);
  const version = quote ? currentVersion(quote) : undefined;
  const signature = quote ? quoteSignature(quote.id) : undefined;
  const money = jobMoneySummary(job.id);
  const invoices = money.invoices;
  const doneCount = job.checklist.filter((c) => c.done).length;
  const workLabel = job.status === "pagar" ? "Pågår" : job.status === "klart" ? "Klart" : "Kommande";

  return (
    <div className="animate-fade-up">
      <Link href="/uppdrag" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Uppdrag
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
          remainingAmount={money.remaining > 0 ? kr(money.remaining) : null}
        />
      </div>

      {job.description ? (
        <Card className="mb-6 px-6 py-5">
          <p className="whitespace-pre-line text-[14px] leading-relaxed text-soft">{job.description}</p>
        </Card>
      ) : null}

      <SectionTitle>Översikt</SectionTitle>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {quote && version ? (
          <Link href={`/pengar/offerter/${quote.id}` as never}>
            <Card className="flex h-full flex-col px-5 py-4 transition-all hover:-translate-y-0.5 hover:shadow-pop">
              <div className="flex items-center gap-2 text-[13px] font-medium text-muted">
                <FileText className="size-3.5" /> Offert
              </div>
              <p className="mt-1 text-[18px] font-semibold tabular">{kr(money.quoteAmount)}</p>
              <p className={`mt-0.5 text-[13px] ${quote.status === "godkand" ? "text-ok" : "text-muted"}`}>
                {offertStatus(quote)}
              </p>
            </Card>
          </Link>
        ) : (
          <Card className="flex h-full flex-col px-5 py-4">
            <div className="flex items-center gap-2 text-[13px] font-medium text-muted">
              <FileText className="size-3.5" /> Offert
            </div>
            <p className="mt-1 text-[15px] text-soft">Ingen offert ännu</p>
          </Card>
        )}

        <Card className="flex h-full flex-col px-5 py-4">
          <div className="flex items-center gap-2 text-[13px] font-medium text-muted">
            <Hammer className="size-3.5" /> Arbete
          </div>
          <p className="mt-1 text-[18px] font-semibold">{workLabel}</p>
          <p className="mt-0.5 text-[13px] text-muted">
            {job.checklist.length > 0 ? `${doneCount} av ${job.checklist.length}` : "Ingen checklista"}
          </p>
        </Card>

        <Card className="flex h-full flex-col px-5 py-4">
          <div className="flex items-center gap-2 text-[13px] font-medium text-muted">
            <ReceiptText className="size-3.5" /> Fakturering
          </div>
          {money.quoteAmount > 0 ? (
            <>
              <p className="mt-1 text-[18px] font-semibold tabular">
                {kr(money.invoiced)} av {kr(money.quoteAmount)}
              </p>
              <p className="mt-0.5 text-[13px] text-muted">
                {money.remaining > 0 ? `${kr(money.remaining)} kvar` : "Fakturerat klart"}
              </p>
              {money.remaining > 0 ? (
                <div className="mt-3">
                  <CreateInvoiceButton jobId={job.id} size="sm" />
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-[15px] text-soft">Inget att fakturera ännu</p>
          )}
        </Card>

        <Card className="flex h-full flex-col px-5 py-4">
          <div className="flex items-center gap-2 text-[13px] font-medium text-muted">
            <Banknote className="size-3.5" /> Betalt
          </div>
          <p className="mt-1 text-[18px] font-semibold tabular">{kr(money.paid)}</p>
        </Card>
      </div>

      <div className="mb-8 flex flex-wrap gap-2">
        {!quote ? (
          <ButtonLink href={`/pengar/offerter/ny?kund=${customer.id}&job=${job.id}`}>Skapa offert</ButtonLink>
        ) : (
          <ButtonLink href={`/pengar/offerter/${quote.id}`} variant="secondary">
            Visa offert
          </ButtonLink>
        )}
      </div>

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

          <div>
            <SectionTitle>Bilder</SectionTitle>
            <Card className="flex items-start gap-3 px-5 py-4">
              <ImageIcon className="mt-0.5 size-4 shrink-0 text-muted" />
              <p className="text-[14px] text-muted">
                Inga bilder ännu. Anteckna leveranser och avvikelser ovan så länge.
              </p>
            </Card>
          </div>
        </div>

        <div className="space-y-8">
          {quote && version && signature ? (
            <div>
              <SectionTitle>Offert</SectionTitle>
              <Link href={`/pengar/offerter/${quote.id}` as never}>
                <Card className="flex items-center gap-4 px-5 py-4 transition-all hover:-translate-y-0.5 hover:shadow-pop">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-bankid-soft">
                    <FileText className="size-5 text-bankid" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium">
                      Offert #{quote.number} · {kr(money.quoteAmount)}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-[13px] text-ok">
                      <BadgeCheck className="size-3.5" />
                      Godkänd med BankID av {signature.signerName}, {datumTid(signature.signedAt)}
                    </p>
                  </div>
                  <QuoteStatusBadge quote={quote} />
                </Card>
              </Link>
            </div>
          ) : null}

          <div>
            <SectionTitle>Fakturor</SectionTitle>
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
