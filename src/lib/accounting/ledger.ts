import { db } from "../store";
import { BAS, isCostAccount, isRevenueAccount } from "../bas";
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
      r = { account, name: BAS[account] ?? `Konto ${account}`, ib: 0, debit: 0, credit: 0, ub: 0 };
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
      a = { account, name: BAS[account] ?? `Konto ${account}`, ib: 0, rows: [], ub: 0 };
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

/** Resultatkonton (3xxx–8xxx utom 8999 Årets resultat). */
export function isResultAccount(account: number): boolean {
  return account >= 3000 && account < 8999;
}

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
  skatt: number;
  omsattning: number;
  kostnaderSumma: number;
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
  let skatt = 0;
  for (const [account, net] of [...perAccount.entries()].sort((a, b) => a[0] - b[0])) {
    if (net === 0) continue;
    const name = BAS[account] ?? `Konto ${account}`;
    if (isRevenueAccount(account)) {
      intakter.push({ account, name, amount: -net });
    } else if (account >= 7800 && account < 7900) {
      avskrivningar.push({ account, name, amount: net });
    } else if (account >= 8900) {
      skatt += net;
    } else if (isCostAccount(account) || account >= 8000) {
      kostnader.push({ account, name, amount: net });
    }
  }

  const omsattning = intakter.reduce((s, r) => s + r.amount, 0);
  const kostnaderSumma = kostnader.reduce((s, r) => s + r.amount, 0) + avskrivningar.reduce((s, r) => s + r.amount, 0);
  const resultatForeSkatt = omsattning - kostnaderSumma;
  return {
    range: { from, to },
    intakter,
    kostnader,
    avskrivningar,
    skatt,
    omsattning,
    kostnaderSumma,
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
    if (r.account < 2000) {
      tillgangar.push({ account: r.account, name: r.name, amount: r.ub });
    } else if (r.account < 3000) {
      const rad = { account: r.account, name: r.name, amount: -r.ub };
      if (r.account < 2100) egetKapital.push(rad);
      else skulder.push(rad);
    } else if (isResultAccount(r.account)) {
      // Resultatkonton påverkar beräknat resultat tills året stängs.
      resultatEffekt += r.ub;
    } else if (r.account === 8999) {
      // Årets resultat-konto: redan omfört till eget kapital.
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
