import Link from "next/link";
import { Check, CircleAlert, FileText, Lock, Wrench } from "lucide-react";
import { db } from "@/lib/store";
import { kr, datumKort, datumLang } from "@/lib/format";
import { Badge, Card, PageHeader, SectionTitle, cx } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import {
  BokslutAutomationButton,
  CloseFiscalYearButton,
  GenerateAnnualReportButton,
  AnnualReportStatusButton,
  PlanAccrualForm,
  PrintButton,
} from "@/components/bokforing-widgets";
import { BokforingAdvancedTabs } from "@/components/bokforing-advanced-nav";
import { fiscalYears } from "@/lib/accounting/fiscal";
import { bokslutChecklist } from "@/lib/accounting/close";
import { listAssets, bookValue, assetsNeedingDepreciation, accumulatedDepreciation } from "@/lib/accounting/assets";
import { pendingAccruals, accrualSuggestions } from "@/lib/accounting/accruals";
import { computeTaxCalculation } from "@/lib/accounting/tax";
import { annualReportFor } from "@/lib/accounting/annual-report";
import type { ReportRow } from "@/lib/types";

export const metadata = { title: "Bokslut" };

const AR_STATUS_LABEL: Record<string, string> = {
  genererad: "Genererad",
  granskad: "Granskad",
  signerad: "Signerad",
  inlamnad_markerad: "Markerad som inlämnad",
};

