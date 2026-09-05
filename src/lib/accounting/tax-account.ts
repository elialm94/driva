import { db, save } from "../store";
import type { BankTransaction, Verification, VatReport } from "../types";
import { bokforingsdatum, todayDate } from "./dates";
import { fiscalYearFor } from "./fiscal";
import { postVerification } from "./engine";
import { logAudit } from "./audit";
import {
  ARBETSGIVARAVGIFT,
  F_SKATT,
  MOMS_REDOVISNING,
  PERSONALSKATT,
  SKATTEKONTO,
  type TaxAccountEventKind,
  type TaxAccountReconciliation,
  type TaxAccountRow,
  type TaxAccountStatementRow,
} from "./tax-account-model";

export * from "./tax-account-model";

/**
 * Skattekontot – bolagets konto hos Skatteverket.
 *
 * Skatteverket är en motpart som bokförs, inte en betalning som försvinner:
 * moms, arbetsgivaravgifter, personalskatt och F-skatt dras från skattekontot,
 * och bolaget fyller på det från banken. Utan kontot går det inte att se vad
 * Skatteverket anser att bolaget är skyldigt.
 *
 * Konteringsvägar (alla går genom postVerification – aldrig direkt mot
 * tabellerna):
 *
 *   inbetalning       1630 debet   1930 kredit
 *   moms att betala   1630 kredit  2650 debet
 *   moms tillbaka     1630 debet   2650 kredit
 *   arbetsgivaravg.   1630 kredit  2731 debet
 *   personalskatt     1630 kredit  2710 debet
 *   F-skatt           1630 kredit  2518 debet
 *
 * Saldot härleds alltid ur huvudboken – det lagras aldrig separat.
 */

function kindOf(v: Verification): TaxAccountEventKind {
  const others = v.entries.filter((e) => e.account !== SKATTEKONTO).map((e) => e.account);
  if (others.includes(MOMS_REDOVISNING)) return "moms";
  if (others.includes(ARBETSGIVARAVGIFT)) return "arbetsgivaravgift";
  if (others.includes(PERSONALSKATT)) return "personalskatt";
  if (others.includes(F_SKATT)) return "f_skatt";
  if (others.some((a) => a >= 1900 && a < 2000)) return "inbetalning";
  return "ovrigt";
}

export interface TaxAccountLedger {
  rows: TaxAccountRow[];
  /** Ingående balans för räkenskapsåret raderna ligger i. */
  opening: number;
  /** Saldo enligt bokföringen. Positivt = tillgodo hos Skatteverket. */
  balance: number;
}

/**
 * Skattekontots rörelser enligt bokföringen, äldst först. Avgränsas till
 * räkenskapsåret som `through` ligger i och startar på årets ingående balans,
 * så att `balance` alltid är samma tal som `accountBalance(1630, through)`.
 */
export function taxAccountLedger(through: string = todayDate()): TaxAccountLedger {
  const rows: TaxAccountRow[] = [];
  const fy = fiscalYearFor(through);
  const from = fy?.startDate;
  const relevant = db()
    .verifications.filter((v) => {
      const d = bokforingsdatum(v.date);
      if (d > through) return false;
      if (from && d < from) return false;
      return v.entries.some((e) => e.account === SKATTEKONTO);
    })
    .sort((a, b) => bokforingsdatum(a.date).localeCompare(bokforingsdatum(b.date)) || a.number - b.number);

  const opening = fy ? (fy.openingBalances[String(SKATTEKONTO)] ?? 0) : 0;
  let balance = opening;
  for (const v of relevant) {
    const amount = v.entries
      .filter((e) => e.account === SKATTEKONTO)
      .reduce((s, e) => s + e.debit - e.credit, 0);
    balance += amount;
    rows.push({
      verificationId: v.id,
      label: `${v.series ?? "A"}${v.number}`,
      date: bokforingsdatum(v.date),
      description: v.description,
      kind: kindOf(v),
      amount,
      balance,
    });
  }
  return { rows, opening, balance };
}

function alreadyBooked(sourceId: string): Verification | undefined {
  return db().verifications.find((v) => v.source.type === "skattekonto" && "id" in v.source && v.source.id === sourceId);
}

/**
 * Momsen flyttas från redovisningskontot till skattekontot. Sker när
 * Skatteverket registrerar deklarationen på kontot – i praktiken förfallodagen,
 * som därför är standarddatum.
 */
