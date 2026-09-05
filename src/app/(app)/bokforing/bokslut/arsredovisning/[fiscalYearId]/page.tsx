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
import { annualReportBlockers, annualReportHistory, resolveAnnualReport } from "@/lib/accounting/annual-report";
import { ixbrlBlockers, ixbrlForAnnualReport } from "@/lib/accounting/ixbrl";
import { InlamningPanel } from "@/components/inlamning";
import { filingPanelData } from "@/lib/filing/view";
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
  const { rapport } = await props.searchParams;
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) notFound();
  /*
   * En ersatt rapport visas fortfarande. Den kan vara undertecknad och inlämnad,
   * och då är den en handling som ska gå att läsa och skriva ut i efterhand –
   * men den är låst och märkt, för den beskriver inte längre böckerna.
   */
  const report = resolveAnnualReport(fiscalYearId, typeof rapport === "string" ? rapport : undefined);
  if (!report) notFound();
  const superseded = Boolean(report.supersededAt);
  const history = annualReportHistory(fiscalYearId);
  const current = superseded ? history.find((r) => !r.supersededAt) : undefined;
  const supersededOthers = history.filter((r) => r.supersededAt && r.id !== report.id);
  const pdfHref = `/bokforing/bokslut/arsredovisning/${fiscalYearId}/pdf${superseded ? `?rapport=${report.id}` : ""}`;

  const settings = db().settings;
  const locked = superseded || report.status === "signerad" || report.status === "inlamnad_markerad";
  const next = superseded ? undefined : NEXT_STATUS[report.status];
  const blockers = next ? annualReportBlockers(report, next) : [];
  const fb = report.content.forvaltningsberattelse;

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

      {superseded ? (
        <Card className="mb-6 border-warn/40 bg-warn-soft/50 px-6 py-5">
          <h2 className="text-[15px] font-semibold">Den här årsredovisningen är ersatt</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
            Räkenskapsåret {fy.label} öppnades igen {report.supersededAt ? datumKort(report.supersededAt) : ""} efter att
            rapporten upprättades, så siffrorna här är inte längre bolagets bokföring. Rapporten står kvar oförändrad –
            den kan ha undertecknats och lämnats in, och då är den en handling som ska gå att läsa i efterhand.
            {report.supersededReason ? ` Skäl till att året öppnades: ${report.supersededReason}` : ""}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-soft">
            {current
              ? "Året är stängt igen och en ny årsredovisning är upprättad ur de nya siffrorna."
              : fy.status === "stangt"
                ? "Året är stängt igen – upprätta en ny årsredovisning från bokslutssidan."
                : `Stäng ${fy.label} igen på bokslutssidan, då upprättas en ny årsredovisning ur de nya siffrorna.`}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {current ? (
              <Link
                href={`/bokforing/bokslut/arsredovisning/${fiscalYearId}`}
                className={buttonClasses("secondary", "sm")}
              >
                Läs den gällande årsredovisningen
              </Link>
            ) : (
              <Link href="/bokforing/bokslut" className={buttonClasses("secondary", "sm")}>
                Till bokslutet
              </Link>
            )}
            <Link href={pdfHref} className="text-[13px] font-medium text-accent hover:underline">
              Skriv ut den ersatta rapporten
            </Link>
          </div>
        </Card>
      ) : null}

      <Card className="mb-6 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-[15px] font-semibold">Status</h2>
              <Badge tone={superseded ? "neutral" : report.status === "inlamnad_markerad" ? "ok" : "info"}>
                {superseded ? `Ersatt · ${STATUS_LABEL[report.status].toLowerCase()}` : STATUS_LABEL[report.status]}
              </Badge>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
              Skapad {datumKort(report.generatedAt)}
              {report.reviewedAt ? ` · granskad ${datumKort(report.reviewedAt)}` : ""}
              {report.signedAt ? ` · signerad ${datumKort(report.signedAt)}` : ""}
              {report.markedFiledAt ? ` · markerad som inlämnad ${datumKort(report.markedFiledAt)}` : ""}
            </p>
          </div>
          {superseded ? null : (
            <AnnualReportStatusButton reportId={report.id} status={report.status} blockers={blockers} />
          )}
        </div>
        <p className="mt-4 border-t border-line/60 pt-3 text-[12px] leading-relaxed text-muted">
          Driva lämnar inte in årsredovisningen. Skriv ut A4-vyn, låt styrelsen skriva under, låt stämman fastställa
          räkningarna och lämna in den bestyrkta kopian hos Bolagsverket. Statusen här är en markering med spårbarhet.
        </p>
      </Card>

      <IxbrlCard report={report} />

      {superseded ? null : (
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
      )}

      <Card className="overflow-hidden p-0">
        <AnnualReportDocument report={report} company={settings} />
      </Card>

      {supersededOthers.length > 0 ? (
        <Card className="mt-6 px-6 py-5">
          <h2 className="text-[15px] font-semibold">Tidigare årsredovisningar för {fy.label}</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
            Året har stängts mer än en gång. De tidigare rapporterna är ersatta men står kvar – en av dem kan vara den
            som styrelsen skrev under, och då ska den gå att läsa i efterhand.
          </p>
          <ul className="mt-3 space-y-1.5">
            {supersededOthers.map((r) => (
              <li key={r.id} className="text-[13px] leading-relaxed">
                <Link
                  href={`/bokforing/bokslut/arsredovisning/${fiscalYearId}?rapport=${r.id}`}
                  className="font-medium text-accent hover:underline"
                >
                  Upprättad {datumKort(r.generatedAt)}
                </Link>
                <span className="text-soft">
                  {" · "}
                  {STATUS_LABEL[r.status].toLowerCase()}
                  {r.supersededAt ? ` · ersatt ${datumKort(r.supersededAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Filen till Bolagsverkets e-tjänst: årsredovisningen som iXBRL. Det som saknas
 * för att den ska tas emot står här och inte först i e-tjänsten – en handling
 * utan underskrifter eller fastställelseintyg avvisas, och det är en uppgift
 * Driva redan känner.
 */
function IxbrlCard({ report }: { report: AnnualReport }) {
  const blockers = ixbrlBlockers(report);
  let warnings: string[] = [];
  let error: string | undefined;
  try {
    warnings = ixbrlForAnnualReport(report.id).warnings;
  } catch (e) {
    error = e instanceof Error ? e.message : "Filen kunde inte skapas.";
  }

  return (
    <Card className="mb-6 px-6 py-5">
      <h2 className="text-[15px] font-semibold">Digital inlämning (iXBRL)</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
        Bolagsverket tar emot årsredovisningen som en fil där varje siffra är märkt med sitt begrepp i K2-taxonomin för
        aktiebolag. Filen innehåller samma dokument som A4-vyn – förvaltningsberättelse, resultat- och balansräkning,
        noter, underskrifter och fastställelseintyget.
      </p>
      {error ? (
        <p className="mt-3 text-[13px] leading-relaxed text-warn">{error}</p>
      ) : blockers.length > 0 ? (
        <div className="mt-3 rounded-xl border border-warn/40 bg-warn/5 px-4 py-3">
          <p className="text-[13px] font-medium">Innan filen går att lämna in</p>
          <ul className="mt-1.5 space-y-1">
            {blockers.map((b, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-soft">
                {b}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-3">
          <a
            href={`/api/bokforing/deklaration?typ=arsredovisning&rapport=${report.id}`}
            className="text-[13px] font-medium text-accent hover:underline"
          >
            Hämta iXBRL-filen
          </a>
        </div>
      )}
      {warnings.length > 0 ? (
        <div className="mt-3 border-t border-line/60 pt-3">
          <p className="text-[12px] font-medium text-muted">Innehåll som lämnades otaggat</p>
          <ul className="mt-1 space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-[12px] leading-relaxed text-muted">
                {w}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* Panelen visas först när filen går att bygga: annars är blockerarna ovan svaret. */}
      {error || blockers.length > 0 ? null : (
        <InlamningPanel {...filingPanelData("arsredovisning", report.id)} className="mt-4" />
      )}
    </Card>
  );
}
