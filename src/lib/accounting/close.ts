import { db, save } from "../store";
import type { FiscalYear, FiscalYearReopening, Verification } from "../types";
import { bokforingsdatum, calendarFiscalYear, getFiscalYear, lockPeriod, unlockPeriodThrough } from "./fiscal";
import { previousDay } from "./dates";
import { supersedeAnnualReports } from "./annual-report";
import { postVerification } from "./engine";
import { isResultAccount, saldobalans } from "./ledger";
import { assetsNeedingDepreciation, createDepreciationEntry } from "./assets";
import { pendingAccruals, bookAccrual, reverseAccrualsInto } from "./accruals";
import { computeTaxCalculation } from "./tax";
import { logAudit } from "./audit";
import { vatPeriods } from "./vat";
import { isOverdue } from "../services/data";
import { balanceReconciliation } from "./balance-reconciliation";
import { SCHEDULE_LABEL, bookYearEndSchedule, schedulesAwaitingBooking, yearEndSchedules } from "./year-end";

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
  const schedulesPending = schedulesAwaitingBooking(fy.id);
  const tieOut = balanceReconciliation(fy.id);
  const today = bokforingsdatum(new Date().toISOString());
  const yearEnded = today > fy.endDate;

  return [
    {
      key: "aret_slut",
      /*
       * Övriga punkter är krav man kan uppfylla, så rubriken kan stå i uppfyllt
       * läge. Den här går inte att göra något åt, och "har tagit slut" om ett år
       * som pågår läser som ett påstående som inte är sant.
       */
      label: yearEnded ? `Räkenskapsåret ${fy.label} har tagit slut` : `Räkenskapsåret ${fy.label} pågår ännu`,
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
    {
      key: "bokslutsbilagor",
      label: "Bokslutsbilagorna är bokförda",
      ok: schedulesPending.length === 0,
      blocking: true,
      detail: schedulesPending.length
        ? schedulesPending.map((s) => `${SCHEDULE_LABEL[s.kind]}: ${s.reason}`).join(" ")
        : yearEndSchedules(fy.id).length
          ? "Bilagorna är bokförda."
          : "Inga bilagor behövs för året.",
      href: "/bokforing/bokslut/bilagor",
      hrefLabel: "Öppna bilagorna",
    },
    {
      // Debet lika med kredit räcker inte: varje balanspost ska gå att förklara
      // mot något utanför huvudboken.
      key: "avstamning",
      label: "Balanskontona är avstämda mot delsystemen",
      ok: tieOut.ok,
      blocking: true,
      detail: tieOut.ok
        ? `${tieOut.rows.length} balanskonto${tieOut.rows.length === 1 ? "" : "n"} stämmer mot sina underlag.` +
          (tieOut.manual.length
            ? ` ${tieOut.manual.length} konto${tieOut.manual.length === 1 ? "" : "n"} saknar delsystem och stäms av mot underlaget för hand: ${tieOut.manual
                .map((r) => `${r.account} ${r.name}`)
                .join(", ")}.`
            : "")
        : `${tieOut.unexplained.length} konto${tieOut.unexplained.length === 1 ? "" : "n"} går inte ihop: ${tieOut.unexplained
            .map((r) => `${r.account} ${r.name}`)
            .join(", ")}.`,
      href: "/bokforing/bokslut/avstamning",
      hrefLabel: "Visa avstämningen",
    },
  ];
}

/**
 * Bokför allt i bokslutet som redan är bestämt: avskrivningar, planerade
 * periodiseringar och de bilagor användaren fyllt i. Bilagor som saknas
 * bokförs inte – de kräver en uppgift bara användaren har.
 */