export function bookVatOnTaxAccount(reportId: string, actor: "anvandare" | "assistent"): Verification {
  const report = db().vatReports.find((r) => r.id === reportId);
  if (!report) throw new Error("Momsrapporten finns inte.");
  if (report.status !== "deklarerad") {
    throw new Error(`Momsen för ${report.label} är inte deklarerad ännu – deklarera först, bokför på skattekontot sedan.`);
  }
  const sourceId = `moms-${report.id}`;
  const existing = alreadyBooked(sourceId);
  if (existing) return existing;
  if (report.attBetala === 0) throw new Error(`Momsen för ${report.label} är noll – ingenting att föra till skattekontot.`);

  const amount = Math.abs(report.attBetala);
  const debt = report.attBetala > 0;
  const ver = postVerification({
    date: report.periodEnd,
    description: `Moms ${report.label} till skattekontot`,
    entries: debt
      ? [
          { account: MOMS_REDOVISNING, debit: amount },
          { account: SKATTEKONTO, credit: amount },
        ]
      : [
          { account: SKATTEKONTO, debit: amount },
          { account: MOMS_REDOVISNING, credit: amount },
        ],
    source: { type: "skattekonto", id: sourceId },
    createdBy: actor,
    explanation: debt
      ? `Momsen för ${report.label} (${amount} kr) drogs från skattekontot. Redovisningskontot nollställs och skulden syns nu där Skatteverket har den.`
      : `Momsen för ${report.label} (${amount} kr) tillgodofördes skattekontot.`,
  }, { bypassPeriodLock: true });
  logAudit(actor, "skattekonto_bokford", `Moms för ${report.label} fördes till skattekontot (${report.attBetala} kr).`, {
    targetType: "momsrapport",
    targetId: report.id,
  });
  save();
  return ver;
}

/**
 * Preliminärskatten (F-skatt) dras varje månad enligt Skatteverkets beslut.
 * Beloppet är en inställning på företaget; en månad bokförs bara en gång.
 */
export function bookFSkatt(month: string, actor: "anvandare" | "assistent", amountOverride?: number): Verification {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Månaden anges som YYYY-MM.");
  const amount = amountOverride ?? db().settings.fSkattPerMonth;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("F-skatten per månad är inte satt – fyll i den under Inställningar först.");
  }
  const sourceId = `fskatt-${month}`;
  const existing = alreadyBooked(sourceId);
  if (existing) return existing;

  const ver = postVerification({
    date: `${month}-12`,
    description: `F-skatt ${month}`,
    entries: [
      { account: F_SKATT, debit: amount },
      { account: SKATTEKONTO, credit: amount },
    ],
    source: { type: "skattekonto", id: sourceId },
    createdBy: actor,
    explanation: `Preliminärskatten för ${month} (${amount} kr) drogs från skattekontot. F-skatten kvittas mot den slutliga skatten vid bokslutet.`,
  });
  logAudit(actor, "skattekonto_bokford", `F-skatt för ${month} bokfördes (${amount} kr).`, {
    targetType: "skattekonto",
    targetId: sourceId,
  });
  save();
  return ver;
}

/**
 * Arbetsgivaravgifter och personalskatt för en månad förs till skattekontot när
 * arbetsgivardeklarationen lämnats in. Beloppen hämtas ur bokföringen – det som
 * står som skuld på 2731 och 2710 för månaden – så lönekörningen är den enda
 * källan och det finns ingen parallell beräkning här.
 */
export function bookEmployerTaxesOnTaxAccount(
  month: string,
  actor: "anvandare" | "assistent"
): Verification {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Månaden anges som YYYY-MM.");
  const sourceId = `arbetsgivare-${month}`;
  const existing = alreadyBooked(sourceId);
  if (existing) return existing;

  const avgift = monthlyLiability(ARBETSGIVARAVGIFT, month, sourceId);
  const skatt = monthlyLiability(PERSONALSKATT, month, sourceId);
  if (avgift === 0 && skatt === 0) {
    throw new Error(`Ingen lön är bokförd för ${month} – arbetsgivaravgifter och personalskatt saknas.`);
  }

  const entries = [
    ...(avgift !== 0 ? [{ account: ARBETSGIVARAVGIFT, debit: avgift }] : []),
    ...(skatt !== 0 ? [{ account: PERSONALSKATT, debit: skatt }] : []),
    { account: SKATTEKONTO, credit: avgift + skatt },
  ];
  const ver = postVerification(
    {
      // Månadens sista dag: skulden till Skatteverket ska stå på skattekontot i
      // samma månad som lönen, inte i månaden deklarationen lämnas.
      date: lastDayOfMonth(month),
      description: `Arbetsgivaravgifter och personalskatt ${month}`,
      entries,
      source: { type: "skattekonto", id: sourceId },
      createdBy: actor,
      explanation: `Arbetsgivaravgifter (${avgift} kr) och personalskatt (${skatt} kr) för ${month} drogs från skattekontot. Skuldkontona nollställs och beloppet syns nu där Skatteverket har det.`,
    },
    { bypassPeriodLock: true }
  );
  logAudit(
    actor,
    "skattekonto_bokford",
    `Arbetsgivaravgifter och personalskatt för ${month} fördes till skattekontot (${avgift + skatt} kr).`,
    { targetType: "skattekonto", targetId: sourceId }
  );
  save();
  return ver;
}

/**
 * Skulden på ett skuldkonto som uppstod under månaden, exklusive överföringar
 * till skattekontot. Kredit är skuld, så tecknet vänds till ett positivt belopp.
 */
function monthlyLiability(account: number, month: string, skipSourceId: string): number {
  let sum = 0;
  for (const v of db().verifications) {
    if (bokforingsdatum(v.date).slice(0, 7) !== month) continue;
    if (v.source.type === "skattekonto" && "id" in v.source && v.source.id === skipSourceId) continue;
    for (const e of v.entries) {
      if (e.account === account) sum += e.credit - e.debit;
    }
  }
  return sum > 0 ? sum : 0;
}

