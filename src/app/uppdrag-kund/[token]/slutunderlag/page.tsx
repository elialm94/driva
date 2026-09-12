import { notFound } from "next/navigation";
import { db } from "@/lib/store";
import { customerShareView, getJobByShareToken } from "@/lib/services/customer-share";
import { CloseoutSummaryDocument } from "@/components/closeout-summary-document";
import { PdfPrintBar } from "@/components/pdf-print-bar";
import { ensurePublicPage } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/uppdrag-kund/[token]/slutunderlag">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("job_share", token))) return { title: "Slutunderlag" };
  const job = getJobByShareToken(token);
  if (!job || !job.customerShare?.closeoutSummary || job.customerShare.disabledAt) return { title: "Slutunderlag" };
  return { title: `Slutunderlag – ${job.title}` };
}

/** Kundens utskriftsvy av slutunderlaget. Finns bara när det delats. */
export default async function CustomerSummaryPage(props: PageProps<"/uppdrag-kund/[token]/slutunderlag">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("job_share", token))) notFound();
  const job = getJobByShareToken(token);
  if (!job) notFound();
  const view = customerShareView(job);
  if (!view || !view.closeoutSummary) notFound();

  return (
    <div className="min-h-dvh bg-[#eae7df] print:bg-white" data-testid="customer-summary-page">
      <style>{`@page { size: A4; margin: 10mm 12mm; }`}</style>
      <PdfPrintBar backHref={`/uppdrag-kund/${token}`} backLabel="Tillbaka till uppdraget" />
      <main className="px-4 py-6 sm:py-8 print:p-0">
        <div className="mx-auto w-full max-w-[210mm] bg-white shadow-[0_2px_8px_rgb(24_23_19/0.08),0_24px_60px_-24px_rgb(24_23_19/0.35)] ring-1 ring-ink/10 print:m-0 print:max-w-none print:shadow-none print:ring-0">
          <CloseoutSummaryDocument company={db().settings} view={view} createdAt={job.customerShare?.sharedAt} />
        </div>
      </main>
    </div>
  );
}
