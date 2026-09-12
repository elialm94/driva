/**
 * Hjälpfunktioner för fastbreddsfiler (positionsstyrda fält).
 *
 *   * Avkodning: strikt UTF-8, annars ISO-8859-1 (Latin-1, byte → U+00XX) –
 *     aldrig browserns/Windows-1252-gissning. Positionerna i specarna är
 *     byteposition i en ISO-8859-1-fil = teckenposition efter avkodning.
 *   * Radslut: CRLF/CR/LF normaliseras. Raderna trimmas ALDRIG innan fälten
 *     skurits ut – positionerna är det som bär betydelsen.
 *
 * Klientsäker frånsett `decodeFixedWidthText` (Buffer).
 */
import { WholesalerFileParseError } from "./types";

export type FixedWidthEncoding = "utf-8" | "iso-8859-1";

/** Strikt UTF-8 om det går, annars explicit ISO-8859-1. En BOM tas bort. */
export function decodeFixedWidthText(bytes: Buffer): { text: string; encoding: FixedWidthEncoding } {
  const body =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body), encoding: "utf-8" };
  } catch {
    return { text: body.toString("latin1"), encoding: "iso-8859-1" };
  }
}

/**
 * Dela upp i rader utan att trimma. Tomma rader (bara radslut) hoppas över –
 * en rad med blanksteg är däremot en rad och valideras som en sådan.
 */
export function splitFixedWidthLines(text: string): string[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return src.split(/\r\n|\r|\n/).filter((line) => line.length > 0);
}

/** Fält enligt spec: 1-indexerade, inklusiva teckenpositioner. */
export function field(line: string, from: number, to: number): string {
  return line.slice(from - 1, to);
}

/** Högertrimmat fält (alfafält är blankutfyllda till höger). */
export function alphaField(line: string, from: number, to: number): string {
  return field(line, from, to).trimEnd();
}

export function isDigits(value: string): boolean {
  return /^\d+$/.test(value);
}

export function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * Numeriskt fält: bara siffror (nollutfyllt). Kastar med begripligt fel.
 * `label` är fältets namn i specen så att felet går att slå upp.
 */
export function numericField(line: string, from: number, to: number, label: string, row: number): number {
  const raw = field(line, from, to);
  if (!isDigits(raw)) {
    throw new WholesalerFileParseError(`fältet ${label} (tecken ${from}–${to}) ska vara siffror men är "${raw}".`, row);
  }
  return Number(raw);
}

/**
 * Datum YYMMDD → YYYY-MM-DD. Nollställt fält = inget datum. Ogiltiga datum
 * kastar – ett rabattavtal med okänt slutdatum får inte tolkas tyst.
 */
export function parseYYMMDD(raw: string, label: string, row: number): string | undefined {
  if (!isDigits(raw) || raw.length !== 6) {
    throw new WholesalerFileParseError(`fältet ${label} ska vara ett datum (ÅÅMMDD) men är "${raw}".`, row);
  }
  if (raw === "000000") return undefined;
  const yy = Number(raw.slice(0, 2));
  const mm = Number(raw.slice(2, 4));
  const dd = Number(raw.slice(4, 6));
  const year = 2000 + yy;
  const date = new Date(Date.UTC(year, mm - 1, dd));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) {
    throw new WholesalerFileParseError(`fältet ${label} innehåller ett ogiltigt datum "${raw}".`, row);
  }
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Tiondels procent → procent med en decimal ("420" → 42). */
export function tenthsToPercent(tenths: number): number {
  return tenths / 10;
}

/** "42 %", "34,7 %" – svensk visning av tiondels procent. */
export function formatTenths(tenths: number): string {
  return `${tenthsToPercent(tenths).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %`;
}
