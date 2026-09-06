/**
 * CSV/TXT-läsare för prisfiler: avgränsare (; , tab |) identifieras
 * automatiskt, citattecken enligt RFC 4180 (dubbla citat, radbrytningar i
 * citerade fält), svenska decimaler lämnas orörda (tolkas senare).
 */
import {
  TABLE_LIMITS,
  TableLimitError,
  cleanCell,
  looksLikeHeaderRow,
  positionalHeader,
  type RawTable,
} from "./table";

export type CsvDelimiter = ";" | "," | "\t" | "|";

const CANDIDATES: CsvDelimiter[] = [";", "\t", ",", "|"];

/** Välj avgränsaren som ger flest och jämnast kolumner över de första raderna. */
export function detectDelimiter(text: string): CsvDelimiter {
  const sample = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0).slice(0, 25);
  if (sample.length === 0) return ";";
  let best: CsvDelimiter = ";";
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = sample.map((line) => countOutsideQuotes(line, d));
    const withDelimiter = counts.filter((c) => c > 0);
    if (withDelimiter.length === 0) continue;
    const median = [...withDelimiter].sort((a, b) => a - b)[Math.floor(withDelimiter.length / 2)];
    const consistent = withDelimiter.filter((c) => c === median).length / sample.length;
    // Fler kolumner och högre konsekvens vinner; ";" och tab får en liten
    // fördel eftersom svenska exporter nästan alltid använder dem.
    const bonus = d === ";" || d === "\t" ? 0.05 : 0;
    const score = median * consistent + bonus;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === d && !inQuotes) n += 1;
  }
  return n;
}

/** Tolka hela texten till rader av celler. */
export function parseCsvRows(text: string, delimiter: CsvDelimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let lineLength = 0;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const pushField = () => {
    row.push(cleanCell(field));
    field = "";
  };
  const pushRow = () => {
    if (row.length > TABLE_LIMITS.maxColumns) {
      throw new TableLimitError(`Filen har fler än ${TABLE_LIMITS.maxColumns} kolumner på rad ${rows.length + 1}.`);
    }
    if (row.some((c) => c.length > 0)) rows.push(row);
    if (rows.length > TABLE_LIMITS.maxRows) {
      throw new TableLimitError(
        `Filen innehåller fler än ${TABLE_LIMITS.maxRows.toLocaleString("sv-SE")} rader. Exportera ett mindre urval, t.ex. ert avtalssortiment.`,
      );
    }
    row = [];
    lineLength = 0;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    lineLength += 1;
    if (lineLength > TABLE_LIMITS.maxLineChars) {
      throw new TableLimitError(`Rad ${rows.length + 1} är orimligt lång och kan inte läsas.`);
    }
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      continue;
    }
    if (ch === "\r") {
      if (src[i + 1] === "\n") i += 1;
      pushField();
      pushRow();
      continue;
    }
    if (ch === "\n") {
      pushField();
      pushRow();
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows;
}

export function csvToTable(text: string, opts: { delimiter?: CsvDelimiter } = {}): RawTable {
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const rows = parseCsvRows(text, delimiter);
  if (rows.length === 0) {
    return { headers: [], rows: [], hasHeaderRow: false, firstDataRowNumber: 1 };
  }
  const width = Math.max(...rows.map((r) => r.length));
  const hasHeaderRow = looksLikeHeaderRow(rows[0]);
  const headers = hasHeaderRow
    ? rows[0].map((h, i) => h || positionalHeader(i))
    : Array.from({ length: width }, (_, i) => positionalHeader(i));
  while (headers.length < width) headers.push(positionalHeader(headers.length));
  return {
    headers,
    rows: hasHeaderRow ? rows.slice(1) : rows,
    hasHeaderRow,
    firstDataRowNumber: hasHeaderRow ? 2 : 1,
  };
}
