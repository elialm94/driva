import { notFound } from "next/navigation";
import { AnnualReportDocument } from "@/components/annual-report-document";
import { PdfPrintBar } from "@/components/pdf-print-bar";
import { db } from "@/lib/store";
import { ensurePageBusiness } from "@/lib/auth/session";
import { getFiscalYear } from "@/lib/accounting/fiscal";
import { annualReportFor } from "@/lib/accounting/annual-report";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/bokforing/bokslut/arsredovisning/[fiscalYearId]/pdf">
) {
  const { fiscalYearId } = await props.params;
  const fy = getFiscalYear(fiscalYearId);
  return { title: fy ? `Årsredovisning ${fy.label} – PDF` : "Årsredovisning" };
}

/** Text i @page-marginalboxar är en CSS-sträng – escapa \ och ". */
function cssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * A4-vyn av årsredovisningen. Samma renderare som skärmvyn – webbläsarens
 * printmotor sätter den som ett riktigt A4-dokument (vektor, inte skärmdump).
 *
 * Bolagsverket kräver att varje sida bär bolagets namn och organisationsnummer,
 * så identiteten står i sidfoten via @page-marginalboxar tillsammans med
 * sidnumret. Att bara skriva ut skärmvyn hade gett ett dokument utan det.
 */
export default async function ArsredovisningPdfPage(
  props: PageProps<"/bokforing/bokslut/arsredovisning/[fiscalYearId]/pdf">
) {
  await ensurePageBusiness();
  const { fiscalYearId } = await props.params;
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) notFound();
  const report = annualReportFor(fiscalYearId);
  if (!report) notFound();

  const marginNote = `${report.content.companyName} · ${report.content.orgNumber} · Årsredovisning ${fy.label}`;

  // Marginalboxarnas typografi kan inte läsa CSS-variabler – värdena
  // motsvarar --color-muted och en neutral sans (Geist laddas inte i @page).
  const printCss = `
@page {
  size: A4;
  margin: 18mm 18mm 16mm;
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
  /* Rubrik utan sin uppställning ser ut som ett tryckfel. */
  h2, h3 { break-after: avoid; }
  thead { display: table-header-group; }
}
`;

  return (
    <div className="min-h-dvh bg-[#eae7df] print:bg-white">
      <style>{printCss}</style>
      <PdfPrintBar
        backHref={`/bokforing/bokslut/arsredovisning/${fiscalYearId}`}
        backLabel="Tillbaka till årsredovisningen"
      />

      <main className="px-4 py-6 sm:py-8 print:p-0">
        <div className="mx-auto w-full max-w-[210mm] bg-white shadow-[0_2px_8px_rgb(24_23_19/0.08),0_24px_60px_-24px_rgb(24_23_19/0.35)] ring-1 ring-ink/10 sm:min-h-[297mm] print:m-0 print:max-w-none print:min-h-0 print:shadow-none print:ring-0">
          <AnnualReportDocument report={report} company={db().settings} />
        </div>
        <p className="no-print mx-auto mt-4 max-w-[210mm] text-center text-[12px] text-muted">
          Välj ”Spara som PDF” i utskriftsdialogen för att ladda ner årsredovisningen som A4-dokument. Skriv ut ett
          exemplar för styrelsens underskrifter.
        </p>
      </main>
    </div>
  );
}
