import { notFound } from "next/navigation";
import { db } from "@/lib/store";
import { getQuoteByToken, publicQuoteVersion, quoteAcceptance, requireCustomer } from "@/lib/services/data";
import { QuoteDocument } from "@/components/quote-document";
import { PdfPrintBar } from "@/components/pdf-print-bar";
import { CERTIFICATE_PRINT_LABEL } from "@/lib/quote-acceptance-certificate";
import { ensurePublicPage } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/offert/[token]/pdf">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("quote", token))) return { title: "Offert" };
  const quote = getQuoteByToken(token);
  // Utkast är inte publika – läck inte offertnummer via metadata.
  if (!quote || quote.status === "utkast") return { title: "Offert" };
  return { title: `Offert #${quote.number} – utskrift` };
}

/**
 * Utskrifts-/PDF-vy (A4). Samma QuoteDocument och samma kanoniska data som
 * kundwebbvyn – snapshot + dokument är den juridiska representationen (ingen
 * sparad PDF-blob, samma mönster som fakturans /faktura/[token]/pdf).
 * Ingen CTA: en godkänd offert visar den tysta raden "Godkänd {datum} av {namn}".
 * En skickad offert är bara det kommersiella dokumentet.
 */
export default async function QuotePdfPage(props: PageProps<"/offert/[token]/pdf">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("quote", token))) notFound();
  const quote = getQuoteByToken(token);
  if (!quote || quote.status === "utkast") notFound();
  const data = db();
  const version = publicQuoteVersion(quote);
  const customer = requireCustomer(quote.customerId);
  const acceptance = quoteAcceptance(quote.id);
  const showingAcceptedSnapshot = Boolean(acceptance && version.id === acceptance.quoteVersionId);

  return (
    <div className="min-h-dvh bg-[#eae7df] print:bg-white">
      {/* Riktig A4 – gäller bara den här utskriftsvyn, inte appens övriga print-lägen. */}
      <style>{`@page { size: A4; margin: 10mm 12mm; }`}</style>
      <PdfPrintBar
        backHref={`/offert/${quote.token}`}
        backLabel={`Tillbaka till offert #${quote.number}`}
        printLabel={CERTIFICATE_PRINT_LABEL}
      />
      <main className="px-4 py-6 sm:py-8 print:p-0">
        <div className="mx-auto w-full max-w-[210mm] bg-white shadow-[0_2px_8px_rgb(24_23_19/0.08),0_24px_60px_-24px_rgb(24_23_19/0.35)] ring-1 ring-ink/10 print:m-0 print:max-w-none print:shadow-none print:ring-0">
          <QuoteDocument
            company={data.settings}
            customer={customer}
            quote={quote}
            version={version}
            acceptance={showingAcceptedSnapshot ? acceptance : undefined}
          />
        </div>
        <p className="no-print mx-auto mt-4 max-w-[210mm] text-center text-[12px] text-muted">
          Välj ”Spara som PDF” i utskriftsdialogen för att ladda ner offerten som A4-dokument.
        </p>
      </main>
    </div>
  );
}
