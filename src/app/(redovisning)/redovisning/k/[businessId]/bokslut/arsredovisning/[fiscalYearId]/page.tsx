import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { PageHeader, buttonClasses } from "@/components/ui";
import { ArsredovisningView, annualReportPageData } from "@/components/arsredovisning-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";
import { wsReadOnly } from "@/lib/accounting-workspace/shared";

export const metadata = { title: "Årsredovisning" };

export default async function AccountantArsredovisningPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string; fiscalYearId: string }>;
  searchParams: Promise<{ rapport?: string }>;
}) {
  const { businessId, fiscalYearId } = await params;
  const { rapport } = await searchParams;
  const ws = await loadPortfolioWorkspace(businessId);
  const data = annualReportPageData(fiscalYearId, rapport);
  if (!data) notFound();
  const { fy, report } = data;
  const base = `${ws.basePath}/bokslut`;
  const pdfHref = `${base}/arsredovisning/${fiscalYearId}/pdf${report.supersededAt ? `?rapport=${report.id}` : ""}`;

  return (
    <div>
      <PageHeader
        title={`Årsredovisning ${fy.label}`}
        subtitle={`${report.content.companyName} · org.nr ${report.content.orgNumber}`}
        actions={
          <Link href={pdfHref as never} className={buttonClasses("secondary", "sm")}>
            <FileText className="mr-1.5 size-4" />
            Visa som A4
          </Link>
        }
      />
      <ArsredovisningView
        fy={fy}
        report={report}
        base={base}
        businessId={ws.actionBusinessId}
        readOnly={wsReadOnly(ws, "year_end")}
      />
    </div>
  );
}
