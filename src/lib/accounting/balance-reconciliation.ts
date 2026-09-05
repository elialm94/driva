import { db } from "../store";
import type { FiscalYear } from "../types";
import { accountName } from "./chart";
import { bokforingsdatum } from "./dates";
import { getFiscalYear } from "./fiscal";
import { accountBalance, saldobalans } from "./ledger";
import { accumulatedDepreciation, bookValue } from "./assets";
import { invoiceOutstanding, isOpenReceivable } from "../services/data";
import { bankReconciliation } from "./reconciliation";
import { computeVatPosition } from "./vat";
import { vatPeriodsOf } from "./dates";
import { vatPeriodicity } from "./fiscal";
import {
  ARBETSGIVARAVGIFT,
  MOMS_REDOVISNING,
  PERSONALSKATT,
  SKATTEKONTO,
} from "./tax-account-model";
import { employerDeclarations } from "./payroll";
import {
  NEDSKRIVNING_KUNDFORDRINGAR,
  PERIODISERINGSFOND,
  SEMESTERLONESKULD,
  UPPLUPNA_SOCIALA_AVGIFTER,
  yearEndScheduleFor,
} from "./year-end";

/**
 * Avstämning per balanskonto med tie-out mot delsystemen.
 *
 * Ett bokslut är inte klart för att debet är lika med kredit. Varje
 * balanspost ska gå att förklara mot något utanför huvudboken: kundfordringar
 * mot de obetalda fakturorna, leverantörsskulder mot de obetalda
 * leverantörsfakturorna, momskontona mot momsrapporten, skattekontot mot
 * Skatteverket. Går de inte ihop är det den skillnaden bokslutsarbetet
 * handlar om.
 *
 * Därför är regeln här: varje balanskonto med saldo måste ha ett svar. Konton
 * med ett delsystem stäms av automatiskt. Konton utan delsystem – ett eget
 * konto, ett lån, aktiekapitalet – kräver en bilaga eller en kvittering, och
 * de listas öppet i stället för att antas vara rätt.
 */

export type TieOutSource =
  | "kundfakturor"
  | "leverantorsfakturor"
  | "bank"
  | "skattekonto"
  | "momsrapport"
  | "arbetsgivardeklaration"
  | "inventarieregister"
  | "periodiseringar"
  | "bokslutsbilaga"
  | "ingen";

export const TIE_OUT_LABEL: Record<TieOutSource, string> = {
  kundfakturor: "Obetalda kundfakturor",
  leverantorsfakturor: "Obetalda leverantörsfakturor",
  bank: "Bankens saldo",
  skattekonto: "Skatteverkets kontoutdrag",
  momsrapport: "Momsrapporten",
  arbetsgivardeklaration: "Arbetsgivardeklarationen",
  inventarieregister: "Inventarieregistret",
  periodiseringar: "Periodiseringarna",
  bokslutsbilaga: "Bokslutsbilagan",
  ingen: "Saknar delsystem",
};

export interface BalanceAccountReconciliation {
  account: number;
  name: string;
  /** Utgående saldo i huvudboken (debet minus kredit). */
  ledger: number;
  /** Vad delsystemet säger. Undefined när kontot saknar delsystem. */
  subsystem?: number;
  /** ledger − subsystem. 0 = avstämt. */
  difference: number;
  source: TieOutSource;
  /** Vad avstämningen kommer fram till, i klartext. */
  detail: string;
  /** Sant när kontot är förklarat: delsystemet säger samma sak. */
  ok: boolean;
  /**
   * Sant när kontot inte KAN stämmas av automatiskt – ett banklån har ingen
   * motsvarighet i Driva. Sådana konton stoppar inte bokslutet, för det vore
   * att kräva något användaren inte kan leverera, men de listas så att de
   * stäms av mot underlaget för hand i stället för att glömmas.
   */
  manual?: boolean;
  href?: string;
  hrefLabel?: string;
}

