/**
 * Importmotor för grossisternas prisfiler – deterministisk, formatoberoende.
 *
 *   parsePriceFile   bytes + filnamn → tabell (CSV/TXT, XLSX, XML, ZIP med någon av dem)
 *   previewImport    tabell + (sparad/vald) mappning → förhandsgranskning med problem
 *   buildProducts    tabell + mappning → artiklar med prisregler + begripliga radfel
 *
 * Prisregler (aldrig gissade priser):
 *   1. uttryckligt nettopris i filen vinner
 *   2. annars listpris × (1 − rabatt), där rabatten kommer från raden eller
 *      från anslutningens rabattbrev via rabattgruppen
 *   3. finns varken netto eller listpris+rabatt lämnas inköpspriset tomt
 * Utpris från filen sparas separat och används bara om användaren valt det.
 *
 * Hela prislistor skickas aldrig till en LLM – allt här är regelbaserat.
 *
 * Före kolumnmappningen körs en FORMATDETEKTERING (formats/registry.ts):
 *   * känt grossistformat (t.ex. Ahlsell avtalsfil/prisfil, fast kolumnbredd)
 *     → filen tolkas med sin parser, ingen mappningsdialog
 *   * okänt avgränsat format (CSV/TSV) → dagens kolumnmappning
 *   * okänt fastbreddsformat → ärligt fel, ingen mappningsdialog
 */
import type {
  WholesalerColumnMapping,
  WholesalerFileFormatId,
  WholesalerPriceFileKind,
  WholesalerPriceImportError,
  WholesalerProduct,
} from "../types";
import { uid } from "../ids";
import { csvToTable } from "./csv";
import { xlsxToTable, XlsxError } from "./xlsx";
import { xmlToTable, XmlTableError } from "./xml-table";
import { XmlParseError } from "./xml";
import { detectPriceFile, PriceFileError, type DetectedPriceFile } from "./file-detect";
import { TableLimitError, cell, neutralizeFormula, type RawTable } from "./table";
import { columnIndexFor, detectColumnMapping, mappingProblems, type DetectedMapping } from "./column-mapping";
import { netFromDiscountOre, parseDecimal, parseOre, parsePercent } from "./money";
import { sanitizeImageUrl } from "./product-image";
import { ZipError } from "./zip";
import { decodeFixedWidthText } from "./formats/fixed-width";
import { detectWholesalerFormat } from "./formats/registry";
import {
  MIN_ROWS_FOR_KNOWN_FORMAT,
  WholesalerFileParseError,
  type ParsedPriceList,
  type ParsedWholesalerFile,
  type WholesalerFileParser,
} from "./formats/types";

export const MAX_IMPORT_ERRORS = 50;
export const PREVIEW_ROWS = 8;
const MAX_ARTICLE_NUMBER_CHARS = 64;
const MAX_NAME_CHARS = 200;

export interface KnownFormatFile {
  parser: WholesalerFileParser;
  file: ParsedWholesalerFile;
  encoding: "utf-8" | "iso-8859-1";
}

export interface ParsedPriceFile {
  detected: DetectedPriceFile;
  /** Tabellen för kolumnmappning. Tom när filen är ett känt grossistformat. */
  table: RawTable;
  /** Satt när filen känts igen som ett grossistformat – då gäller inte tabellen/mappningen. */
  known?: KnownFormatFile;
}

const EMPTY_TABLE: RawTable = { headers: [], rows: [], hasHeaderRow: false, firstDataRowNumber: 1 };

/**
 * Formatdetektering för textfiler. Innehållet avgör – aldrig filnamnet.
 * Returnerar undefined när filen ska gå vidare till kolumnmappningen.
 */
