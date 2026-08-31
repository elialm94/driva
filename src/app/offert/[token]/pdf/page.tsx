import { notFound } from "next/navigation";
import { db } from "@/lib/store";
import { getQuoteByToken, currentVersion, quoteSignature, requireCustomer } from "@/lib/services/data";
import { QuoteDocument } from "@/components/quote-document";
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
 * Ingen acceptance-slot: dokumentet visar statisk signeringsinformation.
 */
export default async function QuotePdfPage(props: PageProps<"/offert/[token]/pdf">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("quote", token))) notFound();
  const quote = getQuoteByToken(token);
  if (!quote || quote.status === "utkast") notFound();
  const data = db();
  const version = currentVersion(quote);
  const customer = requireCustomer(quote.customerId);
  const signature = quoteSignature(quote.id);

  return (
    <div className="min-h-dvh bg-white print:bg-white">
      <QuoteDocument
        company={data.settings}
        customer={customer}
        quote={quote}
        version={version}
        signature={signature}
      />
    </div>
  );
}
