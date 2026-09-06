/**
 * Filtyp och teckenkodning för prisfiler. Innehållet vinner över filnamnet
 * (en ".csv" som egentligen är en XLSX läses som XLSX). Textkodning: BOM →
 * strikt UTF-8 → Windows-1252 (svenska exporter från äldre system).
 */
import type { WholesalerPriceFileKind } from "../types";
import { isZip, listZipEntries, readZipEntry, ZipError } from "./zip";
import { isXlsx } from "./xlsx";

export const MAX_PRICE_FILE_BYTES = 8 * 1024 * 1024;

export class PriceFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceFileError";
  }
}

export interface DetectedPriceFile {
  kind: WholesalerPriceFileKind;
  /** Textinnehåll för csv/txt/xml – alltid dekodat till en JS-sträng. */
  text?: string;
  /** Binärt innehåll för xlsx. */
  bytes?: Buffer;
  /** Namnet på filen som faktiskt lästes (inne i ett ZIP: den inre filen). */
  innerFilename: string;
  encoding: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
}

const SUPPORTED_EXT = /\.(csv|txt|xlsx|xml|zip)$/i;

export function isSupportedPriceFilename(name: string): boolean {
  return SUPPORTED_EXT.test(name.trim());
}

/** Dekoda text: BOM, annars strikt UTF-8, annars Windows-1252. */
export function decodeText(bytes: Buffer): { text: string; encoding: DetectedPriceFile["encoding"] } {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

function looksLikeXml(text: string): boolean {
  const head = text.slice(0, 200).trimStart();
  return head.startsWith("<?xml") || /^<[A-Za-z_][\w:.-]*[\s>]/.test(head);
}

/** Välj den första stödda filen i ett ZIP-arkiv (aldrig nästlade arkiv). */
function pickZipInner(buffer: Buffer): { name: string; bytes: Buffer } {
  let entries;
  try {
    entries = listZipEntries(buffer);
  } catch (e) {
    throw new PriceFileError(e instanceof ZipError ? e.message : "ZIP-arkivet kunde inte läsas.");
  }
  const candidates = entries
    .filter((e) => !e.name.endsWith("/") && e.uncompressedSize > 0)
    .filter((e) => !/(^|\/)(__MACOSX|\.)/.test(e.name))
    .filter((e) => /\.(csv|txt|xlsx|xml)$/i.test(e.name));
  if (candidates.length === 0) {
    if (entries.some((e) => /\.zip$/i.test(e.name))) {
      throw new PriceFileError("ZIP-arkivet innehåller ett annat ZIP-arkiv. Packa upp och ladda upp själva prisfilen.");
    }
    throw new PriceFileError("ZIP-arkivet innehåller ingen prisfil (CSV, TXT, XLSX eller XML).");
  }
  // Störst fil först – den är prislistan; små filer är ofta README/loggar.
  candidates.sort((a, b) => b.uncompressedSize - a.uncompressedSize);
  const entry = candidates[0];
  try {
    return { name: entry.name.split("/").pop() ?? entry.name, bytes: readZipEntry(buffer, entry) };
  } catch (e) {
    throw new PriceFileError(e instanceof ZipError ? e.message : "Filen i ZIP-arkivet kunde inte packas upp.");
  }
}

export function detectPriceFile(bytes: Buffer, filename: string): DetectedPriceFile {
  if (bytes.length === 0) throw new PriceFileError("Filen är tom.");
  if (bytes.length > MAX_PRICE_FILE_BYTES) {
    throw new PriceFileError("Prisfilen är för stor (max 8 MB). Dela upp filen eller exportera ett mindre urval.");
  }
  const ext = extensionOf(filename);

  if (isZip(bytes)) {
    if (isXlsx(bytes)) {
      return { kind: "xlsx", bytes, innerFilename: filename, encoding: "utf-8" };
    }
    const inner = pickZipInner(bytes);
    const detectedInner = detectPriceFile(inner.bytes, inner.name);
    if (detectedInner.kind === "zip") {
      throw new PriceFileError("ZIP-arkivet innehåller ett annat ZIP-arkiv. Packa upp och ladda upp själva prisfilen.");
    }
    return { ...detectedInner, kind: "zip", innerFilename: inner.name };
  }
  if (ext === "xlsx" || ext === "zip") {
    throw new PriceFileError(
      ext === "xlsx"
        ? "Filen är inte en giltig Excel-fil (.xlsx). Spara om den som .xlsx eller exportera till CSV."
        : "Filen är inte ett giltigt ZIP-arkiv.",
    );
  }
  if (ext === "xls") {
    throw new PriceFileError("Äldre Excel-format (.xls) stöds inte. Spara om filen som .xlsx eller CSV.");
  }

  const { text, encoding } = decodeText(bytes);
  if (text.includes("\u0000")) throw new PriceFileError("Filen ser ut att vara binär och kan inte läsas som text.");
  if (ext === "xml" || looksLikeXml(text)) {
    return { kind: "xml", text, innerFilename: filename, encoding };
  }
  if (ext === "csv" || ext === "txt" || ext === "tsv" || ext === "") {
    return { kind: ext === "txt" || ext === "tsv" ? "txt" : "csv", text, innerFilename: filename, encoding };
  }
  throw new PriceFileError("Filformatet stöds inte. Ladda upp CSV, TXT, XLSX, XML eller ett ZIP med någon av dem.");
}
