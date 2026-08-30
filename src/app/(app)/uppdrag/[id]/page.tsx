import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, CalendarDays, FileText, ReceiptText, BadgeCheck } from "lucide-react";
import { getJob, getInvoice, currentVersion, effectiveQuoteStatus, quoteStatusLabel, requireCustomer, invoiceTotals } from "@/lib/services/data";
import { signedWithBankIdBy } from "@/lib/status-labels";
import { jobAdminState } from "@/lib/services/job-admin";
import { parseJobNotes } from "@/lib/services/jobs";
import {
  actualEntries,
  jobInvoiceChoice,
  jobWorkComparison,
  quotedLaborPrefill,
  workEntryInvoiceStatus,
} from "@/lib/services/job-work";
import { kr, datumKort, datumTid } from "@/lib/format";
import { Avatar, Breadcrumbs, SectionTitle } from "@/components/ui";
import { InvoiceStatusBadge, JobStatusBadge, QuoteStatusBadge } from "@/components/status";
import { JobActions } from "@/components/job-controls";
import { JobNotes } from "@/components/job-notes";
import { JobWorkSection, type JobWorkViewEntry } from "@/components/job-work";
import { TaxReductionApplicationCard } from "@/components/tax-reduction-application";
import { taxReductionCaseForJob } from "@/lib/services/tax-reduction";
import { AppLink } from "@/components/app-link";
import { SmartBack } from "@/components/back-link";
import { invoiceHref, newQuoteHref, quoteHref } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";

export async function generateMetadata(props: PageProps<"/uppdrag/[id]">) {
  const { id } = await props.params;
  const job = getJob(id);
  return { title: job?.title ?? "Uppdrag" };
}

function toView(entry: ReturnType<typeof actualEntries>[number]): JobWorkViewEntry {
  const status = workEntryInvoiceStatus(entry);
  const invoice = entry.invoiceId ? getInvoice(entry.invoiceId) : undefined;
  return {
    id: entry.id,
    type: entry.type,
    description: entry.description,
    date: entry.date,
    qty: entry.qty,
    unit: entry.unit,
    unitPrice: entry.unitPrice,
    vatRate: entry.vatRate,
    isExtra: entry.isExtra,
    invoiceStatus: status,
    locked: status === "invoiced",
    invoiceId: entry.invoiceId,
    invoiceNumber: invoice?.number,
  };
}

