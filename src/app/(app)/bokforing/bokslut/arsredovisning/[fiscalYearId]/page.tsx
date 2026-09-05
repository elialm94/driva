import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { PageHeader, buttonClasses } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { ArsredovisningView, annualReportPageData } from "@/components/arsredovisning-view";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Årsredovisning" };

export default async function ArsredovisningPage(
  props: PageProps<"/bokforing/bokslut/arsredovisning/[fiscalYearId]">
) {
  await ensurePageBusiness();
  const { fiscalYearId } = await props.params;
  const { rapport } = await props.searchParams;
  const data = annualReportPageData(fiscalYearId, typeof rapport === "string" ? rapport : undefined);
  if (!data) notFound();
  const { fy, report } = data;
  const pdfHref = `/bokforing/bokslut/arsredovisning/${fiscalYearId}/pdf${
    report.supersededAt ? `?rapport=${report.id}` : ""
  }`;

  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title={`Årsredovisning ${fy.label}`}
        subtitle={`${report.content.companyName} · org.nr ${report.content.orgNumber}`}
        actions={
          <Link href={pdfHref} className={buttonClasses("secondary", "sm")}>
            <FileText className="mr-1.5 size-4" />
            Visa som A4
          </Link>
        }
      />
      <ArsredovisningView fy={fy} report={report} base="/bokforing/bokslut" />
    </div>
  );
}
