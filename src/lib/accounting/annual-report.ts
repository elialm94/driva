import { db, save } from "../store";
import { uid } from "../ids";
import type { AnnualReport, AnnualReportContent, FiscalYear, ReportRow } from "../types";
import { getFiscalYear } from "./fiscal";
import { resultatrapport, balansrapport, saldobalans } from "./ledger";
import { logAudit } from "./audit";
import { kr } from "../format";

/**
 * Årsredovisning (litet AB, K2-orienterad uppställning).
 *
 * Alla SIFFROR kommer från motorn (saldobalans/resultat/balans för det stängda
 * året). Texterna i förvaltningsberättelsen är utkast som användaren granskar.
 * Ingen riktig inlämning sker: statusen "inlamnad_markerad" är en manuell
 * markering med audit trail – aldrig ett påstående om att Bolagsverket tagit emot.
 */

export function annualReportFor(fiscalYearId: string): AnnualReport | undefined {
  return db().annualReports.find((r) => r.fiscalYearId === fiscalYearId);
}

function sumUb(rows: { account: number; ub: number }[], from: number, to: number, sign: 1 | -1): number {
  return rows.filter((r) => r.account >= from && r.account <= to).reduce((s, r) => s + sign * r.ub, 0);
}

export function generateAnnualReport(fiscalYearId: string, by: "anvandare" | "assistent"): AnnualReport {
  const data = db();
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) throw new Error("Räkenskapsåret finns inte.");
  if (data.settings.companyForm === "enskild") {
    throw new Error(
      "Enskild firma upprättar normalt ingen årsredovisning – bara ett förenklat årsbokslut. Detta stöds inte automatiskt ännu."
    );
  }
  if (fy.status !== "stangt") {
    throw new Error(
      `Räkenskapsåret ${fy.label} är inte stängt ännu. Gör klart bokslutet först – årsredovisningen bygger på de fastställda siffrorna.`
    );
  }

  const existing = annualReportFor(fiscalYearId);
  if (existing) return existing;

  const range = { from: fy.startDate, to: fy.endDate };
  const rr = resultatrapport(range);
  const br = balansrapport(fy.endDate);
  const sb = saldobalans(range);

  const avskrivningar = rr.avskrivningar.reduce((s, r) => s + r.amount, 0);
  const externaKostnader = rr.kostnader.reduce((s, r) => s + r.amount, 0);

  // K2-uppställning, förenklad till de poster ett litet tjänste-AB faktiskt har.
  const resultatrakning: ReportRow[] = [
    { label: "Nettoomsättning", amount: rr.omsattning, note: 1 },
    { label: "Övriga externa kostnader", amount: -externaKostnader },
    ...(avskrivningar !== 0
      ? [{ label: "Avskrivningar av materiella anläggningstillgångar", amount: -avskrivningar, note: 2 }]
      : []),
    { label: "Rörelseresultat", amount: rr.resultatForeSkatt, bold: true },
    { label: "Resultat efter finansiella poster", amount: rr.resultatForeSkatt, bold: true },
    ...(rr.skatt !== 0 ? [{ label: "Skatt på årets resultat", amount: -rr.skatt }] : []),
    { label: "Årets resultat", amount: rr.resultat, bold: true },
  ];

  const inventarier = sumUb(sb.rows, 1200, 1299, 1);
  const kundfordringar = sumUb(sb.rows, 1500, 1599, 1);
  const ovrigaFordringar = sumUb(sb.rows, 1600, 1799, 1);
  const kassaBank = sumUb(sb.rows, 1900, 1999, 1);
  const balansrakningTillgangar: ReportRow[] = [
    ...(inventarier !== 0 ? [{ label: "Inventarier, verktyg och installationer", amount: inventarier, note: 2 }] : []),
    ...(kundfordringar !== 0 ? [{ label: "Kundfordringar", amount: kundfordringar }] : []),
    ...(ovrigaFordringar !== 0 ? [{ label: "Övriga fordringar och förutbetalda kostnader", amount: ovrigaFordringar }] : []),
    { label: "Kassa och bank", amount: kassaBank },
    { label: "Summa tillgångar", amount: br.sumTillgangar, bold: true },
  ];

  const aktiekapital = sumUb(sb.rows, 2081, 2081, -1);
  const balanserat = sumUb(sb.rows, 2091, 2098, -1);
  const aretsResultat = sumUb(sb.rows, 2099, 2099, -1);
  const balansrakningEgetKapitalSkulder: ReportRow[] = [
    { label: "Aktiekapital", amount: aktiekapital },
    { label: "Balanserat resultat", amount: balanserat },
    { label: "Årets resultat", amount: aretsResultat },
    { label: "Summa eget kapital", amount: br.sumEgetKapital, bold: true },
    { label: "Kortfristiga skulder", amount: br.sumSkulder },
    { label: "Summa eget kapital och skulder", amount: br.sumEgetKapital + br.sumSkulder, bold: true },
  ];

  const soliditet = br.sumTillgangar > 0 ? Math.round((br.sumEgetKapital / br.sumTillgangar) * 100) : 0;
  const tillForfogande = balanserat + aretsResultat;

  const content: AnnualReportContent = {
    companyName: data.settings.name,
    orgNumber: data.settings.orgNumber,
    fiscalLabel: fy.label,
    periodStart: fy.startDate,
    periodEnd: fy.endDate,
    forvaltningsberattelse: {
      verksamhet: `${data.settings.name} bedriver hantverks- och tjänsteverksamhet. Bolaget har sitt säte i ${data.settings.sate || data.settings.city}. (Utkast – granska och justera texten.)`,
      vasentligaHandelser:
        "Inga väsentliga händelser utöver den löpande verksamheten har inträffat under räkenskapsåret. (Utkast – granska och justera texten.)",
      flerarsoversikt: [
        {
          label: fy.label,
          nettoomsattning: rr.omsattning,
          resultatEfterFinansiella: rr.resultatForeSkatt,
          soliditetProcent: soliditet,
        },
      ],
      resultatdisposition: {
        tillForfogande,
        balanserasINyRakning: tillForfogande,
      },
    },
    resultatrakning,
    balansrakningTillgangar,
    balansrakningEgetKapitalSkulder,
    noter: [
      {
        title: "Not 1 – Redovisningsprinciper",
        body: "Årsredovisningen är upprättad i enlighet med årsredovisningslagen och Bokföringsnämndens allmänna råd BFNAR 2016:10 (K2). Intäkter redovisas när fakturering skett. Belopp anges i hela kronor.",
      },
      ...(inventarier !== 0 || avskrivningar !== 0
        ? [
            {
              title: "Not 2 – Inventarier, verktyg och installationer",
              body: `Inventarier skrivs av linjärt över nyttjandeperioden. Årets avskrivningar uppgår till ${kr(avskrivningar)}. Redovisat värde vid årets slut: ${kr(inventarier)}.`,
            },
          ]
        : []),
    ],
  };

  const report: AnnualReport = {
    id: uid(),
    fiscalYearId,
    status: "genererad",
    content,
    generatedAt: new Date().toISOString(),
  };
  data.annualReports.push(report);
  logAudit(by, "arsredovisning_genererad", `Årsredovisning för ${fy.label} genererades ur bokslutet.`, {
    targetType: "arsredovisning",
    targetId: report.id,
  });
  save();
  return report;
}