function detectKnownFormat(detected: DetectedPriceFile): KnownFormatFile | undefined {
  if (detected.kind === "xlsx" || detected.kind === "xml") return undefined;
  if (detected.kind === "zip" && (detected.bytes || /\.xml$/i.test(detected.innerFilename))) return undefined;
  const bytes = detected.textBytes;
  if (!bytes) return undefined;
  // Strikt UTF-8 annars ISO-8859-1 (grossisternas fastbreddsfiler) – aldrig
  // trimning före kolumnslicingen.
  const { text, encoding } = decodeFixedWidthText(bytes);
  const detection = detectWholesalerFormat(text);
  if (detection.outcome === "delimited") return undefined;
  if (detection.outcome === "too_short") {
    throw new PriceFileError(
      `Filen ser ut som ${detection.parser.label} men har bara ${detection.rows} datarader – minst ${MIN_ROWS_FOR_KNOWN_FORMAT} krävs för att formatet ska kännas igen säkert. Ladda upp hela filen från grossisten.`,
    );
  }
  if (detection.outcome === "fixed_width") {
    throw new PriceFileError(
      `Filen har fast kolumnbredd (rader på ${detection.lineLength} tecken) men formatet är inte känt. ` +
        "Kolumnmappning fungerar bara för filer med avgränsare (semikolon, tabb eller komma). " +
        "Skicka gärna filen till oss så lägger vi till formatet.",
    );
  }
  try {
    return { parser: detection.parser, file: detection.parser.parse(text), encoding };
  } catch (e) {
    if (e instanceof WholesalerFileParseError) {
      throw new PriceFileError(`Filen ser ut som ${detection.parser.label} men kunde inte tolkas. ${e.message}`);
    }
    throw e;
  }
}

/** Alla läsfel blir ett PriceFileError med begriplig svensk text. */
export function parsePriceFile(bytes: Buffer, filename: string): ParsedPriceFile {
  try {
    const detected = detectPriceFile(bytes, filename);
    const known = detectKnownFormat(detected);
    if (known) {
      return { detected: { ...detected, encoding: known.encoding }, table: EMPTY_TABLE, known };
    }
    let table: RawTable;
    if (detected.kind === "xlsx" || (detected.kind === "zip" && detected.bytes)) {
      table = xlsxToTable(detected.bytes!);
    } else if (detected.kind === "xml" || (detected.kind === "zip" && /\.xml$/i.test(detected.innerFilename))) {
      table = xmlToTable(detected.text ?? "");
    } else {
      table = csvToTable(detected.text ?? "");
    }
    if (table.rows.length === 0) {
      throw new PriceFileError("Filen innehåller inga datarader.");
    }
    return { detected, table };
  } catch (e) {
    if (e instanceof PriceFileError) throw e;
    if (
      e instanceof TableLimitError ||
      e instanceof XlsxError ||
      e instanceof XmlTableError ||
      e instanceof XmlParseError ||
      e instanceof ZipError
    ) {
      throw new PriceFileError(e.message);
    }
    throw new PriceFileError("Filen kunde inte läsas. Kontrollera att det är en prisfil i CSV, TXT, XLSX eller XML.");
  }
}

/** Sammanfattning av en fil i känt grossistformat – visas i stället för kolumnmappningen. */
export interface KnownFormatSummary {
  parserId: WholesalerFileFormatId;
  wholesaler: WholesalerFileParser["wholesaler"];
  formatLabel: string;
  kind: ParsedWholesalerFile["kind"];
  encoding: KnownFormatFile["encoding"];
  /** Datarader (exkl. huvudrad). */
  rowCount: number;
  /** Bara rabattavtal: huvudraden. */
  header?: {
    agreementType: "1" | "3";
    customerNumber: string;
    facilityNumber: string;
    name: string;
    chainDiscount: "J" | "N";
    runDate?: string;
  };
  /** Antal per radtyp, i visningsordning. */
  counts: Array<{ label: string; count: number }>;
  /** Giltigt till och med (senaste slutdatum i filen). Visas – blockerar aldrig. */
  endDate?: string;
  /** Varningar ur parsern (t.ex. avvikande kundnummer på rader). */
  warnings: string[];
  /** Kundnumret i filen skiljer sig från anslutningens. */
  customerNumberMismatch?: { file: string; connection: string };
  /** Rabattavtal laddas upp utan aktiv prislista – priserna kan inte räknas förrän prisfilen finns. */
  priceListMissing: boolean;
  /** Rader med KEDJERABATTKOD = J. Flaggas; ingen beräkning bygger på dem. */
  chainDiscountRows: number;
  /** Rabattavtalets täckning mot prislistan (fylls i servicen, som har katalogstoren). */
  coverage?: { articleCount: number; withoutTermsCount: number };
}

