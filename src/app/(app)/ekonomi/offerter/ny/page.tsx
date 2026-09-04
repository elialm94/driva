import { db } from "@/lib/store";
import { quoteDefaults } from "@/lib/services/quotes";
import { customerInvoiceRotPrefill } from "@/lib/services/tax-reduction";
import { getJob } from "@/lib/services/data";
import { tillaggQuoteFromInvoice } from "@/lib/services/invoice-quote-deviation";
import { quotePrefillFromJob } from "@/lib/services/job-work";
import { plainTextToRichText } from "@/lib/quote-description";
import { PageHeader } from "@/components/ui";
import { QuoteForm, type QuoteFormInitial } from "@/components/doc-form";
import { SmartBack } from "@/components/back-link";
import { labelForHref, sanitizeReturnLabel, sanitizeReturnTo } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";
import { isAiConfigured } from "@/lib/ai/provider";

export const metadata = { title: "Ny offert" };

export default async function NewQuotePage(props: PageProps<"/ekonomi/offerter/ny">) {
  await ensurePageBusiness();
  const searchParams = await props.searchParams;
  const kund = typeof searchParams.kund === "string" ? searchParams.kund : undefined;
  const tillaggFran = typeof searchParams.tillaggFran === "string" ? searchParams.tillaggFran : undefined;
  const legacyJob =
    typeof searchParams.forfragan === "string"
      ? searchParams.forfragan
      : typeof searchParams.uppdrag === "string"
        ? searchParams.uppdrag
        : undefined;
  const jobId = typeof searchParams.job === "string" ? searchParams.job : legacyJob;
  const job = jobId ? getJob(jobId) : undefined;
  const tillagg = tillaggFran ? tillaggQuoteFromInvoice(tillaggFran) : null;

  const customers = [...db().customers]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
  const rotByCustomer = Object.fromEntries(db().customers.map((c) => [c.id, customerInvoiceRotPrefill(c)]));

  const defaults = quoteDefaults();

  const jobPrefill = job ? quotePrefillFromJob(job.id) : null;
  const jobInitial: QuoteFormInitial | undefined = job
    ? {
        title: jobPrefill?.title ?? job.title,
        lines: jobPrefill?.lines ?? [],
        rot: null,
        paymentPlan: [{ label: "Betalning när arbetet är klart", percent: 100 }],
        paymentTermsDays: defaults.paymentTermsDays,
        lateInterestRate: defaults.lateInterestRate,
        validUntil: defaults.validUntil,
        terms: defaults.terms,
        // Uppdragets beskrivning som stycken i offertens enda beskrivningsfält.
        richText: plainTextToRichText(jobPrefill?.description || job.originalMessage || job.description),
      }
    : undefined;

  const initial: QuoteFormInitial | undefined = tillagg
    ? {
        title: tillagg.title,
        lines: tillagg.lines,
        rot: null,
        paymentPlan: [{ label: "Betalning när arbetet är klart", percent: 100 }],
        paymentTermsDays: defaults.paymentTermsDays,
        lateInterestRate: defaults.lateInterestRate,
        validUntil: defaults.validUntil,
        terms: defaults.terms,
        richText: plainTextToRichText(tillagg.description),
      }
    : jobInitial;

  const tillbaka = typeof searchParams.tillbaka === "string" ? sanitizeReturnTo(searchParams.tillbaka) : null;
  const tillbakaNamn =
    typeof searchParams.tillbakaNamn === "string" ? sanitizeReturnLabel(searchParams.tillbakaNamn) : null;

  let cancelHref = "/ekonomi?flik=offerter";
  let cancelLabel = "Offerter";
  let returnTo = tillbaka ?? undefined;
  let returnLabel = tillbakaNamn ?? undefined;

  if (job) {
    cancelHref = `/uppdrag/${job.id}`;
    cancelLabel = job.title;
    returnTo = returnTo ?? cancelHref;
    returnLabel = returnLabel ?? job.title;
  } else if (tillaggFran) {
    cancelHref = `/ekonomi/fakturor/${tillaggFran}`;
    cancelLabel = "Faktura";
    returnTo = returnTo ?? cancelHref;
  } else if (tillbaka) {
    cancelHref = tillbaka;
    cancelLabel = tillbakaNamn ?? labelForHref(tillbaka);
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<SmartBack fallbackHref={cancelHref} fallbackLabel={cancelLabel} />}
        title={tillagg ? tillagg.title : "Ny offert"}
        subtitle={
          tillagg
            ? `Tillägg till offert #${tillagg.quoteNumber} – kunden godkänner direkt i länken.`
            : job
              ? `Till uppdraget ”${job.title}”`
              : "Skapa, granska och skicka – kunden godkänner direkt i länken."
        }
      />
      {tillagg ? (
        <div className="mb-6 rounded-2xl border border-info/15 bg-info-soft/50 px-5 py-4 text-[14px] leading-relaxed text-soft">
          <span className="font-medium text-info">Tilläggsoffert:</span> {tillagg.note}
        </div>
      ) : job ? (
        <div className="mb-6 rounded-2xl border border-info/15 bg-info-soft/50 px-5 py-4 text-[14px] leading-relaxed text-soft">
          <span className="font-medium text-info">Från uppdrag:</span> {job.title}
          {job.address ? ` · ${job.address}` : ""}
        </div>
      ) : null}
      <QuoteForm
        customers={customers}
        defaultCustomerId={kund ?? tillagg?.customerId ?? job?.customerId}
        lockCustomer={Boolean(kund || job || tillagg)}
        jobId={job?.id}
        rotByCustomer={rotByCustomer}
        initial={initial}
        defaults={defaults}
        cancelHref={cancelHref}
        returnTo={returnTo}
        returnLabel={returnLabel}
        aiEnabled={isAiConfigured()}
      />
    </div>
  );
}