export function runBokslutAutomation(
  fiscalYearId: string,
  by: "anvandare" | "assistent"
): { depreciations: number; accruals: number; schedules: number } {
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
  let schedules = 0;
  for (const schedule of yearEndSchedules(fiscalYearId)) {
    if (schedule.status !== "utkast") continue;
    bookYearEndSchedule(schedule.id, by);
    schedules++;
  }
  return { depreciations, accruals, schedules };
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
 *  3. Omför föregående års resultat till balanserat resultat, och bokför årets
 *     resultat mot eget kapital (2099 för AB, 2019 för enskild firma).
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
  const balanceradAccount = companyForm === "ab" ? 2091 : 2010;

  /*
   * Omföring av föregående års resultat.
   *
   * "Årets resultat" får bara innehålla ETT års resultat. Utan omföringen
   * ackumuleras kontot år för år: balansräkningen skulle säga att årets
   * resultat är summan av alla år och att balanserat resultat är noll. Summan
   * eget kapital blir rätt ändå, vilket är precis varför felet är lätt att
   * missa – men fördelningen är fel, och det är den utomstående läser.
   *
   * Omföringen dateras till räkenskapsårets första dag: resultatet tillhörde
   * det föregående året och ska inte ligga kvar som "årets" när det nya börjar.
   */
  const ingaendeResultat = -(sb.rows.find((r) => r.account === equityAccount)?.ib ?? 0);
  if (ingaendeResultat !== 0) {
    verifications.push(
      postVerification(
        {
          date: fy.startDate,
          description: `Omföring av föregående års resultat`,
          entries:
            ingaendeResultat > 0
              ? [
                  { account: equityAccount, debit: ingaendeResultat },
                  { account: balanceradAccount, credit: ingaendeResultat },
                ]
              : [
                  { account: balanceradAccount, debit: -ingaendeResultat },
                  { account: equityAccount, credit: -ingaendeResultat },
                ],
          source: { type: "bokslut", id: fy.id },
          createdBy: by,
          explanation: `Föregående års resultat ${ingaendeResultat} kr flyttas från Årets resultat till balanserat resultat, så att Årets resultat bara visar ${fy.label}.`,
        },
        { bypassPeriodLock: true }
      )
    );
  }
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
  // Har året varit öppnat igen låg låset längre fram än årets slut när det
  // öppnades – senare deklarerade perioder. Det låset sätts tillbaka nu, annars
  // vore de perioderna olåsta efter omtaget.
  const lastReopening = fy.reopenings?.at(-1);
  if (lastReopening?.previousLockedThrough) lockPeriod(lastReopening.previousLockedThrough, by);
  reverseAccrualsInto(nextYear.startDate, fy.id, "auto");

  logAudit(by, "rakenskapsar_stangt", `Räkenskapsåret ${fy.label} stängdes. Årets resultat: ${aretsResultat} kr${skatt ? `, beräknad skatt ${skatt} kr` : ""}. ${nextYear.label} fick utgående balanser som ingående.`, {
    targetType: "rakenskapsar",
    targetId: fy.id,
  });
  save();
  return { fiscalYear: fy, nextYear, resultatForeSkatt: taxCalc.redovisningsresultat, skatt, aretsResultat, verifications };
}

/* -------------------------------- Återöppning ------------------------------- */

/**
 * Återöppning av ett stängt räkenskapsår.
 *
 * Ett bokslut är en slutsats, inte en sanning: en glömd faktura eller ett fel
 * konto kan dyka upp efteråt. Är bokslutet permanent finns bara dåliga utvägar –
 * bokföra fjolårets fel i år, eller leva med en årsredovisning man vet är
 * felaktig. Därför går året att öppna igen. Men det är ett ingrepp, så det är
 * kontrollerat: ett skäl krävs, bokslutsverifikationerna återförs så att nästa
 * stängning räknar om från grunden i stället för att lägga ovanpå, en redan
 * upprättad årsredovisning markeras som ersatt, och allt hamnar i audit-loggen.
 */

export interface ReopenBlocker {
  key: string;
  detail: string;
}

/** Varför året inte kan öppnas igen. Tom lista = det går. */
export function reopenBlockers(fiscalYearId: string): ReopenBlocker[] {
  const data = db();
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) return [{ key: "finns_inte", detail: "Räkenskapsåret finns inte." }];
  const out: ReopenBlocker[] = [];
  if (fy.status !== "stangt") {
    out.push({ key: "inte_stangt", detail: `Räkenskapsåret ${fy.label} är redan öppet.` });
    return out;
  }
  /*
   * Åren öppnas i omvänd ordning. Ett senare stängt år vilar på det här årets
   * utgående balanser: ändras de medan det senare året är stängt går ingående
   * och utgående balanser isär utan att någon ser det. Att öppna 2026 först är
   * dessutom vad användaren ändå måste göra för att rätta 2025.
   */
  const laterClosed = data.fiscalYears
    .filter((f) => f.status === "stangt" && f.startDate > fy.startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (laterClosed.length) {
    out.push({
      key: "senare_ar_stangt",
      detail: `${laterClosed.map((f) => f.label).join(", ")} är stängt${laterClosed.length > 1 ? "a" : ""} och bygger på ${fy.label}:s utgående balanser. Öppna ${laterClosed[laterClosed.length - 1].label} först.`,
    });
  }
  return out;
}

export interface ReopenResult {
  fiscalYear: FiscalYear;
  /** Återföringarna av bokslutsverifikationerna. */
  reversals: Verification[];
  /** Periodiseringar som återgick till bokförda för året. */
  restoredAccruals: number;
  /** Årsredovisningar som markerades som ersatta. */
  supersededReports: number;
  /** Periodlåset efter återöppningen (odefinierat = inget lås). */
  lockedThrough?: string;
  /** Nästa år, som har kvar sina ingående balanser tills året stängs igen. */
  nextYear?: FiscalYear;
}

/** Speglad verifikation: samma konton och belopp, debet och kredit bytta. */
function mirrorEntries(original: Verification) {
  return original.entries.map((e) => ({
    account: e.account,
    debit: e.credit,
    credit: e.debit,
    vatCode: e.vatCode,
  }));
}