export interface BalanceReconciliation {
  fiscalYearId: string;
  rows: BalanceAccountReconciliation[];
  /** Konton där huvudboken och delsystemet säger olika. Stoppar bokslutet. */
  unexplained: BalanceAccountReconciliation[];
  /** Konton som måste stämmas av mot ett underlag för hand. */
  manual: BalanceAccountReconciliation[];
  ok: boolean;
}

/** Konton som per konstruktion inte har ett delsystem utanför huvudboken. */
const NO_SUBSYSTEM_EXPECTED = new Set([
  2081, // Aktiekapital – bolagsordningen, inte ett delsystem
  2085, // Uppskrivningsfond
  2086, // Reservfond
  2091, // Balanserad vinst eller förlust – förs över vid stängning
  2093, // Erhållna aktieägartillskott
  2097, // Överkursfond
  2098, // Vinst eller förlust från föregående år
  2099, // Årets resultat – bokförs av stängningen
  2510, // Skatteskulder
  2512, // Beräknad inkomstskatt – bokförs av stängningen
]);

export function balanceReconciliation(fiscalYearId: string): BalanceReconciliation {
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) return { fiscalYearId, rows: [], unexplained: [], manual: [], ok: true };

  const sb = saldobalans({ from: fy.startDate, to: fy.endDate });
  const accounts = new Set<number>();
  for (const row of sb.rows) {
    if (row.account >= 3000) continue;
    if (row.ub !== 0 || row.debit !== 0 || row.credit !== 0) accounts.add(row.account);
  }
  // Konton med ett delsystem ska med även när huvudboken är tyst. En fordran
  // som finns i fakturaregistret men inte är bokförd är en skillnad – att inte
  // ta upp kontot vore att kalla den skillnaden noll.
  for (const account of tieOutAccounts(fy)) accounts.add(account);

  const rows: BalanceAccountReconciliation[] = [];
  for (const account of [...accounts].sort((a, b) => a - b)) {
    const row = reconcileAccount(account, fy);
    // Ett tomt konto utan delsystemsvärde är inget att svara på.
    if (row.ledger === 0 && (row.subsystem ?? 0) === 0 && row.ok) continue;
    rows.push(row);
  }
  const unexplained = rows.filter((r) => !r.ok);
  const manual = rows.filter((r) => r.manual);
  return { fiscalYearId, rows, unexplained, manual, ok: unexplained.length === 0 };
}

/** Balanskonton som har ett delsystem att stämmas av mot. */
function tieOutAccounts(fy: FiscalYear): number[] {
  const accounts = new Set<number>([
    1510,
    2440,
    1930,
    SKATTEKONTO,
    MOMS_REDOVISNING,
    PERSONALSKATT,
    ARBETSGIVARAVGIFT,
    ...Object.keys(ACCRUAL_ACCOUNTS).map(Number),
  ]);
  for (const asset of db().assets) {
    if (asset.status === "utrangerad") continue;
    accounts.add(asset.assetAccount);
    accounts.add(asset.accumulatedDepreciationAccount);
  }
  for (const [account, spec] of Object.entries(SCHEDULE_ACCOUNT_SUBSYSTEM)) {
    if (yearEndScheduleFor(fy.id, spec.kind)) accounts.add(Number(account));
  }
  return [...accounts];
}

