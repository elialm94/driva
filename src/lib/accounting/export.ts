import { bokforingsdatum } from "./dates";
import { huvudbok, resultatrapport, balansrapport, saldobalans, verificationsInRange, type DateRange } from "./ledger";
import { verificationLabel } from "./engine";
import { vatReportForPeriod, VAT_CODES } from "./vat";

/**
 * CSV-exporter för rapporterna. Semikolon som avgränsare och UTF-8 BOM så att
 * svensk Excel öppnar filerna direkt. Alla belopp i hela kronor.
 */

export const CSV_BOM = "\uFEFF";

function csv(rows: (string | number)[][]): string {
  const escape = (v: string | number): string => {
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return CSV_BOM + rows.map((r) => r.map(escape).join(";")).join("\r\n") + "\r\n";
}

export function verifikationerCsv(range?: Partial<DateRange>): string {
  const rows: (string | number)[][] = [["Verifikation", "Datum", "Beskrivning", "Konto", "Kontonamn", "Debet", "Kredit"]];
  for (const v of verificationsInRange(range)) {
    for (const e of v.entries) {
      rows.push([verificationLabel(v), bokforingsdatum(v.date), v.description, e.account, e.accountName, e.debit || "", e.credit || ""]);
    }
  }
  return csv(rows);
}

export function saldobalansCsv(range?: Partial<DateRange>): string {
  const sb = saldobalans(range);
  const rows: (string | number)[][] = [["Konto", "Kontonamn", "Ingående balans", "Debet", "Kredit", "Utgående balans"]];
  for (const r of sb.rows) rows.push([r.account, r.name, r.ib, r.debit, r.credit, r.ub]);
  rows.push(["", "Summa", sb.sumIb, sb.sumDebit, sb.sumCredit, sb.sumUb]);
  return csv(rows);
}

export function huvudbokCsv(range?: Partial<DateRange>): string {
  const rows: (string | number)[][] = [["Konto", "Kontonamn", "Datum", "Verifikation", "Beskrivning", "Debet", "Kredit", "Saldo"]];
  for (const a of huvudbok(range)) {
    rows.push([a.account, a.name, "", "", "Ingående saldo", "", "", a.ib]);
    for (const r of a.rows) rows.push([a.account, a.name, r.date, r.verificationLabel, r.description, r.debit || "", r.credit || "", r.balance]);
    rows.push([a.account, a.name, "", "", "Utgående saldo", "", "", a.ub]);
  }
  return csv(rows);
}

export function resultatCsv(range?: Partial<DateRange>): string {
  const rr = resultatrapport(range);
  const rows: (string | number)[][] = [["Post", "Konto", "Belopp"]];
  for (const r of rr.intakter) rows.push(["Intäkt", `${r.account} ${r.name}`, r.amount]);
  rows.push(["Summa omsättning", "", rr.omsattning]);
  for (const r of rr.kostnader) rows.push(["Kostnad", `${r.account} ${r.name}`, -r.amount]);
  for (const r of rr.avskrivningar) rows.push(["Avskrivning", `${r.account} ${r.name}`, -r.amount]);
  rows.push(["Summa kostnader", "", -rr.kostnaderSumma]);
  rows.push(["Resultat före skatt", "", rr.resultatForeSkatt]);
  if (rr.skatt !== 0) rows.push(["Skatt", "", -rr.skatt]);
  rows.push(["Resultat", "", rr.resultat]);
  return csv(rows);
}

export function balansCsv(atDate?: string): string {
  const br = balansrapport(atDate);
  const rows: (string | number)[][] = [["Del", "Konto", "Belopp"]];
  for (const r of br.tillgangar) rows.push(["Tillgångar", `${r.account} ${r.name}`, r.amount]);
  rows.push(["Summa tillgångar", "", br.sumTillgangar]);
  for (const r of br.egetKapital) rows.push(["Eget kapital", `${r.account} ${r.name}`, r.amount]);
  if (br.beraknatResultat !== 0) rows.push(["Eget kapital", "Beräknat resultat (ej bokslutat)", br.beraknatResultat]);
  rows.push(["Summa eget kapital", "", br.sumEgetKapital]);
  for (const r of br.skulder) rows.push(["Skulder", `${r.account} ${r.name}`, r.amount]);
  rows.push(["Summa skulder", "", br.sumSkulder]);
  return csv(rows);
}

/** Momsunderlag för en period: deklarationsrutor + konton bakom siffrorna. */
export function momsCsv(periodKey: string): string {
  const report = vatReportForPeriod(periodKey);
  if (!report) throw new Error("Det finns ingen momsrapport för perioden ännu.");
  const rows: (string | number)[][] = [["Ruta", "Beskrivning", "Belopp"]];
  for (const box of report.boxes) rows.push([box.code, box.label, box.amount]);
  rows.push(["", "Att betala (positivt) / få tillbaka (negativt)", report.attBetala]);
  rows.push([]);
  rows.push(["Momskod", "Konto", "Beskrivning"]);
  for (const def of VAT_CODES) rows.push([def.code, def.accounts.join(", "), def.label]);
  return csv(rows);
}