export function reopenFiscalYear(fiscalYearId: string, reason: string, by: "anvandare" | "assistent"): ReopenResult {
  const data = db();
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) throw new Error("Räkenskapsåret finns inte.");
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 5) {
    throw new Error(
      "Skriv varför året öppnas igen. Skälet följer med i audit-loggen och är det en granskare läser för att förstå varför bokslutet gjordes om."
    );
  }
  const blockers = reopenBlockers(fy.id);
  if (blockers.length) throw new Error(`Räkenskapsåret kan inte öppnas: ${blockers.map((b) => b.detail).join(" ")}`);

  const at = new Date().toISOString();
  const previousLockedThrough = data.accounting.lockedThrough;

  /*
   * Ordningen spelar roll: året måste vara öppet och låset flyttat innan
   * återföringarna kan bokföras på sina ursprungsdatum. Att återföra dem på
   * första öppna dag i stället – som en vanlig rättelse – vore fel här, för då
   * skulle det öppnade året behålla ett halvt bokslut i sina siffror.
   */
  fy.status = "oppet";
  const openBefore = previousDay(fy.startDate);
  unlockPeriodThrough(
    previousLockedThrough && previousLockedThrough < openBefore ? previousLockedThrough : openBefore,
    by,
    `Räkenskapsåret ${fy.label} öppnades igen: ${trimmedReason}`
  );

  // 1. Återför bokslutsverifikationerna: skatt, omföring och årets resultat.
  const reversals: Verification[] = [];
  const reversedIds: string[] = [];
  for (const id of fy.closingVerificationIds ?? []) {
    const original = data.verifications.find((v) => v.id === id);
    if (!original || original.correctedByVerificationId) continue;
    const reversal = postVerification({
      date: original.date,
      description: `Återföring av bokslut ${fy.label}: ${original.description}`,
      entries: mirrorEntries(original),
      source: { type: "bokslut", id: fy.id },
      confidence: "hog",
      createdBy: by,
      correctsVerificationId: original.id,
      explanation: `Räkenskapsåret ${fy.label} öppnades igen, så bokslutsposten återförs och räknas om vid nästa stängning. Originalet står kvar – bokföring skrivs aldrig om. Skäl: ${trimmedReason}`,
    });
    original.correctedByVerificationId = reversal.id;
    reversals.push(reversal);
    reversedIds.push(original.id);
  }
  fy.closingVerificationIds = undefined;
  delete fy.closedAt;

  /*
   * 2. Periodiseringarna som stängningen återförde in i nästa år. De ligger
   * kvar i nästa års bokföring och skulle bokföras en gång till vid nästa
   * stängning, så återföringen återförs och periodiseringen blir bokförd igen.
   */
  let restoredAccruals = 0;
  for (const accrual of data.accruals) {
    if (accrual.fiscalYearId !== fy.id || accrual.status !== "aterford" || !accrual.reverseVerificationId) continue;
    const original = data.verifications.find((v) => v.id === accrual.reverseVerificationId);
    if (!original) continue;
    if (!original.correctedByVerificationId) {
      const reversal = postVerification({
        date: original.date,
        description: `Återföring av bokslut ${fy.label}: ${original.description}`,
        entries: mirrorEntries(original),
        source: { type: "periodisering", id: accrual.id },
        confidence: "hog",
        createdBy: by,
        correctsVerificationId: original.id,
        explanation: `Periodiseringen återfördes automatiskt när ${fy.label} stängdes. Året är öppnat igen, så återföringen tas tillbaka och periodiseringen ligger kvar i ${fy.label}.`,
      });
      original.correctedByVerificationId = reversal.id;
      reversals.push(reversal);
    }
    accrual.status = "bokford";
    accrual.reverseVerificationId = undefined;
    restoredAccruals++;
  }

  // 3. En upprättad årsredovisning beskriver inte längre böckerna.
  const superseded = supersedeAnnualReports(fy.id, trimmedReason, at);

  const reopening: FiscalYearReopening = {
    at,
    by,
    reason: trimmedReason,
    reversedVerificationIds: reversedIds,
    reversalVerificationIds: reversals.map((v) => v.id),
    previousLockedThrough,
  };
  fy.reopenings = [...(fy.reopenings ?? []), reopening];

  const nextYear = data.fiscalYears.find((f) => f.label === String(Number(fy.label) + 1));

  logAudit(
    by,
    "rakenskapsar_oppnat",
    `Räkenskapsåret ${fy.label} öppnades igen. Skäl: ${trimmedReason} ${reversals.length} bokslutsverifikation${reversals.length === 1 ? "" : "er"} återfördes${superseded.length ? `, årsredovisningen markerades som ersatt` : ""}${nextYear ? `. ${nextYear.label} har kvar sina ingående balanser tills ${fy.label} stängs igen` : ""}.`,
    { targetType: "rakenskapsar", targetId: fy.id }
  );
  save();
  return {
    fiscalYear: fy,
    reversals,
    restoredAccruals,
    supersededReports: superseded.length,
    lockedThrough: data.accounting.lockedThrough,
    nextYear,
  };
}