export interface ImportPreview {
  kind: WholesalerPriceFileKind;
  innerFilename: string;
  headers: string[];
  sampleRows: string[][];
  rowCount: number;
  mapping: WholesalerColumnMapping;
  confidence: DetectedMapping["confidence"];
  /** Saknade eller tvetydiga fält – enkel svenska. Tom lista = redo att importera. */
  problems: string[];
  /** Filen är ett rabattbrev (rabattgrupper utan artikelregister). */
  discountLetter: boolean;
  /** Filen känns igen som ett grossistformat – mappningen ovan är då tom och irrelevant. */
  known?: KnownFormatSummary;
}

export interface PreviewContext {
  /** Anslutningens kundnummer hos grossisten – jämförs med filens. */
  customerNumber?: string;
  /** Finns en aktiv prislista för anslutningen? */
  hasActivePriceList: boolean;
}

export function summarizeKnownFormat(known: KnownFormatFile, context?: PreviewContext): KnownFormatSummary {
  const { parser, file } = known;
  const base = {
    parserId: parser.id,
    wholesaler: parser.wholesaler,
    formatLabel: parser.label,
    kind: file.kind,
    encoding: known.encoding,
    rowCount: file.rowCount,
  };
  if (file.kind === "discount_agreement") {
    const spec = file.articleTerms.filter((t) => t.specDiscountTenths != null).length;
    const net = file.articleTerms.filter((t) => t.netPriceOre != null).length;
    const connectionNumber = context?.customerNumber?.trim();
    const mismatch =
      connectionNumber && connectionNumber.replace(/\D/g, "") !== file.header.customerNumber
        ? { file: file.header.customerNumber, connection: connectionNumber }
        : undefined;
    return {
      ...base,
      header: { ...file.header },
      counts: [
        { label: "Rabatt per materialklass", count: file.classDiscounts.length },
        { label: "Artikelvillkor", count: file.articleTerms.length },
        { label: "– varav specrabatt", count: spec },
        { label: "– varav nettopris", count: net },
      ],
      endDate: file.endDate,
      warnings: [...file.warnings],
      ...(mismatch ? { customerNumberMismatch: mismatch } : {}),
      priceListMissing: context ? !context.hasActivePriceList : false,
      chainDiscountRows: file.chainDiscountRows,
    };
  }
  return {
    ...base,
    counts: [
      { label: "Artiklar", count: file.articles.length },
      { label: "– varav pris på begäran (0 kr)", count: file.priceOnRequestCount },
      { label: "– varav lagerförda", count: file.articles.filter((a) => a.stocked).length },
    ],
    warnings: [],
    priceListMissing: false,
    chainDiscountRows: 0,
  };
}

export function previewImport(
  parsed: ParsedPriceFile,
  opts: { remembered?: WholesalerColumnMapping; override?: WholesalerColumnMapping; context?: PreviewContext } = {},
): ImportPreview {
  if (parsed.known) {
    return {
      kind: parsed.detected.kind,
      innerFilename: parsed.detected.innerFilename,
      headers: [],
      sampleRows: [],
      rowCount: parsed.known.file.rowCount,
      mapping: {},
      confidence: {},
      problems: [],
      discountLetter: false,
      known: summarizeKnownFormat(parsed.known, opts.context),
    };
  }
  const detected = detectColumnMapping(parsed.table, opts.remembered);
  const mapping = opts.override ? sanitizeMapping(parsed.table, opts.override) : detected.mapping;
  const problems = mappingProblems(mapping);
  const discountLetter = isDiscountLetter(mapping);
  return {
    kind: parsed.detected.kind,
    innerFilename: parsed.detected.innerFilename,
    headers: parsed.table.headers,
    sampleRows: parsed.table.rows.slice(0, PREVIEW_ROWS),
    rowCount: parsed.table.rows.length,
    mapping,
    confidence: opts.override ? {} : detected.confidence,
    problems: discountLetter ? [] : problems,
    discountLetter,
  };
}