const STATUS_ORDER: AnnualReport["status"][] = ["genererad", "granskad", "signerad", "inlamnad_markerad"];

export function advanceAnnualReportStatus(reportId: string, to: AnnualReport["status"], by: "anvandare"): AnnualReport {
  const report = db().annualReports.find((r) => r.id === reportId);
  if (!report) throw new Error("Årsredovisningen finns inte.");
  const fromIdx = STATUS_ORDER.indexOf(report.status);
  const toIdx = STATUS_ORDER.indexOf(to);
  if (toIdx !== fromIdx + 1)
    throw new Error("Stegen tas i ordning: genererad → granskad → signerad → markerad som inlämnad.");
  report.status = to;
  const now = new Date().toISOString();
  if (to === "granskad") report.reviewedAt = now;
  if (to === "signerad") report.signedAt = now;
  if (to === "inlamnad_markerad") report.markedFiledAt = now;
  logAudit(
    by,
    "arsredovisning_status",
    `Årsredovisningen markerades som ${to === "inlamnad_markerad" ? "inlämnad (egen markering – Driva skickar inget till Bolagsverket)" : to}.`,
    { targetType: "arsredovisning", targetId: report.id }
  );
  save();
  return report;
}

/** Stängda räkenskapsår – kandidater för årsredovisning. */
export function annualReportCandidates(): FiscalYear[] {
  return db().fiscalYears.filter((f) => f.status === "stangt");
}
