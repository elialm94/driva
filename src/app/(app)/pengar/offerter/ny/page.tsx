import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/store";
import { quoteDefaults } from "@/lib/services/quotes";
import { getRequest } from "@/lib/services/data";
import { PageHeader } from "@/components/ui";
import { QuoteForm, type QuoteFormInitial } from "@/components/doc-form";

export const metadata = { title: "Ny offert" };

export default async function NewQuotePage(props: PageProps<"/pengar/offerter/ny">) {
  const searchParams = await props.searchParams;
  const kund = typeof searchParams.kund === "string" ? searchParams.kund : undefined;
  const forfraganId = typeof searchParams.forfragan === "string" ? searchParams.forfragan : undefined;
  const request = forfraganId ? getRequest(forfraganId) : undefined;

  const customers = [...db().customers]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  const defaults = quoteDefaults();

  const initial: QuoteFormInitial | undefined = request
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
        title="Ny offert"
        subtitle={request ? `Utifrån förfrågan: ”${request.title}”` : "Skapa, granska och skicka – kunden godkänner med BankID."}
      />
      {request ? (
        <div className="mb-6 rounded-2xl border border-info/15 bg-info-soft/50 px-5 py-4 text-[14px] leading-relaxed text-soft">
          <span className="font-medium text-info">Från förfrågan:</span> ”{request.message}”
        </div>
      ) : null}
      <QuoteForm
        customers={customers}
        defaultCustomerId={kund ?? request?.customerId}
        requestId={forfraganId}
        initial={
          initial
            ? { ...initial, lines: [] }
            : undefined
        }
        defaults={defaults}
      />
    </div>
  );
}