/** Behåll bara referenser som pekar på kolumner som faktiskt finns. */
export function sanitizeMapping(table: RawTable, mapping: WholesalerColumnMapping): WholesalerColumnMapping {
  const out: WholesalerColumnMapping = {};
  const seen = new Set<number>();
  for (const [key, ref] of Object.entries(mapping) as Array<[keyof WholesalerColumnMapping, string | undefined]>) {
    if (typeof ref !== "string" || !ref.trim()) continue;
    const idx = columnIndexFor(table, ref);
    if (idx < 0 || seen.has(idx)) continue;
    seen.add(idx);
    out[key] = ref;
  }
  return out;
}

export function isDiscountLetter(mapping: WholesalerColumnMapping): boolean {
  return Boolean(!mapping.articleNumber && mapping.discountGroup && mapping.discountPercent);
}

export interface BuildProductsResult {
  products: WholesalerProduct[];
  errors: WholesalerPriceImportError[];
  rowCount: number;
  skippedCount: number;
  hasArticleRegister: boolean;
  hasDiscounts: boolean;
  discountGroupCount: number;
  /** Rabattgrupp → procent lästa ur filen (rabattbrev eller rader med båda). */
  discountGroups: Record<string, number>;
}

export function normalizeDiscountGroupKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

/** Bygg rabattbrev (grupp → procent) ur en fil som saknar artiklar. */
export function buildDiscountGroups(table: RawTable, mapping: WholesalerColumnMapping): BuildProductsResult {
  const groupIdx = columnIndexFor(table, mapping.discountGroup);
  const percentIdx = columnIndexFor(table, mapping.discountPercent);
  const groups: Record<string, number> = {};
  const errors: WholesalerPriceImportError[] = [];
  let skipped = 0;
  table.rows.forEach((row, i) => {
    const rowNumber = table.firstDataRowNumber + i;
    const group = normalizeDiscountGroupKey(cell(row, groupIdx));
    const percent = parsePercent(cell(row, percentIdx));
    if (!group) {
      skipped += 1;
      pushError(errors, rowNumber, "rabattgrupp saknas.");
      return;
    }
    if (percent == null) {
      skipped += 1;
      pushError(errors, rowNumber, `kan inte läsa rabatten "${cell(row, percentIdx)}" för grupp ${group}.`);
      return;
    }
    groups[group] = percent;
  });
  return {
    products: [],
    errors,
    rowCount: table.rows.length,
    skippedCount: skipped,
    hasArticleRegister: false,
    hasDiscounts: Object.keys(groups).length > 0,
    discountGroupCount: Object.keys(groups).length,
    discountGroups: groups,
  };
}

function pushError(errors: WholesalerPriceImportError[], row: number, message: string): void {
  if (errors.length < MAX_IMPORT_ERRORS) errors.push({ row, message: `Rad ${row}: ${message}` });
}

function textCell(row: string[], idx: number, max: number): string {
  if (idx < 0) return "";
  return neutralizeFormula(cell(row, idx)).slice(0, max);
}

function optionalText(row: string[], idx: number, max = 120): string | undefined {
  const v = textCell(row, idx, max);
  return v ? v : undefined;
}

/**
 * Bygg artiklar. Rader utan artikelnummer/benämning hoppas över med radfel;
 * ogiltiga pristexter ger radfel men raden importeras utan det priset.
 */
