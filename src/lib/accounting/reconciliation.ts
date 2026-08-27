import { db } from "../store";
import type { BankTransaction } from "../types";
import { accountBalance } from "./ledger";
import { bokforingsdatum, todayDate } from "./dates";

/**
 * Bankavstämning: bankens saldo jämförs med bokföringens 1930.
 *
 * Avstämningen härleds – den lagras inte. En transaktion är hanterad när den
 * är bokförd (status "bokford" med verifikation). Skillnaden mellan bankens
 * saldo och 1930 ska vara summan av ohanterade transaktioner; allt annat är
 * en verklig avvikelse som visas öppet.
 */
export interface BankReconciliation {
  /** Bankens saldo enligt (mock-)banken. */
  bankBalance: number;
  /** Bokfört saldo på 1930 t.o.m. idag. */
  ledgerBalance: number;
  /** bankBalance − ledgerBalance. 0 = fullt avstämt. */
  difference: number;
  /** Transaktioner som inte är bokförda ännu (förklarar normalt hela skillnaden). */
  unhandled: BankTransaction[];
  /** Summan av ohanterade transaktioner. */
  unhandledSum: number;
  /** Avvikelse som INTE förklaras av ohanterade transaktioner. */
  unexplained: number;
  /** Datum för senaste bokförda banktransaktion = "Avstämt till". */
  reconciledThrough?: string;
  ok: boolean;
}

export function bankReconciliation(): BankReconciliation {
  const data = db();
  const bankBalance = data.bankAccounts.reduce((s, a) => s + a.balance, 0);
  const ledgerBalance = accountBalance(1930, todayDate());

  const unhandled = data.bankTransactions.filter((t) => t.status === "ny" || t.status === "behover_atgard");
  const unhandledSum = unhandled.reduce((s, t) => s + t.amount, 0);
  const difference = bankBalance - ledgerBalance;
  const unexplained = difference - unhandledSum;

  const booked = data.bankTransactions.filter((t) => t.status === "bokford");
  const reconciledThrough = booked.length
    ? booked.map((t) => bokforingsdatum(t.date)).sort((a, b) => b.localeCompare(a))[0]
    : undefined;

  return {
    bankBalance,
    ledgerBalance,
    difference,
    unhandled,
    unhandledSum,
    unexplained,
    reconciledThrough,
    ok: unhandled.length === 0 && unexplained === 0,
  };
}
