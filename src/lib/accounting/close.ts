import { db, save } from "../store";
import type { FiscalYear, Verification } from "../types";
import { bokforingsdatum, calendarFiscalYear, getFiscalYear, lockPeriod } from "./fiscal";
import { postVerification } from "./engine";
import { isResultAccount, saldobalans } from "./ledger";
import { assetsNeedingDepreciation, createDepreciationEntry } from "./assets";
import { pendingAccruals, bookAccrual, reverseAccrualsInto } from "./accruals";
import { computeTaxCalculation } from "./tax";
import { logAudit } from "./audit";
import { vatPeriods } from "./vat";
import { isOverdue } from "../services/data";

/**
 * Bokslut. Deterministiskt: alla kontroller körs på servern, bara riktiga
 * problem visas. Stängningen bokför skatt (AB) och årets resultat mot eget
 * kapital, skapar nästa räkenskapsår med UB→IB och låser året.
 */

export interface BokslutCheckItem {
  key: string;
  label: string;
  ok: boolean;
  /** Blockerar stängning (annars bara upplysning). */
  blocking: boolean;
  detail?: string;
  href?: string;
  /** Länketikett som namnger destinationen ("Öppna banken") – aldrig vaga "Åtgärda". */
  hrefLabel?: string;
}

export function bokslutChecklist(fiscalYearId: string): BokslutCheckItem[] {
  const data = db();
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) return [];
  const inYear = (date: string) => {
    const d = bokforingsdatum(date);
    return d >= fy.startDate && d <= fy.endDate;
  };

  const unbookedBank = data.bankTransactions.filter((t) => t.status !== "bokford" && inYear(t.date));
  const openExpenses = data.expenses.filter((e) => e.status !== "bokford" && inYear(e.date));
  const draftInvoices = data.invoices.filter((i) => i.status === "utkast");
  const overdue = data.invoices.filter(isOverdue);
  // Momsperioder som passerat med aktivitet men inte deklarerats blockerar.
  const vatUndeclared = vatPeriods(Number(fy.label)).filter(
    (p) => p.state === "att_deklarera" && (p.position.utgaende !== 0 || p.position.ingaende !== 0)
  );
  const missingDepreciation = assetsNeedingDepreciation(fy.id);
  const accrualsPending = pendingAccruals(fy.id);
  const today = bokforingsdatum(new Date().toISOString());
  const yearEnded = today > fy.endDate;

  return [
    {
      key: "aret_slut",
      label: `Räkenskapsåret ${fy.label} har tagit slut`,
      ok: yearEnded,
      blocking: true,
      detail: yearEnded
        ? `Året avslutades ${fy.endDate}.`
        : `Året pågår till ${fy.endDate}. Du kan förbereda bokslutet redan nu – avskrivningar, periodiseringar och kontroller – men stängningen görs efter årets slut.`,
    },
    {
      key: "bank",
      label: "Banken är avstämd",
      ok: unbookedBank.length === 0,
      blocking: true,
      detail: unbookedBank.length ? `${unbookedBank.length} banktransaktion${unbookedBank.length > 1 ? "er" : ""} behöver hanteras.` : "Alla banktransaktioner är bokförda.",
      href: "/ekonomi?flik=bank",
      hrefLabel: "Öppna banken",
    },
    {
      key: "kvitton",
      label: "Alla köp har underlag och är bokförda",
      ok: openExpenses.length === 0,
      blocking: true,
      detail: openExpenses.length ? `${openExpenses.length} köp behöver kvitto eller svar.` : "Alla köp är bokförda med underlag.",
      href: "/bokforing",
      hrefLabel: "Öppna bokföringen",
    },
    {
      key: "fakturor",
      label: "Alla fakturor är utfärdade och bokförda",
      ok: draftInvoices.length === 0,
      blocking: false,
      detail: draftInvoices.length
        ? `${draftInvoices.length} fakturautkast är inte utfärdade – utfärda eller kasta dem.`
        : "Utfärdade fakturor bokförs automatiskt.",
      href: "/ekonomi?flik=fakturor",
      hrefLabel: "Visa fakturorna",
    },
    {
      key: "fordringar",
      label: "Kundfordringar är kontrollerade",
      ok: overdue.length === 0,
      blocking: false,
      detail: overdue.length
        ? `${overdue.length} förfallen faktura${overdue.length > 1 ? "or" : ""} – bedöm om de kommer betalas.`
        : "Inga förfallna kundfordringar.",
      href: "/ekonomi?flik=fakturor",
      hrefLabel: "Visa fakturorna",
    },
    {
      key: "moms",
      label: "Momsen är deklarerad för alla perioder",
      ok: vatUndeclared.length === 0,
      blocking: true,
      detail: vatUndeclared.length
        ? `${vatUndeclared.map((p) => p.period.label).join(", ")} är inte markerad${vatUndeclared.length > 1 ? "e" : ""} som deklarerad.`
        : "Alla avslutade momsperioder är deklarerade.",
      href: "/bokforing/moms",
      hrefLabel: "Öppna momsöversikten",
    },
    {
      key: "avskrivningar",
      label: "Inventarier är avskrivna",
      ok: missingDepreciation.length === 0,
      blocking: true,
      detail: missingDepreciation.length
        ? `${missingDepreciation.length} inventarie${missingDepreciation.length > 1 ? "r" : ""} saknar årets avskrivning.`
        : data.assets.length
          ? "Årets avskrivningar är bokförda."
          : "Inga inventarier att skriva av.",
      href: "/bokforing/bokslut",
    },
    {
      key: "periodiseringar",
      label: "Periodiseringar är hanterade",
      ok: accrualsPending.length === 0,
      blocking: true,
      detail: accrualsPending.length
        ? `${accrualsPending.length} planerad${accrualsPending.length > 1 ? "e" : ""} periodisering${accrualsPending.length > 1 ? "ar" : ""} är inte bokförd${accrualsPending.length > 1 ? "a" : ""}.`
        : "Inga väntande periodiseringar.",
      href: "/bokforing/bokslut",
    },
  ];
}