function reconcileAccount(account: number, fy: FiscalYear): BalanceAccountReconciliation {
  const ledger = accountBalance(account, fy.endDate);
  const base = { account, name: accountName(account), ledger };

  // 1510 Kundfordringar ↔ de obetalda fakturorna.
  if (account === 1510) {
    const open = db().invoices.filter((i) => isOpenReceivable(i) && bokforingsdatum(i.issueDate) <= fy.endDate);
    const subsystem = open.reduce((s, i) => s + invoiceOutstanding(i), 0);
    return tie({
      ...base,
      subsystem,
      source: "kundfakturor",
      detail: `${open.length} obetald${open.length === 1 ? "" : "a"} faktura${open.length === 1 ? "" : "or"} på ${subsystem} kr.`,
      href: "/ekonomi?flik=fakturor",
      hrefLabel: "Visa fakturorna",
    });
  }

  // 2440 Leverantörsskulder ↔ de obetalda leverantörsfakturorna.
  if (account === 2440) {
    const open = db().supplierInvoices.filter(
      (s) => s.status === "obetald" && s.accountingStatus === "bokford" && bokforingsdatum(s.date) <= fy.endDate
    );
    const subsystem = -open.reduce((s, i) => s + i.amount, 0);
    return tie({
      ...base,
      subsystem,
      source: "leverantorsfakturor",
      detail: `${open.length} obetald${open.length === 1 ? "" : "a"} leverantörsfaktura${open.length === 1 ? "" : "or"} på ${-subsystem} kr.`,
      href: "/bokforing",
      hrefLabel: "Öppna bokföringen",
    });
  }

  // 1930 Företagskonto ↔ bankens saldo. Utan kopplad bank finns inget
  // delsystem: att jämföra med noll vore att påstå att saldot är fel.
  if (account === 1930) {
    if (db().bankAccounts.length === 0) {
      return {
        ...base,
        difference: 0,
        source: "ingen",
        detail: `Ingen bank är kopplad, så saldot ${ledger} kr går inte att stämma av automatiskt. Jämför mot bankens kontoutdrag.`,
        ok: true,
        manual: true,
        href: "/ekonomi?flik=bank",
        hrefLabel: "Öppna banken",
      };
    }
    // Ohanterade transaktioner förklarar en skillnad; bara resten är en avvikelse.
    const bank = bankReconciliation();
    return {
      ...base,
      subsystem: bank.bankBalance,
      difference: -bank.unexplained,
      source: "bank",
      detail: bank.unhandled.length
        ? `${bank.unhandled.length} banktransaktion${bank.unhandled.length === 1 ? "" : "er"} är inte bokförd${bank.unhandled.length === 1 ? "" : "a"} – de förklarar ${bank.unhandledSum} kr av skillnaden.`
        : `Bankens saldo är ${bank.bankBalance} kr.`,
      ok: bank.unexplained === 0,
      href: "/ekonomi?flik=bank",
      hrefLabel: "Öppna banken",
    };
  }

  // 1630 Skattekontot ↔ Skatteverket. Utdraget klistras in på skattekontosidan.
  if (account === SKATTEKONTO) {
    return {
      ...base,
      difference: 0,
      source: "skattekonto",
      detail: `Bokfört saldo ${ledger} kr. Stäm av mot Skatteverkets kontoutdrag på skattekontosidan.`,
      ok: true,
      manual: true,
      href: "/bokforing/skattekonto",
      hrefLabel: "Öppna skattekontot",
    };
  }

  // Momskontona ↔ momsrapporten. Deklarerade perioder är flyttade till 2650,
  // så momskontona ska vara nollade för perioder som är klara.
  if (account >= 2610 && account <= 2649) {
    const undeclared = undeclaredVatPeriods(fy);
    const subsystem = undeclared.reduce((s, p) => s + vatAccountShare(account, p.start, p.end), 0);
    return tie({
      ...base,
      subsystem,
      source: "momsrapport",
      detail: undeclared.length
        ? `Momsen för ${undeclared.map((p) => p.label).join(", ")} är inte deklarerad – saldot ska vara den perioden.`
        : "Alla perioder är deklarerade, så kontot ska vara nollat mot 2650.",
      href: "/bokforing/moms",
      hrefLabel: "Öppna momsöversikten",
    });
  }

  // 2650 Momsredovisning ↔ deklarerad men inte betald moms.
  if (account === MOMS_REDOVISNING) {
    const subsystem = ledger;
    return {
      ...base,
      subsystem,
      difference: 0,
      source: "momsrapport",
      detail:
        ledger === 0
          ? "Ingen deklarerad moms väntar på skattekontot."
          : `${Math.abs(ledger)} kr ${ledger < 0 ? "att betala" : "att få tillbaka"} är deklarerat men inte fört till skattekontot.`,
      ok: true,
      href: "/bokforing/skattekonto",
      hrefLabel: "Öppna skattekontot",
    };
  }

  // 2710/2731 ↔ arbetsgivardeklarationerna som inte förts till skattekontot.
  if (account === PERSONALSKATT || account === ARBETSGIVARAVGIFT) {
    const pending = employerDeclarations().filter(
      (d) => d.status !== "deklarerad" && d.month >= fy.startDate.slice(0, 7) && d.month <= fy.endDate.slice(0, 7)
    );
    const subsystem = -pending.reduce(
      (s, d) => s + (account === PERSONALSKATT ? d.tax : d.employerContribution),
      0
    );
    return tie({
      ...base,
      subsystem,
      source: "arbetsgivardeklaration",
      detail: pending.length
        ? `${pending.map((d) => d.label).join(", ")} är inte deklarerad${pending.length === 1 ? "" : "e"} – skulden ska vara de månaderna.`
        : "Alla månader är deklarerade och förda till skattekontot, så kontot ska vara nollat.",
      href: "/bokforing/lon",
      hrefLabel: "Öppna lönen",
    });
  }

  // Inventarier ↔ inventarieregistret.
  if (isAssetAccount(account)) {
    const assets = db().assets.filter((a) => a.assetAccount === account && a.status !== "utrangerad");
    const subsystem = assets.reduce((s, a) => s + a.acquisitionValue, 0);
    return tie({
      ...base,
      subsystem,
      source: "inventarieregister",
      detail: `${assets.length} inventarie${assets.length === 1 ? "" : "r"} med anskaffningsvärde ${subsystem} kr, bokfört värde ${assets.reduce((s, a) => s + bookValue(a), 0)} kr.`,
      href: "/bokforing/bokslut",
      hrefLabel: "Öppna bokslutet",
    });
  }
  if (isAccumulatedDepreciationAccount(account)) {
    const assets = db().assets.filter((a) => a.accumulatedDepreciationAccount === account && a.status !== "utrangerad");
    const subsystem = -assets.reduce((s, a) => s + accumulatedDepreciation(a), 0);
    return tie({
      ...base,
      subsystem,
      source: "inventarieregister",
      detail: `Ackumulerade avskrivningar enligt registret: ${-subsystem} kr.`,
      href: "/bokforing/bokslut",
      hrefLabel: "Öppna bokslutet",
    });
  }

  // Interimskontona ↔ periodiseringarna.
  const accrualKind = ACCRUAL_ACCOUNTS[account];
  if (accrualKind) {
    const booked = db().accruals.filter((a) => a.fiscalYearId === fy.id && a.kind === accrualKind && a.status !== "planerad");
    const sign = account === 1710 || account === 1790 ? 1 : -1;
    const subsystem = sign * booked.reduce((s, a) => s + a.amount, 0);
    return tie({
      ...base,
      subsystem,
      source: "periodiseringar",
      detail: `${booked.length} periodisering${booked.length === 1 ? "" : "ar"} på ${Math.abs(subsystem)} kr.`,
      href: "/bokforing/bokslut",
      hrefLabel: "Öppna bokslutet",
    });
  }

  // Bilagekontona ↔ bokslutsbilagan.
  const scheduleAccount = SCHEDULE_ACCOUNT_SUBSYSTEM[account];
  if (scheduleAccount) {
    const schedule = yearEndScheduleFor(fy.id, scheduleAccount.kind);
    if (!schedule) {
      return {
        ...base,
        difference: ledger,
        source: "bokslutsbilaga",
        detail: `${accountName(account)} har saldo men ingen bokslutsbilaga – specifikationen saknas.`,
        ok: ledger === 0,
        href: "/bokforing/bokslut",
        hrefLabel: "Öppna bokslutet",
      };
    }
    const subsystem = -scheduleAccount.amount(schedule.closingAmount, schedule);
    return tie({
      ...base,
      subsystem,
      source: "bokslutsbilaga",
      detail: `Bilagan specificerar ${Math.abs(subsystem)} kr${schedule.status === "utkast" ? " (utkast – inte bokförd ännu)" : ""}.`,
      href: "/bokforing/bokslut",
      hrefLabel: "Öppna bokslutet",
    });
  }

  if (NO_SUBSYSTEM_EXPECTED.has(account)) {
    return {
      ...base,
      difference: 0,
      source: "ingen",
      detail: `${accountName(account)} följer av bolagets beslut och bokslutet, inte av ett delsystem.`,
      ok: true,
    };
  }

  /*
   * Kontot har saldo men inget delsystem – ett banklån, en skuld till en
   * aktieägare. Driva kan inte avgöra om saldot är rätt, och att stoppa
   * bokslutet på det vore att kräva ett svar användaren inte kan ge här.
   * Kontot listas därför som avstämt för hand, inte som en avvikelse.
   */
  return {
    ...base,
    difference: 0,
    source: "ingen",
    detail: `${accountName(account)} har saldo ${ledger} kr utan delsystem i Driva. Stäm av mot underlaget – lånebeskedet, avtalet eller motpartens uppgift – och lägg vid en specifikation.`,
    ok: true,
    manual: ledger !== 0,
  };
}

