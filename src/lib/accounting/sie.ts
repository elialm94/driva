import { db } from "../store";
import { accountName } from "./chart";
import type { FiscalYear } from "../types";
import { bokforingsdatum } from "./dates";
import { fiscalYears, fiscalYearFor } from "./fiscal";
import { isResultAccount, saldobalans } from "./ledger";

/**
 * SIE 4E-export: kontoplan, IB/UB/RES och samtliga verifikationer.
 *
 * Formatet följer SIE-gruppens specifikation (SIE 4, utläsning):
 *  - Teckenkodning PC8/CP437 (#FORMAT PC8) – svenska tecken mappas korrekt.
 *  - Datum YYYYMMDD, belopp i kronor med punkt som decimaltecken.
 *  - #VER med #TRANS-rader inom klamrar; debet positivt, kredit negativt.
 *
 * Exporten kan läsas in av gängse program (Fortnox, Visma, Björn Lundén m.fl.)
 * och av en redovisningskonsult.
 */

function sieEscape(text: string): string {
  return `"${text.replace(/[\r\n]+/g, " ").replace(/"/g, "'")}"`;
}

function sieDate(iso: string): string {
  return bokforingsdatum(iso).replace(/-/g, "");
}

function sieAmount(kronor: number): string {
  return `${kronor}.00`;
}

export function generateSie(fiscalYearId?: string): string {
  const data = db();
  const years = fiscalYears();
  const fy: FiscalYear | undefined = fiscalYearId
    ? years.find((f) => f.id === fiscalYearId)
    : (fiscalYearFor(bokforingsdatum(new Date().toISOString())) ?? years[years.length - 1]);
  if (!fy) throw new Error("Det finns inget räkenskapsår att exportera.");
  const prev = years.filter((f) => f.endDate < fy.startDate).at(-1);

  const lines: string[] = [];
  lines.push("#FLAGGA 0");
  lines.push("#PROGRAM \"Driva\" 1.0");
  lines.push("#FORMAT PC8");
  lines.push(`#GEN ${sieDate(new Date().toISOString())}`);
  lines.push("#SIETYP 4");
  lines.push(`#FNAMN ${sieEscape(data.settings.name)}`);
  lines.push(`#ORGNR ${data.settings.orgNumber.replace(/[^0-9-]/g, "")}`);
  lines.push(`#RAR 0 ${fy.startDate.replace(/-/g, "")} ${fy.endDate.replace(/-/g, "")}`);
  if (prev) lines.push(`#RAR -1 ${prev.startDate.replace(/-/g, "")} ${prev.endDate.replace(/-/g, "")}`);
  lines.push("#KPTYP EUBAS97");

  // Kontoplan: alla konton som förekommer i året (eller IB).
  const sb = saldobalans({ from: fy.startDate, to: fy.endDate });
  for (const row of sb.rows) {
    lines.push(`#KONTO ${row.account} ${sieEscape(accountName(row.account))}`);
  }

  // IB/UB för balanskonton, RES för resultatkonton.
  for (const row of sb.rows) {
    if (isResultAccount(row.account) || row.account === 8999) {
      const res = row.ub - row.ib;
      if (res !== 0) lines.push(`#RES 0 ${row.account} ${sieAmount(res)}`);
    } else {
      if (row.ib !== 0) lines.push(`#IB 0 ${row.account} ${sieAmount(row.ib)}`);
      if (row.ub !== 0) lines.push(`#UB 0 ${row.account} ${sieAmount(row.ub)}`);
    }
  }

  // Verifikationer i året.
  const vers = data.verifications
    .filter((v) => {
      const d = bokforingsdatum(v.date);
      return d >= fy.startDate && d <= fy.endDate;
    })
    .sort((a, b) => a.number - b.number);
  for (const v of vers) {
    const d = sieDate(v.date);
    lines.push(`#VER ${sieEscape(v.series)} ${v.number} ${d} ${sieEscape(v.description)} ${sieDate(v.postedAt ?? v.createdAt)}`);
    lines.push("{");
    for (const e of v.entries) {
      const amount = e.debit - e.credit;
      if (amount === 0) continue;
      lines.push(`#TRANS ${e.account} {} ${sieAmount(amount)} ${d} ${sieEscape(e.note ?? "")}`);
    }
    lines.push("}");
  }

  return lines.join("\r\n") + "\r\n";
}

/**
 * CP437-kodning (PC8) för svensk SIE-fil. Tecken utanför tabellen ersätts med "?".
 */
const CP437: Record<string, number> = {
  "å": 0x86, "ä": 0x84, "ö": 0x94, "Å": 0x8f, "Ä": 0x8e, "Ö": 0x99,
  "é": 0x82, "É": 0x90, "ü": 0x81, "Ü": 0x9a, "æ": 0x91, "Æ": 0x92,
  "ø": 0xed, "Ø": 0xe8, "ñ": 0xa4, "Ñ": 0xa5, "ç": 0x87, "Ç": 0x80,
  "à": 0x85, "è": 0x8a, "ê": 0x88, "î": 0x8c, "ô": 0x93, "û": 0x96,
  "–": 0x2d, "—": 0x2d, "’": 0x27, "”": 0x22, "“": 0x22, "…": 0x2e,
};

export function encodeSieToPc8(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    if (code < 0x80) bytes[i] = code;
    else bytes[i] = CP437[ch] ?? 0x3f; // "?"
  }
  return bytes;
}

/** Design för framtida import: typer och kontrakt, ingen implementation ännu. */
export interface SieImportPreview {
  companyName?: string;
  orgNumber?: string;
  fiscalYears: { startDate: string; endDate: string }[];
  accounts: { account: number; name: string }[];
  openingBalances: Record<string, number>;
  verificationCount: number;
  warnings: string[];
}

export interface SieImportHooks {
  /** Tolka en SIE-fil och visa vad som skulle importeras – utan att röra bokföringen. */
  preview(fileContent: Uint8Array): SieImportPreview;
  /** Importera ingående balanser till ett nytt räkenskapsår. */
  importOpeningBalances(preview: SieImportPreview, fiscalYearId: string): void;
}