function ReportTable({ rows }: { rows: ReportRow[] }) {
  return (
    <table className="w-full text-[13px]">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={cx("border-t border-line/50", r.bold && "font-semibold")}>
            <td className="py-1.5 pr-3">
              {r.label}
              {r.note ? <sup className="ml-1 text-[10px] text-muted">{r.note}</sup> : null}
            </td>
            <td className="py-1.5 text-right tabular">{kr(r.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function BokslutPage() {
  const data = db();
  const years = fiscalYears();
  const openYears = years.filter((f) => f.status === "oppet");
  const closedYears = years.filter((f) => f.status === "stangt").reverse();
  // Bokslut görs för det äldsta öppna året.
  const fy = openYears[0];
  const companyForm = data.settings.companyForm ?? "ab";

  const checklist = fy ? bokslutChecklist(fy.id) : [];
  const blockers = checklist.filter((c) => c.blocking && !c.ok);
  const needsDepreciation = fy ? assetsNeedingDepreciation(fy.id) : [];
  const accrualsPlanned = fy ? pendingAccruals(fy.id) : [];
  const suggestions = fy ? accrualSuggestions(fy.id) : [];
  const assets = listAssets();
  const tax = fy && companyForm === "ab" ? computeTaxCalculation(fy) : undefined;
  const hasAutomation = needsDepreciation.length > 0 || accrualsPlanned.length > 0;

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<BackLink fallbackHref="/bokforing" fallbackLabel="Bokföring" />}
        title="Bokslut"
        subtitle="Driva kontrollerar allt som går att kontrollera automatiskt – du ser bara det som faktiskt behöver dig."
        actions={<PrintButton />}
      />
      <BokforingAdvancedTabs />

      {fy ? (
        <>
          {/* Checklista */}
          <SectionTitle>Bokslut {fy.label}</SectionTitle>
          <Card className="mb-6 px-6 py-5">
            <ul className="space-y-2.5">
              {checklist.map((c) => (
                <li key={c.key} className="flex items-start gap-2.5 text-[14px]">
                  {c.ok ? (
                    <Check className="mt-0.5 size-4.5 shrink-0 text-ok" />
                  ) : (
                    <CircleAlert className={cx("mt-0.5 size-4.5 shrink-0", c.blocking ? "text-warn" : "text-muted")} />
                  )}
                  <span>
                    <span className={c.ok ? "text-soft" : "font-medium"}>{c.label}</span>
                    {c.detail ? (
                      <span className="block text-[12.5px] text-muted">
                        {c.detail}
                        {!c.ok && c.href ? (
                          <>
                            {" "}
                            <Link href={c.href as never} className="font-medium text-accent hover:underline">
                              Åtgärda
                            </Link>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-5 border-t border-line/60 pt-4">
              <CloseFiscalYearButton
                fiscalYearId={fy.id}
                label={`Slutför bokslut ${fy.label}`}
                disabled={blockers.length > 0}
              />
              {blockers.length > 0 ? (
                <p className="mt-2 text-[12.5px] text-muted">
                  {blockers.length} punkt{blockers.length > 1 ? "er" : ""} behöver bli klar{blockers.length > 1 ? "a" : ""}{" "}
                  innan året kan stängas.
                </p>
              ) : (
                <p className="mt-2 text-[12.5px] text-muted">
                  Allt är klart. När året stängs bokförs {companyForm === "ab" ? "beräknad bolagsskatt och " : ""}årets
                  resultat mot eget kapital, {Number(fy.label) + 1} får ingående balanser och året låses.
                </p>
              )}
            </div>
          </Card>

          {/* Att bokföra i bokslutet */}
          {hasAutomation ? (
            <Card className="mb-6 px-6 py-5">
              <div className="flex items-center gap-2.5">
                <Wrench className="size-4.5 text-muted" />
                <h3 className="text-[15px] font-semibold">Att bokföra i bokslutet</h3>
              </div>
              <ul className="mt-3 space-y-1.5 text-[13.5px]">
                {needsDepreciation.map(({ asset, amount }) => (
                  <li key={asset.id} className="flex justify-between gap-3">
                    <span className="text-soft">Avskrivning: {asset.name}</span>
                    <span className="font-medium tabular">{kr(amount)}</span>
                  </li>
                ))}
                {accrualsPlanned.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3">
                    <span className="text-soft">Periodisering: {a.description}</span>
                    <span className="font-medium tabular">{kr(a.amount)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <BokslutAutomationButton fiscalYearId={fy.id} />
              </div>
            </Card>
          ) : null}

          {/* Periodiseringsförslag */}
          {suggestions.length > 0 ? (
            <Card className="mb-6 px-6 py-5">
              <h3 className="text-[15px] font-semibold">Ser ut att gälla en längre period</h3>
              <p className="mt-0.5 text-[13px] text-soft">
                De här köpen ser ut att avse mer än det här räkenskapsåret. Ange vilken period de gäller så flyttar Driva
                rätt del över bokslutet – du behöver aldrig se debet och kredit.
              </p>
              <div className="mt-4 space-y-4">
                {suggestions.map((s) => (
                  <div key={s.sourceId} className="rounded-xl bg-canvas/70 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[14px] font-medium">{s.description}</p>
                      <p className="text-[13px] tabular text-soft">{kr(s.amount)} exkl. moms</p>
                    </div>
                    <div className="mt-2.5">
                      <PlanAccrualForm
                        sourceType={s.sourceType}
                        sourceId={s.sourceId}
                        fiscalYearId={fy.id}
                        defaultFrom={`${fy.label}-09-01`}
                        defaultTo={`${Number(fy.label) + 1}-08-31`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {/* Skatt (AB) */}
          {tax ? (
            <Card className="mb-6 px-6 py-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-semibold">Beräknad bolagsskatt {fy.label}</h3>
                <Badge tone="neutral">Uppskattad/preliminär</Badge>
              </div>
              <div className="mt-3 space-y-1.5 rounded-xl bg-canvas/70 px-4 py-3 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-soft">Resultat före skatt (bokföringen)</span>
                  <span className="font-medium tabular">{kr(tax.redovisningsresultat)}</span>
                </div>
                {tax.adjustments.map((a) => (
                  <div key={a.key} className="flex justify-between">
                    <span className="text-soft">+ {a.label}</span>
                    <span className="font-medium tabular">{kr(a.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-line pt-1.5">
                  <span className="font-medium">Beskattningsbart resultat</span>
                  <span className="font-semibold tabular">{kr(tax.beskattningsbartResultat)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Beräknad skatt (20,6 %)</span>
                  <span className="font-semibold tabular">{kr(tax.beraknadSkatt)}</span>
                </div>
              </div>
              {tax.adjustments.length > 0 ? (
                <details className="group mt-3">
                  <summary className="cursor-pointer list-none text-[13px] font-medium text-accent hover:underline">
                    Visa detaljer om justeringarna
                  </summary>
                  <ul className="mt-2 space-y-1.5 text-[12.5px] text-soft">
                    {tax.adjustments.map((a) => (
                      <li key={a.key}>
                        <span className="font-medium text-ink">{a.label}:</span> {a.explanation}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {tax.manualReviewNotes.length > 0 ? (
                <div className="mt-3 rounded-xl bg-warn-soft/60 px-4 py-3">
                  {tax.manualReviewNotes.map((n, i) => (
                    <p key={i} className="text-[12.5px] text-ink">
                      ⚠ {n}
                    </p>
                  ))}
                </div>
              ) : null}
              <p className="mt-3 text-[12px] text-muted">
                Skatten bokförs automatiskt när bokslutet slutförs. Siffran är preliminär tills inkomstdeklarationen (INK2)
                är lämnad.
              </p>
            </Card>
          ) : null}
        </>
      ) : (
        <Card className="mb-6 px-6 py-5">
          <p className="text-[14px] text-soft">Alla räkenskapsår är stängda. Ett nytt år öppnas automatiskt vid nästa bokförda händelse.</p>
        </Card>
      )}

      {/* Inventarier */}
      {assets.length > 0 ? (
        <>
          <SectionTitle>Inventarier</SectionTitle>
          <Card className="mb-6 overflow-x-auto px-5 py-4">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <th className="pb-1.5 font-semibold">Inventarie</th>
                  <th className="pb-1.5 font-semibold">Anskaffad</th>
                  <th className="pb-1.5 text-right font-semibold">Anskaffningsvärde</th>
                  <th className="pb-1.5 text-right font-semibold">Avskrivet</th>
                  <th className="pb-1.5 text-right font-semibold">Bokfört värde</th>
                  <th className="pb-1.5 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id} className="border-t border-line/50">
                    <td className="py-1.5 pr-3">
                      {a.name}
                      <span className="block text-[11px] text-muted">{a.usefulLifeYears} års avskrivningstid</span>
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{datumKort(a.acquisitionDate)}</td>
                    <td className="py-1.5 text-right tabular">{kr(a.acquisitionValue)}</td>
                    <td className="py-1.5 text-right tabular">{kr(accumulatedDepreciation(a))}</td>
                    <td className="py-1.5 text-right font-medium tabular">{kr(bookValue(a))}</td>
                    <td className="py-1.5 text-right">
                      <Badge tone={a.status === "aktiv" ? "ok" : "neutral"}>
                        {a.status === "aktiv" ? "Aktiv" : a.status === "fullt_avskriven" ? "Fullt avskriven" : "Utrangerad"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}

      {/* Stängda år + årsredovisning */}
      {closedYears.length > 0 ? (
        <>
          <SectionTitle>Stängda räkenskapsår</SectionTitle>
          <div className="space-y-4">
            {closedYears.map((f) => {
              const report = annualReportFor(f.id);
              return (
                <Card key={f.id} className="px-6 py-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Lock className="size-4.5 text-muted" />
                      <h3 className="text-[15px] font-semibold">Räkenskapsåret {f.label}</h3>
                      <Badge tone="neutral">Stängt {f.closedAt ? datumKort(f.closedAt) : ""}</Badge>
                    </div>
                    {report ? (
                      <Badge tone={report.status === "inlamnad_markerad" ? "ok" : "info"}>
                        Årsredovisning: {AR_STATUS_LABEL[report.status]}
                      </Badge>
                    ) : null}
                  </div>

                  {companyForm === "enskild" ? (
                    <p className="mt-3 text-[13px] text-soft">
                      Enskild firma upprättar normalt ingen årsredovisning. Resultatet följer med till din privata
                      inkomstdeklaration (NE-bilagan) – det stöds inte automatiskt ännu.
                    </p>
                  ) : report ? (
                    <div className="mt-4">
                      <details className="group">
                        <summary className="cursor-pointer list-none text-[13px] font-medium text-accent hover:underline">
                          Visa årsredovisning {f.label}
                        </summary>
                        <div className="mt-4 space-y-5 rounded-xl bg-canvas/70 px-5 py-4">
                          <div>
                            <h4 className="text-[14px] font-semibold">Förvaltningsberättelse</h4>
                            <p className="mt-1.5 text-[13px] leading-relaxed text-soft">{report.content.forvaltningsberattelse.verksamhet}</p>
                            <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
                              {report.content.forvaltningsberattelse.vasentligaHandelser}
                            </p>
                            <table className="mt-3 w-full max-w-md text-[13px]">
                              <thead>
                                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                                  <th className="pb-1 font-semibold">Flerårsöversikt</th>
                                  {report.content.forvaltningsberattelse.flerarsoversikt.map((r) => (
                                    <th key={r.label} className="pb-1 text-right font-semibold">
                                      {r.label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="border-t border-line/50">
                                  <td className="py-1">Nettoomsättning</td>
                                  {report.content.forvaltningsberattelse.flerarsoversikt.map((r) => (
                                    <td key={r.label} className="py-1 text-right tabular">
                                      {kr(r.nettoomsattning)}
                                    </td>
                                  ))}
                                </tr>
                                <tr className="border-t border-line/50">
                                  <td className="py-1">Resultat efter finansiella poster</td>
                                  {report.content.forvaltningsberattelse.flerarsoversikt.map((r) => (
                                    <td key={r.label} className="py-1 text-right tabular">
                                      {kr(r.resultatEfterFinansiella)}
                                    </td>
                                  ))}
                                </tr>
                                <tr className="border-t border-line/50">
                                  <td className="py-1">Soliditet</td>
                                  {report.content.forvaltningsberattelse.flerarsoversikt.map((r) => (
                                    <td key={r.label} className="py-1 text-right tabular">
                                      {r.soliditetProcent} %
                                    </td>
                                  ))}
                                </tr>
                              </tbody>
                            </table>
                          </div>
                          <div className="grid gap-5 lg:grid-cols-2">
                            <div>
                              <h4 className="text-[14px] font-semibold">Resultaträkning</h4>
                              <ReportTable rows={report.content.resultatrakning} />
                            </div>
                            <div>
                              <h4 className="text-[14px] font-semibold">Balansräkning</h4>
                              <p className="mt-1 text-[12px] font-medium text-muted">Tillgångar</p>
                              <ReportTable rows={report.content.balansrakningTillgangar} />
                              <p className="mt-3 text-[12px] font-medium text-muted">Eget kapital och skulder</p>
                              <ReportTable rows={report.content.balansrakningEgetKapitalSkulder} />
                            </div>
                          </div>
                          <div>
                            <h4 className="text-[14px] font-semibold">Noter</h4>
                            {report.content.noter.map((n) => (
                              <p key={n.title} className="mt-1.5 text-[13px] leading-relaxed text-soft">
                                <span className="font-medium text-ink">{n.title}.</span> {n.body}
                              </p>
                            ))}
                          </div>
                          <div>
                            <h4 className="text-[14px] font-semibold">Resultatdisposition</h4>
                            <p className="mt-1.5 text-[13px] text-soft">
                              Till förfogande: {kr(report.content.forvaltningsberattelse.resultatdisposition.tillForfogande)} ·
                              balanseras i ny räkning:{" "}
                              {kr(report.content.forvaltningsberattelse.resultatdisposition.balanserasINyRakning)}
                            </p>
                          </div>
                        </div>
                      </details>
                      <div className="mt-3">
                        <AnnualReportStatusButton reportId={report.id} status={report.status} />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <p className="mb-3 text-[13px] text-soft">
                        Årsredovisningen genereras ur de fastställda siffrorna – resultaträkning, balansräkning, noter och
                        utkast till förvaltningsberättelse.
                      </p>
                      <GenerateAnnualReportButton fiscalYearId={f.id} />
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-4 border-t border-line/60 pt-3 text-[13px]">
                    <a href={`/api/bokforing/export?typ=sie&ar=${f.label}`} className="font-medium text-accent hover:underline">
                      <FileText className="mr-1 inline size-3.5" />
                      SIE-fil {f.label}
                    </a>
                    <a
                      href={`/api/bokforing/export?typ=saldobalans&ar=${f.label}`}
                      className="font-medium text-accent hover:underline"
                    >
                      Saldobalans CSV
                    </a>
                    <Link href={`/bokforing/saldobalans?ar=${f.label}`} className="font-medium text-accent hover:underline">
                      Visa saldobalans
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      ) : null}

      <p className="mt-6 text-[12px] leading-relaxed text-muted">
        Bokslutet är deterministiskt: avskrivningar, periodiseringar, skatt och resultatdisposition bokförs av motorn enligt
        fasta regler – aldrig av en gissning. Årsredovisningen lämnas in hos Bolagsverket av dig; Driva markerar bara status
        med full spårbarhet.
      </p>
    </div>
  );
}
