import { notFound } from "next/navigation";
import { db } from "@/lib/store";
import { getQuote, currentVersion, requireCustomer } from "@/lib/services/data";
import { quoteDefaults } from "@/lib/services/quotes";
import { customerInvoiceRotPrefill } from "@/lib/services/tax-reduction";
import { quoteDescriptionDoc } from "@/lib/quote-description";
import { PageHeader } from "@/components/ui";
import { QuoteForm } from "@/components/doc-form";
import { SmartBack } from "@/components/back-link";
import { hrefWithNav, sanitizeReturnLabel, sanitizeReturnTo } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";
import { isAiConfigured } from "@/lib/ai/provider";

export const metadata = { title: "Redigera offert" };

export default async function EditQuotePage(props: PageProps<"/ekonomi/offerter/[id]/redigera">) {
  await ensurePageBusiness();
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const quote = getQuote(id);
  if (!quote) notFound();
  const version = currentVersion(quote);
  const customer = requireCustomer(quote.customerId);
  const isLocked = !!version.lockedAt;
  const returnTo = typeof searchParams.tillbaka === "string" ? sanitizeReturnTo(searchParams.tillbaka) : undefined;
  const returnLabel =
    typeof searchParams.tillbakaNamn === "string" ? sanitizeReturnLabel(searchParams.tillbakaNamn) ?? undefined : undefined;
  const quoteHref = hrefWithNav(`/ekonomi/offerter/${quote.id}`, { returnTo, returnLabel });

  const customers = [...db().customers]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
  const rotByCustomer = Object.fromEntries(db().customers.map((c) => [c.id, customerInvoiceRotPrefill(c)]));

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<SmartBack fallbackHref={quoteHref} fallbackLabel={`Offert #${quote.number}`} ignoreReturnTo />}
        crumbs={[
          { href: "/ekonomi", label: "Ekonomi" },
          { href: "/ekonomi?flik=offerter", label: "Offerter" },
          { href: quoteHref, label: `#${quote.number}` },
          { label: isLocked ? "Ny version" : "Redigera" },
        ]}
        title={isLocked ? `Ny version av offert #${quote.number}` : `Redigera offert #${quote.number}`}
        subtitle={
          isLocked
            ? `Version ${version.version} är godkänd av kunden och låst. Dina ändringar sparas som version ${version.version + 1}, som behöver skickas och godkännas på nytt.`
            : `Till ${customer.name}. ${quote.status === "skickad" ? "Offerten är skickad – sparade ändringar gör att den behöver skickas om." : ""}`
        }
      />
      <QuoteForm
        customers={customers}
        defaultCustomerId={quote.customerId}
        quoteId={quote.id}
        rotByCustomer={rotByCustomer}
        initial={{
          title: version.title,
          lines: version.lines,
          rot: version.rot,
          workLocationId: quote.workLocationId,
          paymentPlan: version.paymentPlan,
          paymentTermsDays: version.paymentTermsDays,
          lateInterestRate: version.lateInterestRate,
          validUntil: version.validUntil,
          terms: version.terms,
          taxReductionTerms: version.taxReductionTerms
            ? { heading: version.taxReductionTerms.heading, body: version.taxReductionTerms.body }
            : null,
          // Kanonisk beskrivning: på låsta (godkända) versioner ligger legacy-
          // "Beskrivning av arbetet" kvar och slås ihop här inför ny version.
          richText: quoteDescriptionDoc(version),
        }}
        defaults={quoteDefaults()}
        cancelHref={quoteHref}
        returnTo={returnTo ?? undefined}
        returnLabel={returnLabel}
        aiEnabled={isAiConfigured()}
      />
    </div>
  );
}
