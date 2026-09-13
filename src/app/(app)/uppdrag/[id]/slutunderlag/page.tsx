import { notFound } from "next/navigation";
import { ensurePageBusiness } from "@/lib/auth/session";
import { db } from "@/lib/store";
import { getJob } from "@/lib/services/data";
import { ownerCloseoutSummaryView } from "@/lib/services/customer-share";
import { CloseoutSummaryDocument } from "@/components/closeout-summary-document";
import { PdfPrintBar } from "@/components/pdf-print-bar";

export async function generateMetadata(props: PageProps<"/uppdrag/[id]/slutunderlag">) {
  await ensurePageBusiness();
  const { id } = await props.params;
  const job = getJob(id);
  return { title: job ? `Slutunderlag – ${job.title}` : "Slutunderlag" };
}

/**
 * Ägarens förhandsgranskning av slutunderlaget (A4, skriv ut eller spara
 * som PDF). Visar allt som kan ingå; kunden får bara det som delats via
 * kundvyn. Ingenting skickas härifrån.
 */
export default async function SlutunderlagPage(props: PageProps<"/uppdrag/[id]/slutunderlag">) {
  await ensurePageBusiness();
  const { id } = await props.params;
  const job = getJob(id);
  if (!job) notFound();
  const view = ownerCloseoutSummaryView(job);
  const shared = Boolean(job.customerShare && !job.customerShare.disabledAt && job.customerShare.closeoutSummary);

  return (
    <div className="-mx-4 -mt-6 min-h-dvh bg-[#eae7df] sm:-mx-8 lg:-mt-10 print:m-0 print:bg-white" data-testid="closeout-summary-page">
      <style>{`@page { size: A4; margin: 10mm 12mm; }`}</style>
      <PdfPrintBar backHref={`/uppdrag/${job.id}`} backLabel={`Tillbaka till ${job.title}`} />
      <main className="px-4 py-6 sm:py-8 print:p-0">
        <div className="mx-auto w-full max-w-[210mm] bg-white shadow-[0_2px_8px_rgb(24_23_19/0.08),0_24px_60px_-24px_rgb(24_23_19/0.35)] ring-1 ring-ink/10 print:m-0 print:max-w-none print:shadow-none print:ring-0">
          <CloseoutSummaryDocument company={db().settings} view={view} />
        </div>
        <p className="no-print mx-auto mt-4 max-w-[210mm] text-center text-[12px] text-muted">
          {shared
            ? "Slutunderlaget är delat på kundens uppdragslänk med de bilder du valt."
            : "Förhandsgranskning. Kunden ser slutunderlaget först när du delar det under Kundvy på uppdraget."}
          {" "}
          Välj ”Spara som PDF” i utskriftsdialogen för att ladda ner det som A4-dokument.
        </p>
      </main>
    </div>
  );
}
