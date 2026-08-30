import { db } from "@/lib/store";
import { getInvoiceDefaults } from "@/lib/services/settings";
import { currentVersion, getJob, jobQuote } from "@/lib/services/data";
import { preferredJobForNewInvoice } from "@/lib/services/business-chain";
import { customerInvoiceRotPrefill, resolveTaxReductionPrefill } from "@/lib/services/tax-reduction";
import { suggestedServiceDate } from "@/lib/tax-reduction-gaps";
import { Card, PageHeader } from "@/components/ui";
import { InvoiceForm } from "@/components/doc-form";
import { SmartBack } from "@/components/back-link";
import { AppLink } from "@/components/app-link";
import { jobHref, labelForHref, newInvoiceHref, sanitizeReturnLabel, sanitizeReturnTo } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";
import { isAiConfigured } from "@/lib/ai/provider";

export const metadata = { title: "Ny faktura" };

export default async function NewInvoicePage(props: PageProps<"/ekonomi/fakturor/ny">) {
  await ensurePageBusiness();
  const searchParams = await props.searchParams;
  const kund = typeof searchParams.kund === "string" ? searchParams.kund : undefined;
  const standalone = searchParams.fristaende === "1" || searchParams.fristaende === "true";
  const requestedJobId =
    typeof searchParams.job === "string"
      ? searchParams.job
      : typeof searchParams.uppdrag === "string"
        ? searchParams.uppdrag
        : undefined;
  const preferredJob = !requestedJobId && !standalone && kund ? preferredJobForNewInvoice(kund) : undefined;
  const jobId = requestedJobId ?? preferredJob?.id;
  const tillbaka = typeof searchParams.tillbaka === "string" ? sanitizeReturnTo(searchParams.tillbaka) : null;
  const tillbakaNamn =
    typeof searchParams.tillbakaNamn === "string" ? sanitizeReturnLabel(searchParams.tillbakaNamn) : null;
  const cancelHref = tillbaka ?? "/ekonomi?flik=fakturor";
  const cancelLabel = tillbaka ? (tillbakaNamn ?? labelForHref(tillbaka)) : "Fakturor";

  const data = db();
  const job = jobId ? getJob(jobId) : undefined;
  const quote = job ? jobQuote(job) : undefined;
  const quoteRot = quote ? currentVersion(quote).rot : null;
  const customers = [...data.customers]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
  const defaultCustomerId = job?.customerId ?? kund ?? customers[0]?.id;
  const rotByCustomer = Object.fromEntries(data.customers.map((c) => [c.id, customerInvoiceRotPrefill(c)]));
  const prefill = defaultCustomerId
    ? resolveTaxReductionPrefill({ customerId: defaultCustomerId, jobId: job?.id })
    : null;
  const defaults = getInvoiceDefaults();

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<SmartBack fallbackHref={cancelHref} fallbackLabel={cancelLabel} />}
        title="Ny faktura"
        subtitle="Tips: fakturor skapas oftast automatiskt från klara uppdrag eller från offertens betalningsplan."
      />
      {preferredJob && !standalone ? (
        <Card className="mb-6 px-5 py-4 text-[14px] leading-relaxed text-soft">
          <span className="font-medium text-ink">Fortsätter uppdraget {preferredJob.title}.</span> Fakturan kopplas
          till kedjan.{" "}
          <AppLink
            href={jobHref(preferredJob.id, { href: `/ekonomi/fakturor/ny?kund=${kund}`, label: "Ny faktura" })}
            className="font-medium text-ink underline"
          >
            Skapa från uppdraget
          </AppLink>
          {" · "}
          <AppLink
            href={newInvoiceHref({ kund, fristaende: true })}
            className="font-medium text-ink underline"
          >
            Fristående faktura
          </AppLink>
        </Card>
      ) : null}
      <InvoiceForm
        customers={customers}
        defaultCustomerId={defaultCustomerId}
        lockCustomer={Boolean(kund || job)}
        defaultLateInterestRate={defaults.lateInterestRate}
        defaultPaymentTermsDays={defaults.paymentTermsDays}
        defaultVatRate={defaults.defaultVatRate}
        defaultHourlyRate={defaults.defaultHourlyRate}
        jobId={job?.id}
        quoteId={quote?.id ?? job?.quoteId}
        rotByCustomer={rotByCustomer}
        initial={
          prefill
            ? {
                lines: [],
                rot: quoteRot,
                workLocationId: quote?.workLocationId,
                dueInDays: defaults.paymentTermsDays,
                lateInterestRate: defaults.lateInterestRate,
                serviceDate: suggestedServiceDate(prefill) || undefined,
                taxReduction: {
                  personalIdentityNumber: prefill.personalIdentityNumber,
                  workAddress: prefill.workAddress,
                  workPeriodStart: prefill.workPeriodStart,
                  workPeriodEnd: prefill.workPeriodEnd,
                  housing: prefill.housing,
                },
              }
            : undefined
        }
        cancelHref={cancelHref}
        returnTo={tillbaka ?? undefined}
        returnLabel={tillbakaNamn ?? undefined}
        aiEnabled={isAiConfigured()}
      />
    </div>
  );
}