function tie(row: Omit<BalanceAccountReconciliation, "difference" | "ok"> & { subsystem: number }): BalanceAccountReconciliation {
  const difference = row.ledger - row.subsystem;
  return { ...row, difference, ok: difference === 0 };
}

/* -------------------------------- Hjälpare -------------------------------- */

const ACCRUAL_ACCOUNTS: Record<number, "forutbetald_kostnad" | "upplupen_kostnad" | "forutbetald_intakt" | "upplupen_intakt"> = {
  1710: "forutbetald_kostnad",
  1790: "upplupen_intakt",
  2970: "forutbetald_intakt",
  2990: "upplupen_kostnad",
};

const SCHEDULE_ACCOUNT_SUBSYSTEM: Record<
  number,
  { kind: "semesterloneskuld" | "kundfordringar_nedskrivning" | "periodiseringsfond"; amount: (closing: number, schedule: { lines: { amount: number }[] }) => number }
> = {
  [SEMESTERLONESKULD]: { kind: "semesterloneskuld", amount: (closing) => closing },
  // Avgifterna står som egen rad i bilagan, efter skulden.
  [UPPLUPNA_SOCIALA_AVGIFTER]: {
    kind: "semesterloneskuld",
    amount: (_closing, schedule) => schedule.lines[1]?.amount ?? 0,
  },
  [NEDSKRIVNING_KUNDFORDRINGAR]: { kind: "kundfordringar_nedskrivning", amount: (closing) => closing },
  [PERIODISERINGSFOND]: { kind: "periodiseringsfond", amount: (closing) => closing },
};