export function buildProducts(
  table: RawTable,
  mapping: WholesalerColumnMapping,
  ctx: { connectionId: string; importId: string; discountGroups?: Record<string, number> },
): BuildProductsResult {
  if (isDiscountLetter(mapping)) return buildDiscountGroups(table, mapping);

  const idx = {
    articleNumber: columnIndexFor(table, mapping.articleNumber),
    name: columnIndexFor(table, mapping.name),
    eNumber: columnIndexFor(table, mapping.eNumber),
    rskNumber: columnIndexFor(table, mapping.rskNumber),
    gtin: columnIndexFor(table, mapping.gtin),
    category: columnIndexFor(table, mapping.category),
    brand: columnIndexFor(table, mapping.brand),
    imageUrl: columnIndexFor(table, mapping.imageUrl),
    discountGroup: columnIndexFor(table, mapping.discountGroup),
    unit: columnIndexFor(table, mapping.unit),
    packSize: columnIndexFor(table, mapping.packSize),
    listPrice: columnIndexFor(table, mapping.listPrice),
    discountPercent: columnIndexFor(table, mapping.discountPercent),
    netPrice: columnIndexFor(table, mapping.netPrice),
    salesPrice: columnIndexFor(table, mapping.salesPrice),
  };

  const products: WholesalerProduct[] = [];
  const errors: WholesalerPriceImportError[] = [];
  const seenArticles = new Set<string>();
  const fileGroups: Record<string, number> = {};
  const knownGroups = ctx.discountGroups ?? {};
  let skipped = 0;
  let hasDiscounts = false;

  table.rows.forEach((row, i) => {
    const rowNumber = table.firstDataRowNumber + i;
    const articleNumber = textCell(row, idx.articleNumber, MAX_ARTICLE_NUMBER_CHARS);
    if (!articleNumber) {
      skipped += 1;
      pushError(errors, rowNumber, "artikelnummer saknas – raden hoppas över.");
      return;
    }
    const articleKey = articleNumber.toLowerCase();
    if (seenArticles.has(articleKey)) {
      skipped += 1;
      pushError(errors, rowNumber, `artikelnummer ${articleNumber} förekommer flera gånger – första raden används.`);
      return;
    }
    const name = textCell(row, idx.name, MAX_NAME_CHARS);
    if (!name) {
      skipped += 1;
      pushError(errors, rowNumber, `benämning saknas för artikel ${articleNumber} – raden hoppas över.`);
      return;
    }

    const readOre = (col: number, label: string): number | undefined => {
      if (col < 0) return undefined;
      const raw = cell(row, col);
      if (!raw) return undefined;
      const ore = parseOre(raw);
      if (ore == null) {
        pushError(errors, rowNumber, `kan inte läsa ${label} "${raw}" för artikel ${articleNumber}.`);
        return undefined;
      }
      return ore;
    };

    const listPriceOre = readOre(idx.listPrice, "listpriset");
    const netFromFile = readOre(idx.netPrice, "nettopriset");
    const salesPriceOre = readOre(idx.salesPrice, "utpriset");

    let discountPercent: number | undefined;
    if (idx.discountPercent >= 0) {
      const raw = cell(row, idx.discountPercent);
      if (raw) {
        const p = parsePercent(raw);
        if (p == null) pushError(errors, rowNumber, `kan inte läsa rabatten "${raw}" för artikel ${articleNumber}.`);
        else discountPercent = p;
      }
    }
    const discountGroupRaw = optionalText(row, idx.discountGroup, 40);
    const discountGroup = discountGroupRaw ? normalizeDiscountGroupKey(discountGroupRaw) : undefined;
    if (discountGroup && discountPercent != null) fileGroups[discountGroup] = discountPercent;
    const groupDiscount = discountGroup ? knownGroups[discountGroup] ?? fileGroups[discountGroup] : undefined;
    const effectiveDiscount = discountPercent ?? groupDiscount;
    if (effectiveDiscount != null || discountGroup) hasDiscounts = true;

    let netPriceOre: number | undefined;
    let netPriceSource: WholesalerProduct["netPriceSource"];
    if (netFromFile != null) {
      netPriceOre = netFromFile;
      netPriceSource = "file";
    } else if (listPriceOre != null && effectiveDiscount != null) {
      netPriceOre = netFromDiscountOre(listPriceOre, effectiveDiscount);
      netPriceSource = "discount_group";
    }

    let packSize: number | undefined;
    if (idx.packSize >= 0) {
      const raw = cell(row, idx.packSize);
      if (raw) {
        const n = parseDecimal(raw);
        if (n == null || n <= 0) pushError(errors, rowNumber, `kan inte läsa förpackningsstorleken "${raw}".`);
        else packSize = n;
      }
    }

    seenArticles.add(articleKey);
    const product: WholesalerProduct = {
      id: uid(),
      connectionId: ctx.connectionId,
      importId: ctx.importId,
      articleNumber,
      name,
      unit: optionalText(row, idx.unit, 16) ?? "st",
    };
    const eNumber = optionalText(row, idx.eNumber, 32);
    const rskNumber = optionalText(row, idx.rskNumber, 32);
    const gtin = optionalText(row, idx.gtin, 32);
    const category = optionalText(row, idx.category, 80);
    const brand = optionalText(row, idx.brand, 60);
    // Bildlänken går aldrig genom neutralizeFormula-trunkeringen på 120 –
    // den saneras separat (bara http/https, max 500 tecken).
    const imageUrl = idx.imageUrl >= 0 ? sanitizeImageUrl(cell(row, idx.imageUrl)) : undefined;
    if (eNumber) product.eNumber = eNumber;
    if (rskNumber) product.rskNumber = rskNumber;
    if (gtin) product.gtin = gtin;
    if (category) product.category = category;
    if (brand) product.brand = brand;
    if (imageUrl) product.imageUrl = imageUrl;
    if (discountGroup) product.discountGroup = discountGroup;
    if (packSize != null) product.packSize = packSize;
    if (listPriceOre != null) product.listPriceOre = listPriceOre;
    if (effectiveDiscount != null) product.discountPercent = effectiveDiscount;
    if (netPriceOre != null) {
      product.netPriceOre = netPriceOre;
      product.netPriceSource = netPriceSource;
    }
    if (salesPriceOre != null) product.salesPriceOre = salesPriceOre;
    products.push(product);
  });

  const discountGroups = { ...fileGroups };
  return {
    products,
    errors,
    rowCount: table.rows.length,
    skippedCount: skipped,
    hasArticleRegister: products.length > 0,
    hasDiscounts,
    discountGroupCount: Object.keys(discountGroups).length,
    discountGroups,
  };
}

