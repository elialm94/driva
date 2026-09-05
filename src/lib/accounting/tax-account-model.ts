/**
 * Skattekontots begrepp: konton, händelsetyper och kontoutdraget.
 *
 * Rena värden utan lagringsberoende, så både serverkod och klientwidgets kan
 * läsa dem. Konteringen ligger i tax-account.ts.
 */

export const SKATTEKONTO = 1630;
/** Redovisningskonto för moms: momsen står här mellan deklaration och skattekonto. */
export const MOMS_REDOVISNING = 2650;
export const PERSONALSKATT = 2710;
export const ARBETSGIVARAVGIFT = 2731;
export const F_SKATT = 2518;

export type TaxAccountEventKind =
  | "inbetalning"
  | "moms"
  | "arbetsgivaravgift"
  | "personalskatt"
  | "f_skatt"
  | "ovrigt";

export const TAX_ACCOUNT_KIND_LABEL: Record<TaxAccountEventKind, string> = {
  inbetalning: "Inbetalning",
  moms: "Moms",
  arbetsgivaravgift: "Arbetsgivaravgifter",
  personalskatt: "Personalskatt",
  f_skatt: "F-skatt",
  ovrigt: "Övrigt",
};

export interface TaxAccountRow {
  verificationId: string;
  /** Verifikationsnummer med serie, t.ex. "A12". */
  label: string;
  date: string;
  description: string;
  kind: TaxAccountEventKind;
  /** Positivt = tillgodo på kontot (debet), negativt = uttag (kredit). */
  amount: number;
  /** Löpande saldo efter raden. */
  balance: number;
}

export interface TaxAccountStatementRow {
  /** YYYY-MM-DD. */
  date: string;
  text: string;
  /** Positivt = insättning, negativt = uttag. Skatteverkets tecken. */
  amount: number;
}

export interface TaxAccountReconciliation {
  /** Ingående balans plus utdragets rader – saldot utdraget leder till. */
  statementBalance: number;
  /** Saldo enligt bokföringen på 1630. */
  ledgerBalance: number;
  /** Antal rader i utdraget. */
  statementRows: number;
  /** statementBalance − ledgerBalance. 0 = avstämt. */
  difference: number;
  /** Rader i utdraget utan motsvarighet i bokföringen. */
  missingInLedger: TaxAccountStatementRow[];
  /** Bokförda rader som inte finns i utdraget. */
  missingInStatement: TaxAccountRow[];
  ok: boolean;
}

/**
 * Skatteverkets kontoutdrag klistras in som text: datum, beskrivning, belopp.
 * Tab, semikolon eller flera blanksteg skiljer kolumnerna – utdraget kopieras
 * oftast rakt ur "Mina sidor" och då blir det tabbar.
 */
export function parseTaxAccountStatement(text: string): TaxAccountStatementRow[] {
  const rows: TaxAccountStatementRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\t|;|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const date = parts[0].match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
    if (!date) continue;
    const amount = parseAmount(parts[parts.length - 1]);
    if (amount == null) continue;
    rows.push({ date, text: parts.slice(1, -1).join(" ") || "Rad", amount });
  }
  return rows;
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s|kr/gi, "").replace(/\u2212/g, "-").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  // Ören avrundas bort symmetriskt: Math.round drar −12,50 uppåt till −12, vilket
  // gör ett uttag mindre än det är.
  const n = Number(cleaned);
  return Math.sign(n) * Math.round(Math.abs(n));
}