export default async function UppdragPage(props: PageProps<"/uppdrag/[id]">) {
  await ensurePageBusiness();
  const { id } = await props.params;
  const job = getJob(id);
  if (!job) notFound();
  const customer = requireCustomer(job.customerId);
  const admin = jobAdminState(job);
  const { money, quote } = admin;
  const version = quote ? currentVersion(quote) : undefined;
  const invoices = money.invoices;
  const fromHere = { href: `/uppdrag/${job.id}`, label: job.title };
  const notes = parseJobNotes(job.notes);
  const taxCase = taxReductionCaseForJob(job);
  const actuals = actualEntries(job.id);
  const comparison = jobWorkComparison(job.id);
  const invoiceChoice = jobInvoiceChoice(job.id);
  const laborPrefill = quotedLaborPrefill(job.id);
  const hasEconomy = Boolean(quote) || invoices.length > 0 || money.registeredUninvoiced > 0;

  return (
    <div className="animate-fade-up">
      <div className="mb-2.5">
        <SmartBack />
      </div>
      <Breadcrumbs
        items={[
          { href: "/kunder?flik=kunder", label: "Kunder" },
          { href: "/kunder?flik=uppdrag", label: "Uppdrag" },
          { label: job.title },
        ]}
      />

      <div className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">{job.title}</h1>
        <div className="mt-2 space-y-1.5">
          <AppLink
            href={`/kunder/${customer.id}`}
            originLabel={job.title}
            className="inline-flex items-center gap-2 text-[16px] font-semibold text-ink hover:underline"
          >
            <Avatar name={customer.name} size="sm" /> {customer.name}
          </AppLink>
          {job.address ? (
            <p className="flex items-center gap-1.5 text-[14px] text-soft">
              <MapPin className="size-3.5 text-muted" /> {job.address}
            </p>
          ) : null}
          {job.startDate ? (
            <p className="flex items-center gap-1.5 text-[14px] text-muted">
              <CalendarDays className="size-3.5" />
              {datumKort(job.startDate)}
              {job.endDate ? ` – ${datumKort(job.endDate)}` : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <JobStatusBadge status={job.status} startDate={job.startDate} completedAt={job.completedAt} />
            {job.archivedAt ? <span className="text-[13px] font-medium text-muted">Arkiverat</span> : null}
          </div>
        </div>
        {admin.nextStep ? <p className="mt-2 text-[14px] text-soft">{admin.nextStep}</p> : null}
      </div>

      <div className="mb-8">
        <JobActions
          jobId={job.id}
          jobTitle={job.title}
          customerId={customer.id}
          customerName={customer.name}
          remainingAmount={admin.remaining}
          remainingLabel={admin.remaining > 0 ? kr(admin.remaining) : null}
          quoteAction={admin.quoteAction}
          invoiceAction={admin.invoiceAction}
          waitingLabel={admin.waitingLabel}
          doneLabel={admin.doneLabel}
          canMarkDone={admin.canMarkDone}
          canReopen={admin.canReopen}
          completeWarning={admin.completeWarning}
          removal={admin.removal}
          quoteHref={quote ? quoteHref(quote.id, fromHere) : "/ekonomi?flik=offerter"}
          newQuoteHref={newQuoteHref({ kund: customer.id, job: job.id, from: fromHere })}
          invoiceChoice={invoiceChoice}
          job={{
            title: job.title,
            description: job.description,
            address: job.address,
            startDate: job.startDate,
            endDate: job.endDate,
          }}
        />
      </div>

      {hasEconomy ? (
        <div className="mb-8">
          <SectionTitle>Ekonomi</SectionTitle>
          <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] tabular sm:grid-cols-2">
            {money.quoteAmount > 0 ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">Avtalat</dt>
                <dd className="font-medium text-ink">{kr(money.quoteAmount)}</dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Fakturerat</dt>
              <dd className="font-medium text-ink">{kr(money.invoicedIssued)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Betalt</dt>
              <dd className="font-medium text-ink">{kr(money.paid)}</dd>
            </div>
            {quote?.status === "godkand" ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">Kvar enligt offert</dt>
                <dd className="font-medium text-ink">{kr(admin.remaining)}</dd>
              </div>
            ) : null}
            {money.registeredUninvoiced > 0 ? (
              <div className="col-span-2 flex items-baseline justify-between gap-3 border-t border-line/60 pt-1.5">
                <dt className="text-muted">Registrerat ej fakturerat</dt>
                <dd className="font-medium text-ink">{kr(money.registeredUninvoiced)}</dd>
              </div>
            ) : null}
          </dl>
          <div className="divide-y divide-line/70 rounded-2xl border border-line/80">
            {quote && version ? (
              <Link
                href={quoteHref(quote.id, fromHere) as never}
                className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-canvas/60 first:rounded-t-[calc(1rem-1px)] last:rounded-b-[calc(1rem-1px)]"
              >
                <FileText className="mt-0.5 size-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
                  <div className="min-w-0 sm:flex-1">
                    <p className="text-[14px] font-medium">
                      Offert #{quote.number} · {kr(money.quoteAmount)}
                    </p>
                    <p className={`mt-0.5 flex items-center gap-1 text-[13px] ${quote.status === "godkand" ? "text-ok" : "text-muted"}`}>
                      {quote.status === "godkand" ? <BadgeCheck className="size-3.5 shrink-0" /> : null}
                      {admin.signatureName && admin.signatureAt
                        ? `${signedWithBankIdBy(admin.signatureName)}, ${datumTid(admin.signatureAt)}`
                        : quoteStatusLabel(quote)}
                    </p>
                  </div>
                  <div className="mt-1.5 sm:mt-0 sm:shrink-0">
                    <QuoteStatusBadge quote={quote} status={effectiveQuoteStatus(quote)} />
                  </div>
                </div>
              </Link>
            ) : null}
            {invoices.map((inv) => (
              <Link
                key={inv.id}
                href={invoiceHref(inv.id, fromHere) as never}
                className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-canvas/60 first:rounded-t-[calc(1rem-1px)] last:rounded-b-[calc(1rem-1px)]"
              >
                <ReceiptText className="size-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">
                    {inv.number == null ? "Fakturautkast" : `Faktura #${inv.number}`} · {kr(invoiceTotals(inv).toPay)}
                  </p>
                </div>
                <InvoiceStatusBadge invoice={inv} />
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <JobWorkSection
        jobId={job.id}
        jobTitle={job.title}
        comparison={comparison}
        labor={actuals.filter((e) => e.type === "labor").map(toView)}
        material={actuals.filter((e) => e.type === "material").map(toView)}
        other={actuals.filter((e) => e.type === "other").map(toView)}
        laborPrefill={laborPrefill}
        invoiceChoice={invoiceChoice}
      />

      {taxCase.phase !== "none" && taxCase.phase !== "preliminar" && taxCase.phase !== "waiting_payment" && taxCase.phase !== "waiting_work" ? (
        <div className="mb-8">
          <TaxReductionApplicationCard
            cse={taxCase}
            editHref={taxCase.invoiceId ? invoiceHref(taxCase.invoiceId, fromHere) : undefined}
          />
        </div>
      ) : null}

      <div className="mb-8">
        <JobNotes jobId={job.id} notes={notes} />
      </div>
    </div>
  );
}
