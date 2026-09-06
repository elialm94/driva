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
 */
import type {
  WholesalerColumnMapping,
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
import { ZipError } from "./zip";

export const MAX_IMPORT_ERRORS = 50;
export const PREVIEW_ROWS = 8;
const MAX_ARTICLE_NUMBER_CHARS = 64;
const MAX_NAME_CHARS = 200;

export interface ParsedPriceFile {
  detected: DetectedPriceFile;
  table: RawTable;
}

/** Alla läsfel blir ett PriceFileError med begriplig svensk text. */
export function parsePriceFile(bytes: Buffer, filename: string): ParsedPriceFile {
  try {
    const detected = detectPriceFile(bytes, filename);
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
}

export function previewImport(
  parsed: ParsedPriceFile,
  opts: { remembered?: WholesalerColumnMapping; override?: WholesalerColumnMapping } = {},
): ImportPreview {
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
    if (eNumber) product.eNumber = eNumber;
    if (rskNumber) product.rskNumber = rskNumber;
    if (gtin) product.gtin = gtin;
    if (category) product.category = category;
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
