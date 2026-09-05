import { db } from "../store";
import { accountName, accountSection, accountType, isResultAccount } from "./chart";
import type { FiscalYear, Verification } from "../types";
import { bokforingsdatum, fiscalYearFor, todayDate } from "./fiscal";
import { verificationLabel } from "./engine";

/**
 * Huvudbok och saldobalans. Allt härleds ur verifikationsraderna – ingen
 * dubbellagrad data. Aggregeras på servern; klienten får färdiga rader.
 */

export interface DateRange {
  /** YYYY-MM-DD, inklusive. */
  from: string;
  to: string;
}

function vDate(v: Verification): string {
  return bokforingsdatum(v.date);
}

/** Verifikationer sorterade på bokföringsdatum + nummer. */
export function verificationsInRange(range?: Partial<DateRange>): Verification[] {
  // Beräkna datumet en gång per verifikation – i sorteringskomparatorn körs
  // vDate annars O(n log n) gånger, vilket märks vid tusentals verifikationer.
  const withDate: { v: Verification; d: string }[] = [];
  for (const v of db().verifications) {
    const d = vDate(v);
    if (range?.from && d < range.from) continue;
    if (range?.to && d > range.to) continue;
    withDate.push({ v, d });
  }
  withDate.sort((a, b) => a.d.localeCompare(b.d) || a.v.number - b.v.number);
  return withDate.map((x) => x.v);
}

/** IB för ett konto vid ett datum: räkenskapsårets IB + rörelser från årets start fram till (exkl.) datumet. */
export function openingBalance(account: number, atDate: string): number {
  const fy = fiscalYearFor(atDate);
  const ib = fy ? (fy.openingBalances[String(account)] ?? 0) : 0;
  const from = fy?.startDate;
  let movement = 0;
  for (const v of db().verifications) {
    const d = vDate(v);
    if (d >= atDate) continue;
    if (from && d < from) continue;
    for (const e of v.entries) {
      if (e.account === account) movement += e.debit - e.credit;
    }
  }
  return ib + movement;
}

/** Saldo (debet positivt) för ett konto till och med ett datum. */
export function accountBalance(account: number, toDate: string = todayDate()): number {
  const fy = fiscalYearFor(toDate);
  const ib = fy ? (fy.openingBalances[String(account)] ?? 0) : 0;
  const from = fy?.startDate;
  let movement = 0;
  for (const v of db().verifications) {
    const d = vDate(v);
    if (d > toDate) continue;
    if (from && d < from) continue;
    for (const e of v.entries) {
      if (e.account === account) movement += e.debit - e.credit;
    }
  }
  return ib + movement;
}

export interface SaldobalansRow {
  account: number;
  name: string;
  ib: number;
  debit: number;
  credit: number;
  ub: number;
}

export interface Saldobalans {
  range: DateRange;
  fiscalYear?: FiscalYear;
  rows: SaldobalansRow[];
  sumIb: number;
  sumDebit: number;
  sumCredit: number;
  sumUb: number;
}

/**
 * Saldobalans för ett intervall (default: räkenskapsåret hittills).
 * IB = årets ingående balans + rörelser före intervallet (inom året).
 */
export function saldobalans(range?: Partial<DateRange>): Saldobalans {
  const to = range?.to ?? todayDate();
  const fy = fiscalYearFor(to);
  const from = range?.from ?? fy?.startDate ?? `${to.slice(0, 4)}-01-01`;

  const accounts = new Map<number, SaldobalansRow>();
  const row = (account: number): SaldobalansRow => {
    let r = accounts.get(account);
    if (!r) {
      r = { account, name: accountName(account), ib: 0, debit: 0, credit: 0, ub: 0 };
      accounts.set(account, r);
    }
    return r;
  };

  // IB från räkenskapsåret (balanskonton bär med sig IB).
  if (fy) {
    for (const [account, amount] of Object.entries(fy.openingBalances)) {
      if (amount !== 0) row(Number(account)).ib += amount;
    }
  }

  for (const v of db().verifications) {
    const d = vDate(v);
    if (fy && d < fy.startDate) continue;
    if (d > to) continue;
    for (const e of v.entries) {
      if (d < from) {
        row(e.account).ib += e.debit - e.credit;
      } else {
        const r = row(e.account);
        r.debit += e.debit;
        r.credit += e.credit;
      }
    }
  }

  const rows = [...accounts.values()]
    .map((r) => ({ ...r, ub: r.ib + r.debit - r.credit }))
    .filter((r) => r.ib !== 0 || r.debit !== 0 || r.credit !== 0)
    .sort((a, b) => a.account - b.account);

  return {
    range: { from, to },
    fiscalYear: fy,
    rows,
    sumIb: rows.reduce((s, r) => s + r.ib, 0),
    sumDebit: rows.reduce((s, r) => s + r.debit, 0),
    sumCredit: rows.reduce((s, r) => s + r.credit, 0),
    sumUb: rows.reduce((s, r) => s + r.ub, 0),
  };
}

