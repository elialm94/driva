import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { Badge, Card, PageHeader, buttonClasses } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { AnnualReportStatusButton } from "@/components/bokforing-widgets";
import { AnnualReportDocument } from "@/components/annual-report-document";
import { CertificationForm, NarrativeForm, SignatoriesForm } from "@/components/arsredovisning-widgets";
import { db } from "@/lib/store";
import { datumKort } from "@/lib/format";
import { ensurePageBusiness } from "@/lib/auth/session";
import { getFiscalYear } from "@/lib/accounting/fiscal";
import { annualReportBlockers, annualReportFor } from "@/lib/accounting/annual-report";
import type { AnnualReport } from "@/lib/types";

export const metadata = { title: "Årsredovisning" };

const STATUS_LABEL: Record<AnnualReport["status"], string> = {
  genererad: "Skapad",
  granskad: "Granskad",
  signerad: "Signerad",
  inlamnad_markerad: "Markerad som inlämnad",
};

const NEXT_STATUS: Record<AnnualReport["status"], AnnualReport["status"] | undefined> = {
  genererad: "granskad",
  granskad: "signerad",
  signerad: "inlamnad_markerad",
  inlamnad_markerad: undefined,
};

/**
 * Årsredovisningen för ett stängt räkenskapsår: dokumentet som det kommer att
 * se ut, och det som går att ändra i det.
 *
 * Siffrorna står inte att ändra här. De kommer ur den stängda bokföringen, och
 * en årsredovisning som säger något annat än böckerna vore en osanning. Det som
 * går att skriva är bolagets egna påståenden – verksamheten, årets händelser,
 * utdelningsförslaget, underskrifterna och fastställelseintyget.
 */
export default async function ArsredovisningPage(
  props: PageProps<"/bokforing/bokslut/arsredovisning/[fiscalYearId]">
) {
  await ensurePageBusiness();
  const { fiscalYearId } = await props.params;
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) notFound();
  const report = annualReportFor(fiscalYearId);
  if (!report) notFound();

  const settings = db().settings;
  const locked = report.status === "signerad" || report.status === "inlamnad_markerad";
  const next = NEXT_STATUS[report.status];
  const blockers = next ? annualReportBlockers(report, next) : [];
  const fb = report.content.forvaltningsberattelse;

  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title={`Årsredovisning ${fy.label}`}
        subtitle={`${report.content.companyName} · org.nr ${report.content.orgNumber}`}
        actions={
          <Link
            href={`/bokforing/bokslut/arsredovisning/${fiscalYearId}/pdf`}
            className={buttonClasses("secondary", "sm")}
          >
            <FileText className="mr-1.5 size-4" />
            Visa som A4
          </Link>
        }
      />

      <Card className="mb-6 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-[15px] font-semibold">Status</h2>
              <Badge tone={report.status === "inlamnad_markerad" ? "ok" : "info"}>{STATUS_LABEL[report.status]}</Badge>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
              Skapad {datumKort(report.generatedAt)}
              {report.reviewedAt ? ` · granskad ${datumKort(report.reviewedAt)}` : ""}
              {report.signedAt ? ` · signerad ${datumKort(report.signedAt)}` : ""}
              {report.markedFiledAt ? ` · markerad som inlämnad ${datumKort(report.markedFiledAt)}` : ""}
            </p>
          </div>
          <AnnualReportStatusButton reportId={report.id} status={report.status} blockers={blockers} />
        </div>
        <p className="mt-4 border-t border-line/60 pt-3 text-[12px] leading-relaxed text-muted">
          Driva lämnar inte in årsredovisningen. Skriv ut A4-vyn, låt styrelsen skriva under, låt stämman fastställa
          räkningarna och lämna in den bestyrkta kopian hos Bolagsverket. Statusen här är en markering med spårbarhet.
        </p>
      </Card>

      <div className="mb-6 space-y-4">
        <NarrativeForm
          reportId={report.id}
          verksamhet={fb.verksamhet}
          vasentligaHandelser={fb.vasentligaHandelser}
          tillForfogande={fb.resultatdisposition.tillForfogande}
          utdelning={fb.resultatdisposition.utdelning}
          locked={locked}
        />
        <SignatoriesForm reportId={report.id} signatories={report.content.underskrifter ?? []} locked={locked} />
        <CertificationForm
          reportId={report.id}
          certification={report.content.fastallelseintyg}
          signatories={report.content.underskrifter ?? []}
          locked={locked}
        />
      </div>

      <Card className="overflow-hidden p-0">
        <AnnualReportDocument report={report} company={settings} />
      </Card>
    </div>
  );
}
