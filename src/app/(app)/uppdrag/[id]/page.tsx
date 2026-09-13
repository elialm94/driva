import { notFound } from "next/navigation";
import { MapPin, Inbox, Mail, Phone } from "lucide-react";
import { getJob, getInvoice, effectiveQuoteStatus, invoiceTotals, requireCustomer } from "@/lib/services/data";
import { jobAdminState } from "@/lib/services/job-admin";
import { isIncomingUnquotedJob, jobSourceLabel, parseJobNotes } from "@/lib/services/jobs";
import {
  actualEntries,
  jobInvoiceChoice,
  quotedLaborPrefill,
  workEntryInvoiceStatus,
} from "@/lib/services/job-work";
import { kr, datumTid } from "@/lib/format";
import { Avatar, Breadcrumbs, Card, SectionTitle } from "@/components/ui";
import { JobStatusBadge } from "@/components/status";
import { JobActions } from "@/components/job-controls";
import { JobEconomyDocs } from "@/components/job-economy-docs";
import { JobNotes } from "@/components/job-notes";
import { JobWorkSection, type JobWorkViewEntry } from "@/components/job-work";
import { PurchaseOrdersSection } from "@/components/purchase-orders-section";
import { jobPurchaseOrderRows, jobWholesalerContext } from "@/lib/services/job-wholesalers";
import { TaxReductionApplicationCard } from "@/components/tax-reduction-application";
import { getJobChange } from "@/lib/services/job-changes";
import { closeoutView } from "@/lib/services/closeout";
import { RotDeadlineBanner } from "@/components/rot-deadline-banner";
import { taxReductionCaseForJob, taxReductionCaseView } from "@/lib/services/tax-reduction";
import { rotDeadlineStatus } from "@/lib/tax-reduction-deadline";
import { todayDate } from "@/lib/accounting/dates";
import { husExportPreview } from "@/lib/services/hus-export";
import { getInvoiceDefaults } from "@/lib/services/settings";
import { AppLink } from "@/components/app-link";
import { SmartBack } from "@/components/back-link";
import { invoiceHref, newQuoteHref, pageOrigin, quoteHref } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";
import { inboundAddressForBusiness } from "@/lib/services/inbox";
import { invoiceReadiness } from "@/lib/services/invoice-readiness";

export async function generateMetadata(props: PageProps<"/uppdrag/[id]">) {
  // Metadata renderas före sidkroppen: tenantstate (Supabase/demosession)
  // måste laddas här också – cache() deduperar mot sidans anrop.
  await ensurePageBusiness();
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
    invoiceAmount: invoice ? invoiceTotals(invoice).toPay : undefined,
    invoiceTitle: invoice?.lines[0]?.description,
    ...(entry.changeId ? { changeLabel: changeLabelFor(entry.changeId) } : {}),
  };
}

function changeLabelFor(changeId: string): string {
  const change = getJobChange(changeId);
  return change ? `Ändring ${change.number}` : "Ändring";
}

