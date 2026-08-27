import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/store";
import { getQuote, currentVersion, requireCustomer } from "@/lib/services/data";
import { quoteDefaults } from "@/lib/services/quotes";
import { PageHeader } from "@/components/ui";
import { QuoteForm } from "@/components/doc-form";

export const metadata = { title: "Redigera offert" };

export default async function EditQuotePage(props: PageProps<"/pengar/offerter/[id]/redigera">) {
  const { id } = await props.params;
  const quote = getQuote(id);
  if (!quote) notFound();
  const version = currentVersion(quote);
  const customer = requireCustomer(quote.customerId);
  const isLocked = !!version.lockedAt;

  const customers = [...db().customers]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  return (
    <div className="animate-fade-up">
      <Link
        href={`/pengar/offerter/${quote.id}` as never}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" /> Offert #{quote.number}
      </Link>
      <PageHeader
        title={isLocked ? `Ny version av offert #${quote.number}` : `Redigera offert #${quote.number}`}
        subtitle={
          isLocked
            ? `Version ${version.version} är BankID-signerad och låst. Dina ändringar sparas som version ${version.version + 1}, som behöver skickas och signeras på nytt.`
            : `Till ${customer.name}. ${quote.status === "skickad" ? "Offerten är skickad – sparade ändringar gör att den behöver skickas om." : ""}`
        }
      />
      <QuoteForm
        customers={customers}
        defaultCustomerId={quote.customerId}
        quoteId={quote.id}
        initial={{
          title: version.title,
          intro: version.intro,
          lines: version.lines,
          rot: version.rot,
          paymentPlan: version.paymentPlan,
          paymentTermsDays: version.paymentTermsDays,
          lateInterestRate: version.lateInterestRate,
          validUntil: version.validUntil,
          terms: version.terms,
        }}
        defaults={quoteDefaults()}
      />
    </div>
  );
}