/**
 * Deklarerade momsrapporter som ännu inte förts över till skattekontot.
 * Nollrapporter räknas inte – det finns ingenting att flytta.
 */
export function vatReportsAwaitingTaxAccount(): VatReport[] {
  return db().vatReports.filter(
    (r) => r.status === "deklarerad" && r.attBetala !== 0 && !alreadyBooked(`moms-${r.id}`)
  );
}

/**
 * Månader i det öppna räkenskapsåret där F-skatten ska ha dragits men inte är
 * bokförd. Skatteverket drar den månaden efter, så innevarande månad räknas
 * inte som förfallen.
 */
export function fSkattMonthsAwaitingBooking(through: string = todayDate()): string[] {
  const amount = db().settings.fSkattPerMonth;
  if (!Number.isFinite(amount) || amount <= 0) return [];
  const fy = fiscalYearFor(through);
  if (!fy) return [];
  const months: string[] = [];
  for (let m = monthOf(fy.startDate); m <= monthOf(fy.endDate) && m < monthOf(through); m = nextMonth(m)) {
    if (!alreadyBooked(`fskatt-${m}`)) months.push(m);
  }
  return months;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function lastDayOfMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Banktransaktioner som ser ut som en inbetalning till skattekontot. */
export function taxAccountDepositCandidates(): BankTransaction[] {
  return db().bankTransactions.filter(
    (t) => t.amount < 0 && (t.status === "ny" || t.status === "behover_atgard") && looksLikeTaxAccount(t)
  );
}

function looksLikeTaxAccount(t: BankTransaction): boolean {
  const text = `${t.description ?? ""} ${t.counterpart ?? ""}`.toLowerCase();
  return text.includes("skatteverk") || text.includes("skattekonto");
}

/** Överföring från företagskontot till skattekontot. */
export function bookTaxAccountDeposit(txId: string, actor: "anvandare" | "assistent"): Verification {
  const data = db();
  const tx = data.bankTransactions.find((t) => t.id === txId);
  if (!tx) throw new Error("Banktransaktionen finns inte.");
  if (tx.status === "bokford") throw new Error("Banktransaktionen är redan bokförd.");
  if (tx.amount >= 0) throw new Error("En inbetalning till skattekontot är ett uttag från företagskontot.");

  const sourceId = `inbetalning-${tx.id}`;
  const existing = alreadyBooked(sourceId);
  if (existing) return existing;

  const amount = Math.abs(tx.amount);
  const ver = postVerification({
    date: bokforingsdatum(tx.date),
    description: "Inbetalning till skattekontot",
    entries: [
      { account: SKATTEKONTO, debit: amount },
      { account: 1930, credit: amount },
    ],
    source: { type: "skattekonto", id: sourceId },
    createdBy: actor,
    explanation: `${amount} kr fördes från företagskontot till skattekontot. Pengarna är kvar i bolaget – de står bara hos Skatteverket.`,
  });
  tx.status = "bokford";
  tx.verificationId = ver.id;
  logAudit(actor, "skattekonto_bokford", `Inbetalning till skattekontot bokfördes (${amount} kr).`, {
    targetType: "banktransaktion",
    targetId: tx.id,
  });
  save();
  return ver;
}

/* ------------------------------ Avstämning -------------------------------- */

/**
 * Avstämning mot skattekontoutdraget. Härledd, aldrig lagrad – samma filosofi
 * som bankavstämningen. Matchningen är på belopp och datum inom några dagar,
 * eftersom Skatteverket registrerar på förfallodagen och bokföringen på
 * periodens slut. Ränta och avgifter som Skatteverket lagt på kontot utan att
 * de bokförts faller ut som saknade rader i stället för att gömmas i en
 * differens. Utdraget antas täcka räkenskapsåret; ingående balans läggs till
 * utdragets rader så att de två saldona är jämförbara.
 */
export function reconcileTaxAccount(
  statement: TaxAccountStatementRow[],
  through: string = todayDate()
): TaxAccountReconciliation {
  const ledger = taxAccountLedger(through);
  const statementBalance = ledger.opening + statement.reduce((s, r) => s + r.amount, 0);
  const ledgerBalance = ledger.balance;

  const remaining = [...ledger.rows];
  const missingInLedger: TaxAccountStatementRow[] = [];
  for (const row of statement) {
    const i = remaining.findIndex((l) => l.amount === row.amount && withinDays(l.date, row.date, 5));
    if (i === -1) missingInLedger.push(row);
    else remaining.splice(i, 1);
  }

  const difference = statementBalance - ledgerBalance;
  return {
    statementBalance,
    ledgerBalance,
    statementRows: statement.length,
    difference,
    missingInLedger,
    missingInStatement: remaining,
    ok: difference === 0 && missingInLedger.length === 0 && remaining.length === 0,
  };
}

function withinDays(a: string, b: string, days: number): boolean {
  const diff = Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`));
  return diff <= days * 86_400_000;
}

