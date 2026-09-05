import { notFound } from "next/navigation";
import { ArsredovisningPdfView } from "@/components/arsredovisning-pdf-view";
import { annualReportPageData } from "@/components/arsredovisning-view";
import { ensurePageBusiness } from "@/lib/auth/session";
import { getFiscalYear } from "@/lib/accounting/fiscal";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/bokforing/bokslut/arsredovisning/[fiscalYearId]/pdf">
) {
  const { fiscalYearId } = await props.params;
  const fy = getFiscalYear(fiscalYearId);
  return { title: fy ? `Årsredovisning ${fy.label} – PDF` : "Årsredovisning" };
}

export default async function ArsredovisningPdfPage(
  props: PageProps<"/bokforing/bokslut/arsredovisning/[fiscalYearId]/pdf">
) {
  await ensurePageBusiness();
  const { fiscalYearId } = await props.params;
  const { rapport } = await props.searchParams;
  // Även en ersatt rapport ska gå att skriva ut – den kan vara den handling som
  // faktiskt undertecknades. Men då måste utskriften säga det.
  const data = annualReportPageData(fiscalYearId, typeof rapport === "string" ? rapport : undefined);
  if (!data) notFound();
  const { fy, report } = data;

  return (
    <ArsredovisningPdfView
      fy={fy}
      report={report}
      backHref={`/bokforing/bokslut/arsredovisning/${fiscalYearId}${
        report.supersededAt ? `?rapport=${report.id}` : ""
      }`}
    />
  );
}