export interface HuvudbokRow {
  date: string;
  verificationId: string;
  verificationLabel: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface HuvudbokAccount {
  account: number;
  name: string;
  ib: number;
  rows: HuvudbokRow[];
  ub: number;
}

/** Huvudbok: alla rader per konto med löpande saldo, för ett intervall. */
export function huvudbok(range?: Partial<DateRange> & { account?: number }): HuvudbokAccount[] {
  const to = range?.to ?? todayDate();
  const fy = fiscalYearFor(to);
  const from = range?.from ?? fy?.startDate ?? `${to.slice(0, 4)}-01-01`;

  const accounts = new Map<number, HuvudbokAccount>();
  const acc = (account: number): HuvudbokAccount => {
    let a = accounts.get(account);
    if (!a) {
      a = { account, name: accountName(account), ib: 0, rows: [], ub: 0 };
      accounts.set(account, a);
    }
    return a;
  };

  if (fy) {
    for (const [account, amount] of Object.entries(fy.openingBalances)) {
      if (amount !== 0 && (!range?.account || Number(account) === range.account)) acc(Number(account)).ib += amount;
    }
  }

  for (const v of verificationsInRange({ to })) {
    const d = vDate(v);
    if (fy && d < fy.startDate) continue;
    for (const e of v.entries) {
      if (range?.account && e.account !== range.account) continue;
      if (d < from) {
        acc(e.account).ib += e.debit - e.credit;
      } else {
        acc(e.account).rows.push({
          date: d,
          verificationId: v.id,
          verificationLabel: verificationLabel(v),
          description: v.description,
          debit: e.debit,
          credit: e.credit,
          balance: 0,
        });
      }
    }
  }

  const result = [...accounts.values()]
    .filter((a) => a.ib !== 0 || a.rows.length > 0)
    .sort((a, b) => a.account - b.account);
  for (const a of result) {
    let balance = a.ib;
    for (const r of a.rows) {
      balance += r.debit - r.credit;
      r.balance = balance;
    }
    a.ub = balance;
  }
  return result;
}

/* ------------------------------ Resultatrapport ------------------------------ */

export { isResultAccount };

export interface ResultatRad {
  account: number;
  name: string;
  amount: number;
}

export interface Resultatrapport {
  range: DateRange;
  /** Positivt = intäkt. */
  intakter: ResultatRad[];
  /** Positivt = kostnad. */
  kostnader: ResultatRad[];
  avskrivningar: ResultatRad[];
  /** Finansiella intäkter och kostnader. Positivt = intäkt. */
  finansiellaIntakter: ResultatRad[];
  finansiellaKostnader: ResultatRad[];
  /** Bokslutsdispositioner. Positivt = ökar resultatet (återföring). */
  bokslutsdispositioner: ResultatRad[];
  skatt: number;
  omsattning: number;
  kostnaderSumma: number;
  /** Rörelseresultat: omsättning minus rörelsekostnader. */
  rorelseresultat: number;
  /** Netto av finansiella poster (positivt = intäktsöverskott). */
  finansiellaPosterNetto: number;
  /** Resultat efter finansiella poster. */
  resultatEfterFinansiellaPoster: number;
  /** Netto av bokslutsdispositioner. */
  bokslutsdispositionerNetto: number;
  /** Resultat före skatt (efter bokslutsdispositioner). */
  resultatForeSkatt: number;
  resultat: number;
}

export function resultatrapport(range?: Partial<DateRange>): Resultatrapport {
  const to = range?.to ?? todayDate();
  const fy = fiscalYearFor(to);
  const from = range?.from ?? fy?.startDate ?? `${to.slice(0, 4)}-01-01`;

  const perAccount = new Map<number, number>();
  for (const v of db().verifications) {
    const d = vDate(v);
    if (d < from || d > to) continue;
    for (const e of v.entries) {
      if (!isResultAccount(e.account)) continue;
      perAccount.set(e.account, (perAccount.get(e.account) ?? 0) + e.debit - e.credit);
    }
  }

  const intakter: ResultatRad[] = [];
  const kostnader: ResultatRad[] = [];
  const avskrivningar: ResultatRad[] = [];
  const finansiellaIntakter: ResultatRad[] = [];
  const finansiellaKostnader: ResultatRad[] = [];
  const bokslutsdispositioner: ResultatRad[] = [];
  let skatt = 0;
  // Klassificeringen följer kontots post i resultaträkningen, inte dess
  // nummerintervall – ett eget konto hamnar därför rätt utan specialfall.
  for (const [account, net] of [...perAccount.entries()].sort((a, b) => a[0] - b[0])) {
    if (net === 0) continue;
    const name = accountName(account);
    switch (accountSection(account)) {
      case "nettoomsattning":
      case "ovriga_rorelseintakter":
        intakter.push({ account, name, amount: -net });
        break;
      case "avskrivningar":
        avskrivningar.push({ account, name, amount: net });
        break;
      case "finansiella_intakter":
        finansiellaIntakter.push({ account, name, amount: -net });
        break;
      case "finansiella_kostnader":
        finansiellaKostnader.push({ account, name, amount: net });
        break;
      case "bokslutsdispositioner":
        bokslutsdispositioner.push({ account, name, amount: -net });
        break;
      case "skatt":
        skatt += net;
        break;
      default:
        kostnader.push({ account, name, amount: net });
    }
  }

  const omsattning = intakter.reduce((s, r) => s + r.amount, 0);
  const kostnaderSumma = kostnader.reduce((s, r) => s + r.amount, 0) + avskrivningar.reduce((s, r) => s + r.amount, 0);
  const rorelseresultat = omsattning - kostnaderSumma;
  const finansiellaPosterNetto =
    finansiellaIntakter.reduce((s, r) => s + r.amount, 0) - finansiellaKostnader.reduce((s, r) => s + r.amount, 0);
  const resultatEfterFinansiellaPoster = rorelseresultat + finansiellaPosterNetto;
  const bokslutsdispositionerNetto = bokslutsdispositioner.reduce((s, r) => s + r.amount, 0);
  const resultatForeSkatt = resultatEfterFinansiellaPoster + bokslutsdispositionerNetto;
  return {
    range: { from, to },
    intakter,
    kostnader,
    avskrivningar,
    finansiellaIntakter,
    finansiellaKostnader,
    bokslutsdispositioner,
    skatt,
    omsattning,
    kostnaderSumma,
    rorelseresultat,
    finansiellaPosterNetto,
    resultatEfterFinansiellaPoster,
    bokslutsdispositionerNetto,
    resultatForeSkatt,
    resultat: resultatForeSkatt - skatt,
  };
}

/* ------------------------------- Balansrapport ------------------------------- */

export interface BalansRad {
  account: number;
  name: string;
  /** Positivt enligt rapportens läsart (tillgångar debet+, EK/skulder kredit+). */
  amount: number;
}

export interface Balansrapport {
  atDate: string;
  tillgangar: BalansRad[];
  egetKapital: BalansRad[];
  skulder: BalansRad[];
  /** Årets resultat som ännu inte bokförts mot eget kapital (öppet år). */
  beraknatResultat: number;
  sumTillgangar: number;
  sumEgetKapital: number;
  sumSkulder: number;
  /** Ska alltid vara 0 – tillgångar minus (EK + skulder). */
  differens: number;
}

export function balansrapport(atDate: string = todayDate()): Balansrapport {
  const sb = saldobalans({ to: atDate });
  const tillgangar: BalansRad[] = [];
  const egetKapital: BalansRad[] = [];
  const skulder: BalansRad[] = [];
  let resultatEffekt = 0;

  for (const r of sb.rows) {
    if (r.ub === 0) continue;
    switch (accountType(r.account)) {
      case "tillgang":
        tillgangar.push({ account: r.account, name: r.name, amount: r.ub });
        break;
      case "eget_kapital":
        egetKapital.push({ account: r.account, name: r.name, amount: -r.ub });
        break;
      case "skuld":
        skulder.push({ account: r.account, name: r.name, amount: -r.ub });
        break;
      default:
        // Resultatkonton påverkar beräknat resultat tills året stängs, och
        // kontot årets resultat (8999) räknas med tills det är omfört.
        resultatEffekt += r.ub;
    }
  }

  const beraknatResultat = -resultatEffekt;
  const sumTillgangar = tillgangar.reduce((s, r) => s + r.amount, 0);
  const sumEgetKapital = egetKapital.reduce((s, r) => s + r.amount, 0) + beraknatResultat;
  const sumSkulder = skulder.reduce((s, r) => s + r.amount, 0);
  return {
    atDate,
    tillgangar,
    egetKapital,
    skulder,
    beraknatResultat,
    sumTillgangar,
    sumEgetKapital,
    sumSkulder,
    differens: sumTillgangar - sumEgetKapital - sumSkulder,
  };
}

/** Kontrollera att hela bokföringen balanserar (debet = kredit, IB = 0). Används av bokslutskontrollerna. */
export function ledgerIntegrity(): { balanced: boolean; unbalancedVerifications: string[]; openingBalanced: boolean } {
  const unbalanced: string[] = [];
  for (const v of db().verifications) {
    const diff = v.entries.reduce((s, e) => s + e.debit - e.credit, 0);
    if (diff !== 0) unbalanced.push(verificationLabel(v));
  }
  let openingBalanced = true;
  for (const fy of db().fiscalYears) {
    const sum = Object.values(fy.openingBalances).reduce((s, n) => s + n, 0);
    if (sum !== 0) openingBalanced = false;
  }
  return { balanced: unbalanced.length === 0, unbalancedVerifications: unbalanced, openingBalanced };
}
