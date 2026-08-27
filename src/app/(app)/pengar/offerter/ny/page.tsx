import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/store";
import { quoteDefaults } from "@/lib/services/quotes";
import { getJob, getRequest } from "@/lib/services/data";
import { tillaggQuoteFromInvoice } from "@/lib/services/invoice-quote-deviation";
import { PageHeader } from "@/components/ui";
import { QuoteForm, type QuoteFormInitial } from "@/components/doc-form";

export const metadata = { title: "Ny offert" };

export default async function NewQuotePage(props: PageProps<"/pengar/offerter/ny">) {
  const searchParams = await props.searchParams;
  const kund = typeof searchParams.kund === "string" ? searchParams.kund : undefined;
  const forfraganId = typeof searchParams.forfragan === "string" ? searchParams.forfragan : undefined;
  const tillaggFran = typeof searchParams.tillaggFran === "string" ? searchParams.tillaggFran : undefined;
  const jobId =
    typeof searchParams.job === "string"
      ? searchParams.job
      : typeof searchParams.uppdrag === "string"
        ? searchParams.uppdrag
        : undefined;
  const request = forfraganId ? getRequest(forfraganId) : undefined;
  const job = jobId ? getJob(jobId) : undefined;
  const tillagg = tillaggFran ? tillaggQuoteFromInvoice(tillaggFran) : null;

  const customers = [...db().customers]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  const defaults = quoteDefaults();

  const jobInitial: QuoteFormInitial | undefined = job
    ? {
        title: job.title,
        intro: job.description,
        lines: [],
        rot: null,
        paymentPlan: [{ label: "Betalning när arbetet är klart", percent: 100 }],
        paymentTermsDays: defaults.paymentTermsDays,
        lateInterestRate: defaults.lateInterestRate,
        validUntil: defaults.validUntil,
        terms: defaults.terms,
      }
    : undefined;

  const initial: QuoteFormInitial | undefined = tillagg
    ? {
        title: tillagg.title,
        intro: tillagg.intro,
        lines: tillagg.lines,
        rot: null,
        paymentPlan: [{ label: "Betalning när arbetet är klart", percent: 100 }],
        paymentTermsDays: defaults.paymentTermsDays,
        lateInterestRate: defaults.lateInterestRate,
        validUntil: defaults.validUntil,
        terms: defaults.terms,
      }
    : jobInitial
      ? jobInitial
      : request
        ? {
            title: request.ai?.workType ?? request.title,
            intro: "",
            lines: [],
            rot: null,
            paymentPlan: [{ label: "Betalning när arbetet är klart", percent: 100 }],
            paymentTermsDays: defaults.paymentTermsDays,
            validUntil: defaults.validUntil,
            terms: defaults.terms,
          }
        : undefined;

  return (
    <div className="animate-fade-up">
      <Link href="/pengar?flik=offerter" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Offerter
      </Link>
      <PageHeader
        title={tillagg ? tillagg.title : "Ny offert"}
        subtitle={
          tillagg
            ? `Tillägg till offert #${tillagg.quoteNumber} – kunden godkänner med BankID.`
            : job
              ? `Till uppdraget ”${job.title}”`
              : request
                ? `Utifrån förfrågan: ”${request.title}”`
                : "Skapa, granska och skicka – kunden godkänner med BankID."
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
      ) : request ? (
        <div className="mb-6 rounded-2xl border border-info/15 bg-info-soft/50 px-5 py-4 text-[14px] leading-relaxed text-soft">
          <span className="font-medium text-info">Från förfrågan:</span> ”{request.message}”
        </div>
      ) : null}
      <QuoteForm
        customers={customers}
        defaultCustomerId={kund ?? tillagg?.customerId ?? job?.customerId ?? request?.customerId}
        requestId={forfraganId}
        jobId={job?.id}
        initial={initial}
        defaults={defaults}
      />
    </div>
  );
}