/**
 * Artiklar ur en prislista i känt grossistformat (t.ex. Ahlsell prisfil).
 * Materialklassen blir artikelns rabattgrupp – nyckeln mot rabattavtalet.
 * Inget nettopris räknas här: det slås ihop med avtalet vid läsning.
 */
export function buildPriceListProducts(
  list: ParsedPriceList,
  ctx: { connectionId: string; importId: string },
): BuildProductsResult {
  const products: WholesalerProduct[] = [];
  const errors: WholesalerPriceImportError[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const a of list.articles) {
    const articleNumber = neutralizeFormula(a.articleNumber).slice(0, MAX_ARTICLE_NUMBER_CHARS);
    if (!articleNumber) {
      skipped += 1;
      pushError(errors, a.row, "artikelnummer saknas – raden hoppas över.");
      continue;
    }
    const key = articleNumber.toLowerCase();
    if (seen.has(key)) {
      skipped += 1;
      pushError(errors, a.row, `artikelnummer ${articleNumber} förekommer flera gånger – första raden används.`);
      continue;
    }
    const name = neutralizeFormula(a.name).slice(0, MAX_NAME_CHARS);
    if (!name) {
      skipped += 1;
      pushError(errors, a.row, `benämning saknas för artikel ${articleNumber} – raden hoppas över.`);
      continue;
    }
    seen.add(key);
    const product: WholesalerProduct = {
      id: uid(),
      connectionId: ctx.connectionId,
      importId: ctx.importId,
      articleNumber,
      name,
      unit: (a.unit || "st").toLowerCase().slice(0, 16),
    };
    if (a.materialClass) product.discountGroup = normalizeDiscountGroupKey(a.materialClass);
    if (a.orderMultiple != null && a.orderMultiple > 0) product.packSize = a.orderMultiple;
    if (a.stocked != null) product.stocked = a.stocked;
    if (!a.priceOnRequest && a.listPriceOre != null) product.listPriceOre = a.listPriceOre;
    products.push(product);
  }

  return {
    products,
    errors,
    rowCount: list.rowCount,
    skippedCount: skipped,
    hasArticleRegister: products.length > 0,
    hasDiscounts: false,
    discountGroupCount: 0,
    discountGroups: {},
  };
}
