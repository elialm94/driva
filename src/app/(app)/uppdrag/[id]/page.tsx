import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, CalendarDays, FileText, ReceiptText, BadgeCheck } from "lucide-react";
import { getJob, currentVersion, effectiveQuoteStatus, quoteStatusLabel, requireCustomer, invoiceTotals } from "@/lib/services/data";
import { jobAdminState } from "@/lib/services/job-admin";
import { parseJobNotes } from "@/lib/services/jobs";
import { kr, datumKort, datumTid } from "@/lib/format";
import { Avatar, Breadcrumbs, Card, SectionTitle } from "@/components/ui";
import { InvoiceStatusBadge, JobStatusBadge, QuoteStatusBadge } from "@/components/status";
import { JobActions } from "@/components/job-controls";
import { JobNotes } from "@/components/job-notes";
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
  const hasEconomy = Boolean(quote) || invoices.length > 0;
  const taxCase = taxReductionCaseForJob(job);

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
          <div>
            <JobStatusBadge status={job.status} startDate={job.startDate} completedAt={job.completedAt} />
          </div>
        </div>

        {money.quoteAmount > 0 ? (
          <p className="mt-3 text-[15px] font-medium tabular text-ink">
            {kr(money.quoteAmount)} avtalat · {kr(money.invoiced)} fakturerat · {kr(money.paid)} betalt
          </p>
        ) : null}
        {admin.remaining > 0 ? (
          <p className="mt-1 text-[18px] font-semibold tabular tracking-tight">
            {kr(admin.remaining)} kvar att fakturera
          </p>
        ) : null}
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
          primary={admin.primary}
          secondary={admin.secondary}
          waitingLabel={admin.waitingLabel}
          doneLabel={admin.doneLabel}
          canMarkDone={admin.canMarkDone}
          quoteHref={quote ? quoteHref(quote.id, fromHere) : "/ekonomi?flik=offerter"}
          newQuoteHref={newQuoteHref({ kund: customer.id, job: job.id, from: fromHere })}
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
          {money.quoteAmount > 0 ? (
            <p className="mb-3 text-[13px] tabular text-muted">
              {kr(money.quoteAmount)} avtalat · {kr(money.invoiced)} fakturerat · {kr(money.paid)} betalt
              {admin.remaining > 0 ? ` · ${kr(admin.remaining)} kvar` : ""}
            </p>
          ) : null}
          <Card className="divide-y divide-line/70">
            {quote && version ? (
              <Link
                href={quoteHref(quote.id, fromHere) as never}
                className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-canvas/60 first:rounded-t-[calc(1.25rem-1px)] last:rounded-b-[calc(1.25rem-1px)]"
              >
                <FileText className="mt-0.5 size-4 shrink-0 text-muted" />
                {/* Mobil: statuspillret staplas under texten så raden inte kläms. */}
                <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
                  <div className="min-w-0 sm:flex-1">
                    <p className="text-[14px] font-medium">
Offert #{quote.number} · {kr(money.quoteAmount)}
                    </p>
                    <p className={`mt-0.5 flex items-center gap-1 text-[13px] ${quote.status === "godkand" ? "text-ok" : "text-muted"}`}>
                      {quote.status === "godkand" ? <BadgeCheck className="size-3.5 shrink-0" /> : null}
                      {admin.signatureName && admin.signatureAt
                        ? `Godkänd med BankID av ${admin.signatureName}, ${datumTid(admin.signatureAt)}`
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
                className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-canvas/60 first:rounded-t-[calc(1.25rem-1px)] last:rounded-b-[calc(1.25rem-1px)]"
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
          </Card>
        </div>
      ) : null}

      {taxCase.phase !== "none" && taxCase.phase !== "preliminar" && taxCase.phase !== "waiting_payment" && taxCase.phase !== "waiting_work" ? (
        <div className="mb-8">
          <TaxReductionApplicationCard
            cse={taxCase}
            editHref={taxCase.invoiceId ? invoiceHref(taxCase.invoiceId, fromHere) : undefined}
          />
        </div>
      ) : null}

      <JobNotes jobId={job.id} notes={notes} />
    </div>
  );
}