export default async function UppdragPage(props: PageProps<"/uppdrag/[id]">) {
  await ensurePageBusiness();
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const job = getJob(id);
  if (!job) notFound();
  const customer = requireCustomer(job.customerId);
  const admin = jobAdminState(job);
  const { money, quote } = admin;
  const invoices = money.invoices;
  const fromHere = pageOrigin(`/uppdrag/${job.id}`, searchParams, job.title);
  const notes = parseJobNotes(job.notes);
  const taxCase = taxReductionCaseForJob(job);
  const husExport = taxCase.phase === "underlag" ? husExportPreview({ jobId: job.id }) : null;
  const actuals = actualEntries(job.id);
  const invoiceChoice = jobInvoiceChoice(job.id);
  const laborPrefill = quotedLaborPrefill(job.id);
  const hasEconomy = Boolean(quote) || invoices.length > 0 || money.registeredUninvoiced > 0;
  // Grossistbeställningar: avstängd funktion = materialytan ser ut som idag.
  const wholesalers = jobWholesalerContext(job.id);
  const purchaseOrderRows = jobPurchaseOrderRows(job.id);
  const incoming = isIncomingUnquotedJob(job);
  const sourceLabel = jobSourceLabel(job.source);
  const message = job.originalMessage?.trim() || "";
  // Beskrivningen visas bara när den säger något mer än rubriken/meddelandet.
  const description = job.description.trim();
  const showDescription = description.length > 0 && description !== message && description !== job.title;
  const newQuote = newQuoteHref({ kund: customer.id, job: job.id, from: fromHere });

  return (
    <div className="animate-fade-up">
      <div className="mb-2.5">
        <SmartBack />
      </div>
      <Breadcrumbs
        items={[{ href: "/uppdrag", label: "Uppdrag" }, { label: job.title }]}
      />

      {/* Rubrik och huvudknapp på samma rad: sidan ska rymmas på en skärm. */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-tight">{job.title}</h1>
          {/* Beskrivningen är en underrubrik, inte en egen sektion. */}
          {showDescription ? (
            <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-soft">{description}</p>
          ) : null}
          <div className="mt-2 space-y-1.5">
            {/* Kund och status på samma rad - uppdraget ska rymmas på en skärm. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <AppLink
                href={`/kunder/${customer.id}`}
                originLabel={job.title}
                className="inline-flex items-center gap-2 text-[16px] font-semibold text-ink hover:underline"
              >
                <Avatar name={customer.name} size="sm" /> {customer.name}
              </AppLink>
              <JobStatusBadge status={job.status} startDate={job.startDate} completedAt={job.completedAt} />
              {job.archivedAt ? <span className="text-[13px] font-medium text-muted">Arkiverat</span> : null}
            </div>
            {job.address ? (
              <p className="flex items-center gap-1.5 text-[14px] text-soft">
                <MapPin className="size-3.5 text-muted" /> {job.address}
              </p>
            ) : null}
          </div>
          {admin.nextStep ? <p className="mt-2 text-[14px] text-soft">{admin.nextStep}</p> : null}
        </div>
        <div className="shrink-0">
          <JobActions
            jobId={job.id}
            jobTitle={job.title}
            customerId={customer.id}
            customerName={customer.name}
            remainingAmount={admin.remaining}
            remainingLabel={admin.remaining > 0 ? kr(admin.remaining) : null}
            quoteAction={admin.quoteAction}
            invoiceAction={admin.invoiceAction}
            hasBillable={admin.hasBillable}
            canMarkDone={admin.canMarkDone}
            canReopen={admin.canReopen}
            completeWarning={admin.completeWarning}
            removal={admin.removal}
            quoteHref={quote ? quoteHref(quote.id, fromHere) : "/ekonomi?flik=offerter"}
            newQuoteHref={newQuote}
            invoiceChoice={invoiceChoice}
            closeout={closeoutView(job.id)}
            photos={job.photos ?? []}
            job={{
              title: job.title,
              description: job.description,
              address: job.address,
            }}
          />
        </div>
      </div>

      {message ? (
        <Card
          className={
            incoming ? "mb-6 border-accent/30 bg-accent-soft/20 px-6 py-5" : "mb-6 px-6 py-5"
          }
          data-testid="job-incoming-message"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="flex items-center gap-2">
              <Inbox className="size-4 text-accent" />
              <h2 className="text-[15px] font-semibold">{incoming ? "Ny förfrågan från kunden" : "Kundens förfrågan"}</h2>
            </div>
            <p className="text-[13px] text-muted">
              {[sourceLabel, datumTid(job.createdAt)].filter(Boolean).join(" · ")}
            </p>
          </div>
          <blockquote className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ink">{message}</blockquote>
          {customer.email || customer.phone ? (
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
              {customer.phone ? (
                <a href={`tel:${customer.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 text-soft hover:text-ink">
                  <Phone className="size-3.5 text-muted" /> {customer.phone}
                </a>
              ) : null}
              {customer.email ? (
                <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-1.5 text-soft hover:text-ink">
                  <Mail className="size-3.5 text-muted" /> {customer.email}
                </a>
              ) : null}
            </div>
          ) : null}
          {/* Huvudknappen i sidhuvudet är "Skapa offert" här - kortet upprepar den inte. */}
          {incoming ? (
            <p className="mt-3 text-[12px] text-muted">Meddelandet följer med som beskrivning i offerten.</p>
          ) : null}
        </Card>
      ) : null}

      {hasEconomy ? (
        <div className="mb-6">
          <SectionTitle>Ekonomi</SectionTitle>
          {/* Avtalat = godkänd offert. Fakturerat = utfärdat. Kvar = avtalat minus
              utfärdat. Registrerat/Betalt hör inte hemma i den här listen. */}
          <dl className="mb-3 grid grid-cols-3 gap-x-4 gap-y-1.5 text-[13px] tabular">
            <div>
              <dt className="text-muted">Avtalat</dt>
              <dd className="text-[17px] font-semibold text-ink" data-job-avtalat={money.quoteAmount}>
                {kr(money.quoteAmount)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Fakturerat</dt>
              <dd className="text-[17px] font-semibold text-ink">{kr(money.invoicedIssued)}</dd>
            </div>
            <div>
              <dt className="text-muted">Kvar</dt>
              <dd className="text-[17px] font-semibold text-ink" data-job-kvar={admin.remaining}>
                {kr(admin.remaining)}
              </dd>
            </div>
            {money.cost > 0 ? (
              <div className="col-span-3 mt-0.5 flex flex-wrap gap-x-5 gap-y-1 border-t border-line/60 pt-1.5 text-muted">
                <span>
                  Inköp <span className="font-medium text-soft">{kr(money.cost)}</span>
                </span>
                <span>
                  Täckning{" "}
                  <span className={money.profit >= 0 ? "font-medium text-ok" : "font-medium text-danger"}>
                    {kr(money.profit)}
                  </span>
                </span>
              </div>
            ) : null}
          </dl>
          <JobEconomyDocs
            quote={quote}
            quoteAmount={money.quoteDocumentAmount}
            quoteStatus={quote ? effectiveQuoteStatus(quote) : undefined}
            acceptance={admin.acceptance}
            quoteHref={quote ? (quoteHref(quote.id, fromHere) as string) : "/ekonomi?flik=offerter"}
            invoices={invoices}
            invoiceHref={(id) => invoiceHref(id, fromHere) as string}
            returnTo={`/uppdrag/${job.id}`}
          />
        </div>
      ) : null}

      {(() => {
        const deadline = rotDeadlineStatus({
          today: todayDate(),
          workEndDate: job.endDate ?? job.completedAt,
          paidAt: invoices.find((i) => i.rot && i.paidAt)?.paidAt,
          applied: Boolean(job.taxReductionApplication && job.taxReductionApplication.status !== "preliminar" && job.taxReductionApplication.status !== "redo_att_ansokas"),
        });
        return deadline && job.taxReductionApplication ? <RotDeadlineBanner status={deadline} /> : null;
      })()}

      {/* purchaseRef läses bara här. Tilldelning: ensureJobPurchaseRefAction (skrivkontext). */}
      <JobWorkSection
        jobId={job.id}
        jobTitle={job.title}
        entries={actuals.map(toView)}
        laborPrefill={laborPrefill}
        defaultHourlyRate={getInvoiceDefaults().defaultHourlyRate}
        wholesalers={wholesalers.enabled ? wholesalers : undefined}
        purchaseRef={job.purchaseRef}
        inboxAddress={inboundAddressForBusiness()}
        invoiceReadiness={invoiceReadiness(job.id)}
      />

      <PurchaseOrdersSection jobId={job.id} jobTitle={job.title} rows={purchaseOrderRows} />

      {taxCase.phase !== "none" && taxCase.phase !== "preliminar" && taxCase.phase !== "waiting_payment" && taxCase.phase !== "waiting_work" ? (
        <div className="mb-6">
          <TaxReductionApplicationCard
            cse={taxReductionCaseView(taxCase)}
            editHref={taxCase.invoiceId ? invoiceHref(taxCase.invoiceId, fromHere) : undefined}
            hus={husExport}
          />
        </div>
      ) : null}

      <div className="mb-6">
        <JobNotes jobId={job.id} notes={notes} />
      </div>
    </div>
  );
}