/** Bokför alla årets avskrivningar och planerade periodiseringar i ett svep. */
export function runBokslutAutomation(fiscalYearId: string, by: "anvandare" | "assistent"): { depreciations: number; accruals: number } {
  let depreciations = 0;
  for (const { asset } of assetsNeedingDepreciation(fiscalYearId)) {
    const result = createDepreciationEntry(asset.id, fiscalYearId, by);
    if (result.amount > 0) depreciations++;
  }
  let accruals = 0;
  for (const accrual of pendingAccruals(fiscalYearId)) {
    bookAccrual(accrual.id, by);
    accruals++;
  }
  return { depreciations, accruals };
}

export interface CloseResult {
  fiscalYear: FiscalYear;
  nextYear: FiscalYear;
  resultatForeSkatt: number;
  skatt: number;
  aretsResultat: number;
  verifications: Verification[];
}

/**
 * Stäng räkenskapsåret:
 *  1. Kontrollera att alla blockerande punkter är klara.
 *  2. AB: bokför beräknad bolagsskatt (8910 → 2512), tydligt preliminär tills deklaration.
 *  3. Bokför årets resultat mot eget kapital (2099 för AB, 2019 för enskild firma).
 *  4. Skapa nästa räkenskapsår med utgående balanser som ingående.
 *  5. Återför periodiseringar i det nya året, lås och stäng.
 */
