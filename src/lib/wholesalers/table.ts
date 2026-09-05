/**
 * Gemensam tabellform för alla prisfilsformat. Varje läsare (CSV/TXT, XLSX,
 * XML) producerar en RawTable; kolumnmappning och prisregler arbetar sedan
 * formatoberoende.
 */

export interface RawTable {
  /** Kolumnrubriker. Saknar filen rubrikrad blir de "#1", "#2", … */
  headers: string[];
  /** Datarader (utan rubrik). Kortare rader fylls inte ut – läs med cell(). */
  rows: string[][];
  /** Filen hade en riktig rubrikrad. */
  hasHeaderRow: boolean;
  /** Radnummer i källfilen för rows[0] (1-baserat) – för begripliga fel. */
  firstDataRowNumber: number;
}

export const TABLE_LIMITS = {
  maxRows: 60_000,
  maxColumns: 200,
  maxCellChars: 2_000,
  maxLineChars: 16_000,
} as const;

export class TableLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableLimitError";
  }
}

export function cell(row: string[], index: number): string {
  return index >= 0 && index < row.length ? row[index] : "";
}

/** Rubrik för kolumnindex – "#3" när filen saknar rubrikrad. */
export function positionalHeader(index: number): string {
  return `#${index + 1}`;
}

/**
 * Städa ett cellvärde: trimma, kollapsa whitespace, ta bort styrtecken och
 * neutralisera formelinjektion (=, +, -, @ i början) – värdena kan hamna i
 * CSV-export senare.
 */
export function cleanCell(raw: string): string {
  let s = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (s.length > TABLE_LIMITS.maxCellChars) s = s.slice(0, TABLE_LIMITS.maxCellChars);
  return s;
}

/** Texter som kan bli formler i kalkylprogram (Excel/Sheets) neutraliseras. */
export function neutralizeFormula(raw: string): string {
  return /^[=+\-@\t\r]/.test(raw) ? raw.replace(/^[=+\-@\t\r]+/, "").trim() : raw;
}

/** Ser raden ut som rubriker (mest text, inga priser/nummer)? */
export function looksLikeHeaderRow(row: string[]): boolean {
  const cells = row.map((c) => c.trim()).filter(Boolean);
  if (cells.length < 2) return false;
  const numeric = cells.filter((c) => /^[\d\s.,%-]+$/.test(c) && /\d/.test(c)).length;
  return numeric <= Math.floor(cells.length / 4);
}
