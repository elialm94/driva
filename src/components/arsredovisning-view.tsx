import Link from "next/link";
import { Badge, Card, buttonClasses } from "./ui";
import { AnnualReportStatusButton } from "./bokforing-widgets";
import { AnnualReportDocument } from "./annual-report-document";
import { CertificationForm, NarrativeForm, SignatoriesForm } from "./arsredovisning-widgets";
import { InlamningPanel } from "./inlamning";
import { db } from "@/lib/store";
import { datumKort } from "@/lib/format";
import { getFiscalYear } from "@/lib/accounting/fiscal";
import { annualReportBlockers, annualReportHistory, resolveAnnualReport } from "@/lib/accounting/annual-report";
import { ixbrlBlockers, ixbrlForAnnualReport } from "@/lib/accounting/ixbrl";
import { filingPanelData } from "@/lib/filing/view";
import type { AnnualReport, FiscalYear } from "@/lib/types";

/**
 * Årsredovisningen för ett stängt räkenskapsår: dokumentet som det kommer att
 * se ut, och det som går att ändra i det.
 *
 * Siffrorna står inte att ändra här. De kommer ur den stängda bokföringen, och
 * en årsredovisning som säger något annat än böckerna vore en osanning. Det som
 * går att skriva är bolagets egna påståenden – verksamheten, årets händelser,
 * utdelningsförslaget, underskrifterna och fastställelseintyget.
 *
 * Samma vy på ägarytan och konsultytan: konsulten upprättar årsredovisningen,
 * och en förenklad kopia av den vore en yta som alltid ligger efter.
 */

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

/** Året och rapporten sidan visar, eller null när något av dem inte finns. */
export function annualReportPageData(
  fiscalYearId: string,
  reportId?: string
): { fy: FiscalYear; report: AnnualReport } | null {
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) return null;
  /*
   * En ersatt rapport visas fortfarande. Den kan vara undertecknad och inlämnad,
   * och då är den en handling som ska gå att läsa och skriva ut i efterhand –
   * men den är låst och märkt, för den beskriver inte längre böckerna.
   */
  const report = resolveAnnualReport(fiscalYearId, reportId);
  if (!report) return null;
  return { fy, report };
}

export interface ArsredovisningViewProps {
  fy: FiscalYear;
  report: AnnualReport;
  /** Bokslutets bas på ytan, t.ex. "/bokforing/bokslut". */
  base: string;
  /** Klienten rapporten hör till. Konsultytan skickar den. */
  businessId?: string;
  /** Revisorn läser rapporten men ändrar den inte. */
  readOnly?: boolean;
}

export function ArsredovisningView({ fy, report, base, businessId, readOnly }: ArsredovisningViewProps) {
  const superseded = Boolean(report.supersededAt);
  const history = annualReportHistory(fy.id);
  const current = superseded ? history.find((r) => !r.supersededAt) : undefined;
  const supersededOthers = history.filter((r) => r.supersededAt && r.id !== report.id);
  const pdfHref = `${base}/arsredovisning/${fy.id}/pdf${superseded ? `?rapport=${report.id}` : ""}`;

  const settings = db().settings;
  const locked = readOnly || superseded || report.status === "signerad" || report.status === "inlamnad_markerad";
  const next = superseded ? undefined : NEXT_STATUS[report.status];
  const blockers = next ? annualReportBlockers(report, next) : [];
  const fb = report.content.forvaltningsberattelse;

  return (
    <>
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
              <Link href={`${base}/arsredovisning/${fy.id}` as never} className={buttonClasses("secondary", "sm")}>
                Läs den gällande årsredovisningen
              </Link>
            ) : (
              <Link href={base as never} className={buttonClasses("secondary", "sm")}>
                Till bokslutet
              </Link>
            )}
            <Link href={pdfHref as never} className="text-[13px] font-medium text-accent hover:underline">
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
          {superseded || readOnly ? null : (
            <AnnualReportStatusButton
              reportId={report.id}
              status={report.status}
              blockers={blockers}
              businessId={businessId}
            />
          )}
        </div>
        <p className="mt-4 border-t border-line/60 pt-3 text-[12px] leading-relaxed text-muted">
          Statusen här är en markering med spårbarhet: skriv ut A4-vyn, låt styrelsen skriva under och låt stämman
          fastställa räkningarna. Den bestyrkta kopian lämnas in hos Bolagsverket – digitalt med filen nedan, eller på
          papper.
        </p>
      </Card>

      <IxbrlCard report={report} businessId={businessId} readOnly={readOnly} />

      {superseded || readOnly ? null : (
        <div className="mb-6 space-y-4">
          <NarrativeForm
            reportId={report.id}
            verksamhet={fb.verksamhet}
            vasentligaHandelser={fb.vasentligaHandelser}
            tillForfogande={fb.resultatdisposition.tillForfogande}
            utdelning={fb.resultatdisposition.utdelning}
            locked={locked}
            businessId={businessId}
          />
          <SignatoriesForm
            reportId={report.id}
            signatories={report.content.underskrifter ?? []}
            locked={locked}
            businessId={businessId}
          />
          <CertificationForm
            reportId={report.id}
            certification={report.content.fastallelseintyg}
            signatories={report.content.underskrifter ?? []}
            locked={locked}
            businessId={businessId}
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
                  href={`${base}/arsredovisning/${fy.id}?rapport=${r.id}` as never}
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
    </>
  );
}

/**
 * Filen till Bolagsverkets e-tjänst: årsredovisningen som iXBRL. Det som saknas
 * för att den ska tas emot står här och inte först i e-tjänsten – en handling
 * utan underskrifter eller fastställelseintyg avvisas, och det är en uppgift
 * Driva redan känner.
 */
function IxbrlCard({
  report,
  businessId,
  readOnly,
}: {
  report: AnnualReport;
  businessId?: string;
  readOnly?: boolean;
}) {
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
      {error || blockers.length > 0 || readOnly ? null : (
        <InlamningPanel {...filingPanelData("arsredovisning", report.id)} businessId={businessId} className="mt-4" />
      )}
    </Card>
  );
}
