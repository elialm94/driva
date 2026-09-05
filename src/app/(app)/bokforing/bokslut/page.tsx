import Link from "next/link";
import { Check, CircleAlert, FileText, Lock, Wrench } from "lucide-react";
import { db } from "@/lib/store";
import { kr, datumKort } from "@/lib/format";
import { Badge, Card, PageHeader, SectionTitle, buttonClasses, cx } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import {
  BokslutAutomationButton,
  CloseFiscalYearButton,
  GenerateAnnualReportButton,
  PlanAccrualForm,
  PrintButton,
  ReopenFiscalYearButton,
} from "@/components/bokforing-widgets";
import { fiscalYears } from "@/lib/accounting/fiscal";
import { bokslutChecklist, reopenBlockers } from "@/lib/accounting/close";
import { listAssets, bookValue, assetsNeedingDepreciation, accumulatedDepreciation } from "@/lib/accounting/assets";
import { pendingAccruals, accrualSuggestions } from "@/lib/accounting/accruals";
import { computeTaxCalculation } from "@/lib/accounting/tax";
import { annualReportFor, annualReportHistory } from "@/lib/accounting/annual-report";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Bokslut" };

// Mänskliga ord: rapporten är "skapad" – inte "genererad" (systemperspektiv).
const AR_STATUS_LABEL: Record<string, string> = {
  genererad: "Skapad",
  granskad: "Granskad",
  signerad: "Signerad",
  inlamnad_markerad: "Markerad som inlämnad",
};

export default async function BokslutPage() {
  await ensurePageBusiness();
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
    <div>
      <PageHeader
        back={<SmartBack />}
        title="Bokslut"
        subtitle="Driva kontrollerar allt som går att kontrollera automatiskt – du ser bara det som faktiskt behöver dig."
        actions={<PrintButton />}
      />

      {fy ? (
        <>
          {/* Checklista */}
          <SectionTitle>Bokslut {fy.label}</SectionTitle>
          {/*
            Är året öppnat igen står man här en andra gång. Skälet hör hit: det
            är svaret på "varför gör jag om det här?".
          */}
          {fy.reopenings?.length ? (
            <Card className="mb-4 border-warn/40 bg-warn-soft/50 px-6 py-4">
              <p className="text-[13.5px] font-medium">
                {fy.label} är öppnat igen – bokslutet görs om
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-soft">
                {fy.reopenings[fy.reopenings.length - 1].reason} Bokslutsposterna från förra stängningen är återförda, så
                årets resultat och skatten räknas om när året stängs igen.
                {annualReportHistory(fy.id).length > 0
                  ? " Den förra årsredovisningen är markerad som ersatt; en ny upprättas efter stängningen."
                  : ""}
              </p>
            </Card>
          ) : null}
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
                            {/* Namnge destinationen – aldrig vaga "Åtgärda". */}
                            <Link href={c.href as never} className="font-medium text-accent hover:underline">
                              {c.hrefLabel ?? "Visa"}
                            </Link>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-4 border-t border-line/60 pt-3 text-[13px]">
              <Link href="/bokforing/bokslut/bilagor" className="font-medium text-accent hover:underline">
                Bokslutsbilagor
              </Link>
              <Link href="/bokforing/bokslut/avstamning" className="font-medium text-accent hover:underline">
                Avstämning per balanskonto
              </Link>
            </div>
            <div className="mt-4 border-t border-line/60 pt-4">
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
              /*
               * Ersatta rapporter från tidigare stängningar. Länken hit måste
               * finnas kvar även när en ny rapport upprättats – den ersatta kan
               * vara den som skrevs under, och då ska den gå att läsa.
               */
              const supersededReports = annualReportHistory(f.id).filter((r) => r.supersededAt);
              const supersededLink =
                supersededReports.length > 0 ? (
                  <p className="mt-3 text-[12.5px] text-muted">
                    <Link
                      href={`/bokforing/bokslut/arsredovisning/${f.id}?rapport=${supersededReports[0].id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {supersededReports.length === 1
                        ? "Läs den ersatta årsredovisningen"
                        : `Läs de ${supersededReports.length} ersatta årsredovisningarna`}
                    </Link>
                  </p>
                ) : null;
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
                      <p className="text-[13px] leading-relaxed text-soft">
                        Resultaträkning, balansräkning, noter och förvaltningsberättelse är upprättade. Texterna,
                        underskrifterna och fastställelseintyget fylls i på årsredovisningens egen sida.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-4">
                        <Link
                          href={`/bokforing/bokslut/arsredovisning/${f.id}`}
                          className={buttonClasses("secondary", "sm")}
                        >
                          Öppna årsredovisningen
                        </Link>
                        <Link
                          href={`/bokforing/bokslut/arsredovisning/${f.id}/pdf`}
                          className="text-[13px] font-medium text-accent hover:underline"
                        >
                          <FileText className="mr-1 inline size-3.5" />
                          Visa som A4
                        </Link>
                      </div>
                      {supersededLink}
                    </div>
                  ) : (
                    <div className="mt-4">
                      <p className="mb-3 text-[13px] text-soft">
                        {supersededReports.length > 0
                          ? "Året har öppnats efter att förra årsredovisningen upprättades, så den är ersatt. En ny upprättas ur de nya siffrorna."
                          : "Årsredovisningen genereras ur de fastställda siffrorna – resultaträkning, balansräkning, noter och utkast till förvaltningsberättelse."}
                      </p>
                      <GenerateAnnualReportButton fiscalYearId={f.id} />
                      {supersededLink}
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

                  {/*
                    Ett fel i ett stängt år ska inte vara permanent. Vägen tillbaka
                    ligger sist och lågmält: den ska finnas, inte inbjuda.
                  */}
                  {f.reopenings?.length ? (
                    <div className="mt-4 border-t border-line/60 pt-3">
                      <p className="text-[12.5px] font-medium text-soft">
                        Året har öppnats {f.reopenings.length === 1 ? "en gång" : `${f.reopenings.length} gånger`}
                      </p>
                      <ul className="mt-1 space-y-1">
                        {f.reopenings.map((r, i) => (
                          <li key={i} className="text-[12px] leading-relaxed text-muted">
                            {datumKort(r.at)}: {r.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="mt-3 flex">
                    <ReopenFiscalYearButton
                      fiscalYearId={f.id}
                      yearLabel={f.label}
                      hasReport={Boolean(report)}
                      blockers={reopenBlockers(f.id).map((b) => b.detail)}
                    />
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
