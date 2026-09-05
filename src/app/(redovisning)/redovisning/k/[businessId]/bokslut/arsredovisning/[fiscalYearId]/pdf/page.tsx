import { notFound } from "next/navigation";
import { ArsredovisningPdfView } from "@/components/arsredovisning-pdf-view";
import { annualReportPageData } from "@/components/arsredovisning-view";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";

export const dynamic = "force-dynamic";

export const metadata = { title: "Årsredovisning – PDF" };

export default async function AccountantArsredovisningPdfPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string; fiscalYearId: string }>;
  searchParams: Promise<{ rapport?: string }>;
}) {
  const { businessId, fiscalYearId } = await params;
  const { rapport } = await searchParams;
  await loadAccountantClientPage(businessId);
  const data = annualReportPageData(fiscalYearId, rapport);
  if (!data) notFound();
  const { fy, report } = data;

  return (
    <ArsredovisningPdfView
      fy={fy}
      report={report}
      backHref={`/redovisning/k/${businessId}/bokslut/arsredovisning/${fiscalYearId}${
        report.supersededAt ? `?rapport=${report.id}` : ""
      }`}
    />
  );
}