export function closeFiscalYear(fiscalYearId: string, by: "anvandare" | "assistent"): CloseResult {
  const data = db();
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) throw new Error("Räkenskapsåret finns inte.");
  if (fy.status === "stangt") throw new Error(`Räkenskapsåret ${fy.label} är redan stängt.`);

  const blockers = bokslutChecklist(fy.id).filter((c) => c.blocking && !c.ok);
  if (blockers.length) {
    throw new Error(`Bokslutet kan inte slutföras ännu: ${blockers.map((b) => b.detail ?? b.label).join(" ")}`);
  }

  const companyForm = data.settings.companyForm ?? "ab";
  const verifications: Verification[] = [];

  // 2. Bolagsskatt (AB).
  const taxCalc = computeTaxCalculation(fy);
  let skatt = 0;
  if (companyForm === "ab" && taxCalc.beraknadSkatt > taxCalc.bokfordSkatt) {
    skatt = taxCalc.beraknadSkatt - taxCalc.bokfordSkatt;
    verifications.push(
      postVerification(
        {
          date: fy.endDate,
          description: `Beräknad bolagsskatt ${fy.label}`,
          entries: [
            { account: 8910, debit: skatt },
            { account: 2512, credit: skatt },
          ],
          source: { type: "bokslut", id: fy.id },
          createdBy: by,
          explanation: `Preliminär bolagsskatt: ${taxCalc.beskattningsbartResultat} kr beskattningsbart resultat × 20,6 % = ${taxCalc.beraknadSkatt} kr. Uppskattad tills deklarationen är lämnad.`,
        },
        { bypassPeriodLock: true }
      )
    );
  } else {
    skatt = taxCalc.bokfordSkatt;
  }

  // 3. Årets resultat: nolla resultaträkningen mot eget kapital.
  const sb = saldobalans({ from: fy.startDate, to: fy.endDate });
  let resultNet = 0; // debetsaldo på resultatkonton (positivt = förlust)
  for (const row of sb.rows) {
    if (isResultAccount(row.account) || row.account === 8999) resultNet += row.ub;
  }
  const aretsResultat = -resultNet; // positivt = vinst
  const equityAccount = companyForm === "ab" ? 2099 : 2019;
  if (aretsResultat !== 0) {
    verifications.push(
      postVerification(
        {
          date: fy.endDate,
          description: `Årets resultat ${fy.label}`,
          entries:
            aretsResultat > 0
              ? [
                  { account: 8999, debit: aretsResultat },
                  { account: equityAccount, credit: aretsResultat },
                ]
              : [
                  { account: equityAccount, debit: -aretsResultat },
                  { account: 8999, credit: -aretsResultat },
                ],
          source: { type: "bokslut", id: fy.id },
          createdBy: by,
          explanation:
            aretsResultat > 0
              ? `Årets vinst ${aretsResultat} kr flyttas till eget kapital (${equityAccount === 2099 ? "Årets resultat" : "Årets resultat, enskild firma"}).`
              : `Årets förlust ${-aretsResultat} kr flyttas till eget kapital.`,
        },
        { bypassPeriodLock: true }
      )
    );
  }

  // 4. Nästa år: UB → IB för balanskonton (1xxx–2xxx).
  const closing = saldobalans({ from: fy.startDate, to: fy.endDate });
  const nextYearNumber = Number(fy.label) + 1;
  let nextYear = data.fiscalYears.find((f) => f.label === String(nextYearNumber));
  if (!nextYear) {
    nextYear = calendarFiscalYear(nextYearNumber);
    data.fiscalYears.push(nextYear);
  }
  const opening: Record<string, number> = {};
  for (const row of closing.rows) {
    if (row.account >= 3000) continue;
    if (row.ub !== 0) opening[String(row.account)] = row.ub;
  }
  nextYear.openingBalances = opening;
  nextYear.openingSource = "foregaende_ar";

  // 5. Stäng, lås, återför periodiseringar i nya året.
  fy.status = "stangt";
  fy.closedAt = new Date().toISOString();
  fy.closingVerificationIds = verifications.map((v) => v.id);
  lockPeriod(fy.endDate, by);
  reverseAccrualsInto(nextYear.startDate, fy.id, "auto");

  logAudit(by, "rakenskapsar_stangt", `Räkenskapsåret ${fy.label} stängdes. Årets resultat: ${aretsResultat} kr${skatt ? `, beräknad skatt ${skatt} kr` : ""}. ${nextYear.label} fick utgående balanser som ingående.`, {
    targetType: "rakenskapsar",
    targetId: fy.id,
  });
  save();
  return { fiscalYear: fy, nextYear, resultatForeSkatt: taxCalc.redovisningsresultat, skatt, aretsResultat, verifications };
}
