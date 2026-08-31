import { notFound } from "next/navigation";
import { db } from "@/lib/store";
import { getInvoiceByToken, requireCustomer } from "@/lib/services/data";
import { InvoiceDocument } from "@/components/invoice-document";
import { PdfPrintBar } from "@/components/pdf-print-bar";
import { invoiceHeading } from "@/lib/invoices/display";
import { resolveInvoiceView } from "@/lib/invoices/snapshot";
import { ensurePublicPage } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/faktura/[token]/pdf">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("invoice", token))) return { title: "Faktura" };
  const invoice = getInvoiceByToken(token);
  return { title: invoice ? `${invoiceHeading(invoice)} – PDF` : "Faktura" };
}

/** Text i @page-marginalboxar är en CSS-sträng – escapa \ och ". */
function cssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * A4-vyn av fakturan. Samma canonical data och renderare (InvoiceDocument)
 * som kundvyn – webbläsarens printmotor sätter den som ett riktigt
 * A4-dokument (vektor, inte skärmdump): @page styr format och marginaler,
 * thead upprepas per sida, rader bryts aldrig mitt itu och sidfoten får
 * fakturaidentitet + sidnummer via marginalboxar.
 */
export default async function InvoicePdfPage(props: PageProps<"/faktura/[token]/pdf">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("invoice", token))) notFound();
  const invoice = getInvoiceByToken(token);
  if (!invoice || invoice.status === "utkast") notFound();
  const data = db();
  const customer = requireCustomer(invoice.customerId);
  const view = resolveInvoiceView(invoice, { seller: data.settings, buyer: customer });
  const marginNote = `${invoiceHeading(invoice)} · ${view.seller.name}`;

  // Marginalboxarnas typografi kan inte läsa CSS-variabler – värdena
  // motsvarar --color-muted och en neutral sans (Geist laddas inte i @page).
  const printCss = `
@page {
  size: A4;
  margin: 15mm 15mm 20mm;
  @bottom-left {
    content: ${cssString(marginNote)};
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 8.5px;
    color: #8a857a;
  }
  @bottom-right {
    content: "Sida " counter(page) " av " counter(pages);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 8.5px;
    color: #8a857a;
  }
}
@media print {
  html, body { background: #fff !important; }
  body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
`;

  return (
    <div className="min-h-dvh bg-[#eae7df] print:bg-white">
      <style>{printCss}</style>
      <PdfPrintBar backHref={`/faktura/${token}`} backLabel="Tillbaka till fakturan" />

      <main className="px-4 py-6 sm:py-8 print:p-0">
        <div className="mx-auto w-full max-w-[210mm] bg-white shadow-[0_2px_8px_rgb(24_23_19/0.08),0_24px_60px_-24px_rgb(24_23_19/0.35)] ring-1 ring-ink/10 sm:min-h-[297mm] print:m-0 print:max-w-none print:min-h-0 print:shadow-none print:ring-0">
          <InvoiceDocument company={data.settings} customer={customer} invoice={invoice} />
        </div>
        <p className="no-print mx-auto mt-4 max-w-[210mm] text-center text-[12px] text-muted">
          Välj ”Spara som PDF” i utskriftsdialogen för att ladda ner fakturan som A4-dokument.
        </p>
      </main>
    </div>
  );
}
