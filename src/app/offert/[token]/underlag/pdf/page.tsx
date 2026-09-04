import { notFound } from "next/navigation";
import { AcceptanceCertificate } from "@/components/acceptance-certificate";
import { PdfPrintBar } from "@/components/pdf-print-bar";
import {
  CERTIFICATE_PRINT_LABEL,
  CERTIFICATE_TITLE,
  getAcceptanceCertificateByToken,
} from "@/lib/quote-acceptance-certificate";
import { ensurePublicPage } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/offert/[token]/underlag/pdf">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("quote", token))) return { title: CERTIFICATE_TITLE };
  const cert = getAcceptanceCertificateByToken(token);
  return { title: cert ? `${CERTIFICATE_TITLE} – utskrift` : CERTIFICATE_TITLE };
}

/** Text i @page-marginalboxar är en CSS-sträng – escapa \ och ". */
function cssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * A4-intyg. Samma kanoniska fakta som /underlag – webbläsarens printmotor
 * sätter det som ett dokument, inte en skärmdump av appen.
 */
export default async function AcceptanceCertificatePdfPage(props: PageProps<"/offert/[token]/underlag/pdf">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("quote", token))) notFound();
  const cert = getAcceptanceCertificateByToken(token);
  if (!cert) notFound();
  const marginNote = `${CERTIFICATE_TITLE} · ${cert.companyName}`;

  const printCss = `
@page {
  size: A4;
  margin: 16mm 16mm 18mm;
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
      <PdfPrintBar
        backHref={`/offert/${cert.quoteToken}/underlag`}
        backLabel="Tillbaka till intyget"
        printLabel={CERTIFICATE_PRINT_LABEL}
      />

      <main className="px-4 py-6 sm:py-8 print:p-0">
        <div className="mx-auto w-full max-w-[210mm] bg-white px-10 py-12 shadow-[0_2px_8px_rgb(24_23_19/0.08),0_24px_60px_-24px_rgb(24_23_19/0.35)] ring-1 ring-ink/10 sm:min-h-[297mm] print:m-0 print:max-w-none print:min-h-0 print:px-0 print:py-0 print:shadow-none print:ring-0">
          <AcceptanceCertificate cert={cert} variant="pdf" />
        </div>
        <p className="no-print mx-auto mt-4 max-w-[210mm] text-center text-[12px] text-muted">
          Välj ”Spara som PDF” i utskriftsdialogen för att ladda ner intyget som A4-dokument.
        </p>
      </main>
    </div>
  );
}