function isAssetAccount(account: number): boolean {
  return db().assets.some((a) => a.assetAccount === account);
}

function isAccumulatedDepreciationAccount(account: number): boolean {
  return db().assets.some((a) => a.accumulatedDepreciationAccount === account);
}

/** Momsperioder i året som inte är deklarerade. */
function undeclaredVatPeriods(fy: FiscalYear): { start: string; end: string; label: string }[] {
  const reports = db().vatReports;
  return vatPeriodsOf(fy, vatPeriodicity())
    .filter((p) => {
      const report = reports.find((r) => r.periodStart === p.start && r.periodEnd === p.end);
      return report?.status !== "deklarerad";
    })
    .map((p) => ({ start: p.start, end: p.end, label: p.label }));
}

/** Ett momskontos nettosaldo i en period, med huvudbokens tecken. */
function vatAccountShare(account: number, start: string, end: string): number {
  let sum = 0;
  for (const v of db().verifications) {
    const d = bokforingsdatum(v.date);
    if (d < start || d > end) continue;
    for (const e of v.entries) {
      if (e.account === account) sum += e.debit - e.credit;
    }
  }
  return sum;
}

/** Momsläget för hela året – används av bokslutets upplysningar. */
export function vatPositionForYear(fy: FiscalYear) {
  return computeVatPosition({ key: `${fy.label}-helar`, label: fy.label, start: fy.startDate, end: fy.endDate });
}
