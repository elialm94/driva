import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { AccountantClientTabs } from "@/components/accountant-workspace";
import { PageHeader, buttonClasses } from "@/components/ui";
import { ArsredovisningView, annualReportPageData } from "@/components/arsredovisning-view";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { can } from "@/lib/collaboration/permissions";

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
  const { access } = await loadAccountantClientPage(businessId);
  const data = annualReportPageData(fiscalYearId, rapport);
  if (!data) notFound();
  const { fy, report } = data;
  const base = `/redovisning/k/${businessId}/bokslut`;
  const pdfHref = `${base}/arsredovisning/${fiscalYearId}/pdf${report.supersededAt ? `?rapport=${report.id}` : ""}`;

  return (
    <div className="animate-fade-up">
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
      <AccountantClientTabs businessId={businessId} active="bokslut" />
      <ArsredovisningView
        fy={fy}
        report={report}
        base={base}
        businessId={businessId}
        readOnly={!can(access.role, "year_end")}
      />
    </div>
  );
}
