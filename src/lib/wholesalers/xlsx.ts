/**
 * XLSX-läsare utan externa beroenden: ZIP + de XML-delar som behövs
 * (arbetsbok → första kalkylbladet, delade strängar, celler).
 *
 * Tal skrivs ut med decimalkomma ("1234,5") så att den svenska pristolkaren
 * aldrig behöver gissa om en punkt är tusentals- eller decimaltecken.
 * Formler evalueras inte – bara det cachade värdet läses. Datum/format
 * behövs inte för prisfiler.
 */
import { listZipEntries, readZipEntry, zipEntryByName, ZipError, type ZipEntry } from "./zip";
import { childrenNamed, firstChild, localName, parseXml, textContent, type XmlElement } from "./xml";
import {
  TABLE_LIMITS,
  TableLimitError,
  cleanCell,
  looksLikeHeaderRow,
  positionalHeader,
  type RawTable,
} from "./table";

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxError";
  }
}

export function isXlsx(buffer: Buffer): boolean {
  try {
    const entries = listZipEntries(buffer);
    return Boolean(zipEntryByName(entries, "xl/workbook.xml") || zipEntryByName(entries, "[Content_Types].xml"));
  } catch {
    return false;
  }
}

function readXml(buffer: Buffer, entries: ZipEntry[], name: string): XmlElement | undefined {
  const entry = zipEntryByName(entries, name);
  if (!entry) return undefined;
  return parseXml(readZipEntry(buffer, entry).toString("utf8"));
}

/** Sökvägen till första kalkylbladet via workbook.xml + relationer. */
function firstSheetPath(buffer: Buffer, entries: ZipEntry[]): string {
  const workbook = readXml(buffer, entries, "xl/workbook.xml");
  const rels = readXml(buffer, entries, "xl/_rels/workbook.xml.rels");
  const sheets = workbook ? childrenNamed(firstChild(workbook, "sheets") ?? workbook, "sheet") : [];
  const relTargets = new Map<string, string>();
  for (const rel of rels ? childrenNamed(rels, "Relationship") : []) {
    if (rel.attrs.Id && rel.attrs.Target) relTargets.set(rel.attrs.Id, rel.attrs.Target);
  }
  const first = sheets[0];
  const relId = first ? Object.entries(first.attrs).find(([k]) => localName(k) === "id")?.[1] : undefined;
  let target = relId ? relTargets.get(relId) : undefined;
  if (!target) {
    const fallback = entries.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.name));
    if (!fallback) throw new XlsxError("Excel-filen innehåller inget kalkylblad som kan läsas.");
    return fallback.name;
  }
  target = target.replace(/^\//, "");
  if (!target.startsWith("xl/")) target = `xl/${target}`;
  return target;
}

function sharedStrings(buffer: Buffer, entries: ZipEntry[]): string[] {
  const sst = readXml(buffer, entries, "xl/sharedStrings.xml");
  if (!sst) return [];
  return childrenNamed(sst, "si").map((si) => textContent(si));
}

/** "AB12" → kolumnindex 27 (0-baserat). */
export function columnIndexFromRef(ref: string): number {
  const letters = ref.replace(/[^A-Za-z]/g, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function formatNumber(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  // Upp till 6 decimaler, utan flyttalsbrus, decimalkomma.
  return String(Number(n.toFixed(6))).replace(".", ",");
}

function cellValue(c: XmlElement, strings: string[]): string {
  const type = c.attrs.t ?? "n";
  if (type === "inlineStr") {
    const is = firstChild(c, "is");
    return is ? textContent(is) : "";
  }
  const v = firstChild(c, "v");
  const raw = v ? v.text : "";
  if (type === "s") {
    const idx = Number(raw);
    return Number.isInteger(idx) ? strings[idx] ?? "" : "";
  }
  if (type === "b") return raw === "1" ? "Ja" : "Nej";
  if (type === "str" || type === "e") return raw;
  return raw ? formatNumber(raw) : "";
}

export function xlsxToTable(buffer: Buffer): RawTable {
  let entries: ZipEntry[];
  try {
    entries = listZipEntries(buffer);
  } catch (e) {
    throw new XlsxError(e instanceof ZipError ? e.message : "Excel-filen kunde inte öppnas.");
  }
  const sheetPath = firstSheetPath(buffer, entries);
  const sheetEntry = zipEntryByName(entries, sheetPath);
  if (!sheetEntry) throw new XlsxError("Excel-filens kalkylblad saknas i arkivet.");
  const strings = sharedStrings(buffer, entries);
  const sheet = parseXml(readZipEntry(buffer, sheetEntry).toString("utf8"));
  const sheetData = firstChild(sheet, "sheetData");
  if (!sheetData) throw new XlsxError("Excel-filens kalkylblad är tomt.");

  const rows: string[][] = [];
  for (const rowEl of childrenNamed(sheetData, "row")) {
    const cells: string[] = [];
    let next = 0;
    for (const c of childrenNamed(rowEl, "c")) {
      const idx = c.attrs.r ? columnIndexFromRef(c.attrs.r) : next;
      if (idx >= TABLE_LIMITS.maxColumns) {
        throw new TableLimitError(`Excel-filen har fler än ${TABLE_LIMITS.maxColumns} kolumner.`);
      }
      while (cells.length < idx) cells.push("");
      cells[idx] = cleanCell(cellValue(c, strings));
      next = idx + 1;
    }
    if (cells.some((v) => v.length > 0)) rows.push(cells);
    if (rows.length > TABLE_LIMITS.maxRows) {
      throw new TableLimitError(
        `Excel-filen innehåller fler än ${TABLE_LIMITS.maxRows.toLocaleString("sv-SE")} rader. Exportera ett mindre urval.`,
      );
    }
  }
  if (rows.length === 0) return { headers: [], rows: [], hasHeaderRow: false, firstDataRowNumber: 1 };

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
