/**
 * Deterministisk tolkning av grossistens orderbekräftelse: ämnesrad, mejltext,
 * HTML-tabeller, CSV/XML-bilagor och strukturerade artikelnummer.
 *
 * Resultatet är KANDIDATER med konfidens och källa – aldrig sanning. Rader
 * matchas mot den skickade snapshoten (artikelnummer → E-nr/RSK → namn).
 * Ingen text går härifrån till en LLM; AI-fallbacken (confirmation-ai.ts)
 * anropas separat och bara när det här inte räcker.
 */
import type {
  PurchaseOrderConfirmationLine,
  PurchaseOrderExtractionSource,
  PurchaseOrderSnapshotLine,
} from "../types";
import { normalizeIdentifier, normalizeText } from "./catalog-search";
import { csvToTable } from "./csv";
import { xmlToTable } from "./xml-table";
import { cell, cleanCell, type RawTable } from "./table";
import { normalizeHeader } from "./column-mapping";
import { parseDecimal, parseOre } from "./money";

export const FERVA_REFERENCE_RE = /\bFV-(\d{4,7})\b/i;

export function extractFervaReference(...texts: Array<string | undefined>): string | undefined {
  for (const t of texts) {
    if (!t) continue;
    const m = FERVA_REFERENCE_RE.exec(t);
    if (m) return `FV-${m[1]}`;
  }
  return undefined;
}

export function extractAllFervaReferences(...texts: Array<string | undefined>): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(/\bFV-(\d{4,7})\b/gi)) out.add(`FV-${m[1]}`);
  }
  return [...out];
}

const ORDER_NUMBER_RES: RegExp[] = [
  /\b(?:orderbekr[äa]ftelse|ordererk[äa]nnande)\s*(?:nr\.?|nummer|#|:)?\s*([A-Z]{0,3}\d{4,12})\b/i,
  /\b(?:order(?:nummer|nr\.?|-?nr\.?|\s?no\.?|\s?number|\s?id)|ordernr)\s*[:#]?\s*([A-Z]{0,3}-?\d{4,12}(?:-\d{1,4})?)\b/i,
  /\b(?:er|vår|our|your)\s+order\s*[:#]?\s*([A-Z]{0,3}\d{4,12})\b/i,
  /\border\s*[:#]\s*([A-Z]{0,3}\d{4,12})\b/i,
];

/** Grossistens ordernummer – aldrig Ferva-referensen. */
export function extractOrderNumber(...texts: Array<string | undefined>): string | undefined {
  for (const t of texts) {
    if (!t) continue;
    const cleaned = t.replace(FERVA_REFERENCE_RE, " ");
    for (const re of ORDER_NUMBER_RES) {
      const m = re.exec(cleaned);
      if (m?.[1]) return m[1].toUpperCase();
    }
  }
  return undefined;
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, mars: 3, apr: 4, april: 4, maj: 5, jun: 6, juni: 6,
  jul: 7, juli: 7, aug: 8, augusti: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "2026-09-08", "8/9 2026", "8 september 2026", "8 sep" (i år) → YYYY-MM-DD. */
export function parseSwedishDate(raw: string, now = new Date()): string | undefined {
  const s = raw.trim().toLowerCase();
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /\b(\d{1,2})[./](\d{1,2})(?:[./\s](\d{2,4}))?\b/.exec(s);
  if (m) {
    const year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : now.getFullYear();
    return validDate(year, Number(m[2]), Number(m[1]));
  }
  m = /\b(\d{1,2})\s+([a-zåäö]{3,9})\.?(?:\s+(\d{4}))?\b/.exec(s);
  if (m && MONTHS[m[2]]) {
    const year = m[3] ? Number(m[3]) : now.getFullYear();
    return validDate(year, MONTHS[m[2]], Number(m[1]));
  }
  return undefined;
}

function validDate(y: number, mo: number, d: number): string | undefined {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

const DELIVERY_RE =
  /\b(?:leveransdatum|leverans|levereras|ber[äa]knad leverans|leveransdag|h[äa]mtklart|klart f[öo]r h[äa]mtning|delivery date|delivery|ships?|utleverans)\b[^\d\n]{0,25}((?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}[./]\d{1,2}(?:[./\s]\d{2,4})?)|(?:\d{1,2}\s+[a-zåäö]{3,9}\.?(?:\s+\d{4})?))/i;

export function extractDeliveryDate(text: string | undefined, now = new Date()): string | undefined {
  if (!text) return undefined;
  const m = DELIVERY_RE.exec(text);
  if (!m) return undefined;
  return parseSwedishDate(m[1], now);
}

const TOTAL_RE = /\b(?:totalt?|summa|total(?:belopp)?|att betala|order(?:v[äa]rde|summa))\b[^\d\n]{0,30}(\d[\d\s .]*(?:[,.]\d{1,2})?)/i;

export function extractTotalOre(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = TOTAL_RE.exec(text);
  if (!m) return undefined;
  const ore = parseOre(m[1]);
  return ore == null ? undefined : ore;
}

/** Tar bort taggar och avkodar de vanligaste entiteterna – för textmatchning, aldrig rendering. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** HTML-tabeller → tabeller (första raden som rubrik). */
export function htmlTables(html: string): RawTable[] {
  const tables: RawTable[] = [];
  for (const table of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rows: string[][] = [];
    for (const tr of table[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const cells: string[] = [];
      for (const td of tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
        cells.push(cleanCell(htmlToText(td[1])));
      }
      if (cells.some((c) => c.length > 0)) rows.push(cells);
    }
    if (rows.length >= 2) {
      const width = Math.max(...rows.map((r) => r.length));
      const headers = rows[0].map((h, i) => h || `#${i + 1}`);
      while (headers.length < width) headers.push(`#${headers.length + 1}`);
      tables.push({ headers, rows: rows.slice(1), hasHeaderRow: true, firstDataRowNumber: 2 });
    }
  }
  return tables;
}

/* --------------------------- tabell → bekräftelserader ---------------------- */

interface ConfirmationColumns {
  articleNumber: number;
  name: number;
  qty: number;
  unit: number;
  price: number;
  status: number;
  eNumber: number;
  rskNumber: number;
  substitute: number;
  date: number;
}

const HEADER_SYNONYMS: Record<keyof ConfirmationColumns, string[]> = {
  articleNumber: ["artikelnummer", "artnr", "artikelnr", "artikel", "artikelkod", "item", "itemno", "sku", "article", "articleno", "produktnr", "vartartnr", "vartartikelnr", "levartnr"],
  name: ["benamning", "beskrivning", "artikelnamn", "namn", "description", "text", "produkt", "artikeltext"],
  qty: ["antal", "bekraftatantal", "bekraftat", "levereras", "levererat", "qty", "quantity", "kvantitet", "best", "bestallt", "antallev", "levantal", "confirmedqty"],
  unit: ["enhet", "enh", "unit", "uom"],
  price: ["pris", "apris", "aprisexklmoms", "styckpris", "nettopris", "netto", "dittpris", "enhetspris", "price", "unitprice", "prisst", "priskr", "enhpris"],
  status: ["status", "rest", "restnoterat", "restnoterad", "restorder", "lagerstatus", "leveransstatus", "anm", "anmarkning", "notering", "kommentar"],
  eNumber: ["enummer", "enr", "elnummer", "elnr", "enumber"],
  rskNumber: ["rsk", "rsknummer", "rsknr"],
  substitute: ["ersattningsartikel", "ersattsav", "ersattning", "ersatt", "substitute", "ersattare", "alternativ"],
  date: ["leveransdatum", "levdatum", "leverans", "datum", "deliverydate", "hamtklart"],
};

function detectConfirmationColumns(table: RawTable): ConfirmationColumns | null {
  const norm = table.headers.map(normalizeHeader);
  const used = new Set<number>();
  const pick = (key: keyof ConfirmationColumns): number => {
    const syn = HEADER_SYNONYMS[key];
    let idx = norm.findIndex((h, i) => !used.has(i) && syn.includes(h));
    if (idx < 0) idx = norm.findIndex((h, i) => !used.has(i) && syn.some((s) => s.length >= 4 && h.includes(s)));
    if (idx >= 0) used.add(idx);
    return idx;
  };
  const cols: ConfirmationColumns = {
    articleNumber: pick("articleNumber"),
    eNumber: pick("eNumber"),
    rskNumber: pick("rskNumber"),
    name: pick("name"),
    qty: pick("qty"),
    unit: pick("unit"),
    price: pick("price"),
    status: pick("status"),
    substitute: pick("substitute"),
    date: pick("date"),
  };
  if (cols.articleNumber < 0 && cols.eNumber < 0 && cols.rskNumber < 0 && cols.name < 0) return null;
  return cols;
}

const BACKORDER_RE = /\b(rest(?:noter(?:ad|at|as|ing))?|restorder|restas|slut i lager|ej i lager|backorder|back order|inte i lager|kommer senare|levereras senare)\b/i;
const SUBSTITUTE_RE = /\b(ers[äa]tt(?:s|er|ning)?(?:\s*av|\s*med)?|substitut(?:e|erad)?|alternativ(?:\s*artikel)?|byts?\s*till)\b\s*[:.-]?\s*([A-Za-z0-9][A-Za-z0-9-]{2,30})/i;

function statusFlags(text: string): { backordered: boolean; backorderDate?: string; substitute?: string } {
  const backordered = BACKORDER_RE.test(text);
  const sub = SUBSTITUTE_RE.exec(text);
  return {
    backordered,
    ...(backordered ? { backorderDate: parseSwedishDate(text) } : {}),
    ...(sub?.[2] ? { substitute: sub[2] } : {}),
  };
}

/** Matcha en bekräftelserad mot den skickade snapshoten. */
export class SnapshotMatcher {
  private readonly remaining: PurchaseOrderSnapshotLine[];
  constructor(lines: PurchaseOrderSnapshotLine[]) {
    this.remaining = [...lines];
  }
  match(input: { articleNumber?: string; eNumber?: string; rskNumber?: string; name?: string; text?: string }): PurchaseOrderSnapshotLine | undefined {
    const takeAt = (i: number) => (i >= 0 ? this.remaining.splice(i, 1)[0] : undefined);
    const art = normalizeIdentifier(input.articleNumber);
    if (art.length >= 2) {
      const i = this.remaining.findIndex((l) => normalizeIdentifier(l.articleNumber) === art);
      if (i >= 0) return takeAt(i);
    }
    const e = normalizeIdentifier(input.eNumber);
    if (e.length >= 5) {
      const i = this.remaining.findIndex((l) => normalizeIdentifier(l.eNumber) === e);
      if (i >= 0) return takeAt(i);
    }
    const rsk = normalizeIdentifier(input.rskNumber);
    if (rsk.length >= 5) {
      const i = this.remaining.findIndex((l) => normalizeIdentifier(l.rskNumber) === rsk);
      if (i >= 0) return takeAt(i);
    }
    // Fritext (t.ex. "artikel 123456 …"): något av snapshotens nummer i texten.
    if (input.text) {
      const hay = normalizeIdentifier(input.text.replace(/[^A-Za-z0-9]+/g, " ").split(" ").join("|"));
      const i = this.remaining.findIndex((l) => {
        const ids = [l.articleNumber, l.eNumber, l.rskNumber].map(normalizeIdentifier).filter((x) => x.length >= 4);
        return ids.some((id) => hay.includes(id));
      });
      if (i >= 0) return takeAt(i);
    }
    const name = normalizeText(input.name);
    if (name.length >= 6) {
      const i = this.remaining.findIndex((l) => normalizeText(l.name) === name);
      if (i >= 0) return takeAt(i);
    }
    return undefined;
  }
  unmatched(): PurchaseOrderSnapshotLine[] {
    return [...this.remaining];
  }
}

export interface ParsedConfirmationLine {
  orderLineId?: string;
  articleNumber?: string;
  name?: string;
  confirmedQty?: number;
  unit?: string;
  unitCostOre?: number;
  backordered: boolean;
  backorderDate?: string;
  substituteArticleNumber?: string;
  substituteName?: string;
  confidence: number;
  source: PurchaseOrderExtractionSource;
}

export function linesFromTable(table: RawTable, matcher: SnapshotMatcher): ParsedConfirmationLine[] {
  const cols = detectConfirmationColumns(table);
  if (!cols) return [];
  const out: ParsedConfirmationLine[] = [];
  for (const row of table.rows) {
    const articleNumber = cell(row, cols.articleNumber) || undefined;
    const name = cell(row, cols.name) || undefined;
    if (!articleNumber && !name) continue;
    const qtyRaw = cell(row, cols.qty);
    const qty = qtyRaw ? parseDecimal(qtyRaw) : null;
    const priceRaw = cell(row, cols.price);
    const price = priceRaw ? parseOre(priceRaw) : null;
    const statusText = [cell(row, cols.status), cell(row, cols.substitute), qtyRaw].filter(Boolean).join(" ");
    const flags = statusFlags(statusText);
    const substituteCol = cell(row, cols.substitute);
    const matched = matcher.match({
      articleNumber,
      eNumber: cell(row, cols.eNumber) || undefined,
      rskNumber: cell(row, cols.rskNumber) || undefined,
      name,
    });
    const dateCell = cell(row, cols.date);
    const backorderDate = flags.backorderDate ?? (dateCell ? parseSwedishDate(dateCell) : undefined);
    const structuredEnough = Boolean(matched && (qty != null || flags.backordered));
    out.push({
      ...(matched ? { orderLineId: matched.lineId } : {}),
      ...(articleNumber ? { articleNumber } : {}),
      ...(name ? { name } : {}),
      ...(qty != null && qty >= 0 ? { confirmedQty: qty } : {}),
      ...(cell(row, cols.unit) ? { unit: cell(row, cols.unit) } : {}),
      ...(price != null ? { unitCostOre: price } : {}),
      backordered: flags.backordered,
      ...(flags.backordered && backorderDate ? { backorderDate } : {}),
      ...(substituteCol || flags.substitute
        ? { substituteArticleNumber: (substituteCol || flags.substitute)!.slice(0, 64) }
        : {}),
      confidence: structuredEnough ? 0.99 : matched ? 0.9 : 0.6,
      source: "structured",
    });
  }
  return out;
}

/**
 * Textrader: hitta rader som nämner ett skickat artikelnummer och läs antal
 * (heltal/decimal före en enhet eller "st"), à-pris (tal med två decimaler)
 * och reststatus ur samma rad.
 */
export function linesFromText(text: string, matcher: SnapshotMatcher): ParsedConfirmationLine[] {
  const out: ParsedConfirmationLine[] = [];
  const rows = text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  for (const row of rows) {
    const matched = matcher.match({ text: row });
    if (!matched) continue;
    // Ta bort artikelnumret innan tal läses så att det inte tas för antal.
    const stripped = row.replace(new RegExp(escapeRe(matched.articleNumber ?? ""), "i"), " ");
    const qtyMatch =
      /(\d+(?:[,.]\d+)?)\s*(?:x\s*)?(st|m|meter|förp|frp|pkt|rle|rulle|kg|l|par|set|pkg|stk)\b/i.exec(stripped) ??
      /\b(?:antal|bekr(?:äftat|aftat)?|lev(?:ereras)?)\s*[:.]?\s*(\d+(?:[,.]\d+)?)/i.exec(stripped);
    const priceMatch =
      /(?:à|a|pris|à-pris|apris|styck|st\.?pris)\s*[:.]?\s*(\d[\d\s]*[,.]\d{2})\b/i.exec(stripped) ??
      /\b(\d[\d\s]*[,.]\d{2})\s*(?:kr|sek)?\s*(?:\/|per)?\s*(?:st|m|förp|enhet)?\b/i.exec(stripped);
    const qty = qtyMatch ? parseDecimal(qtyMatch[1]) : null;
    const price = priceMatch ? parseOre(priceMatch[1]) : null;
    const flags = statusFlags(row);
    const confidence = qty != null && (price != null || flags.backordered) ? 0.85 : qty != null || flags.backordered ? 0.75 : 0.5;
    out.push({
      orderLineId: matched.lineId,
      ...(matched.articleNumber ? { articleNumber: matched.articleNumber } : {}),
      name: matched.name,
      ...(qty != null && qty >= 0 ? { confirmedQty: qty } : {}),
      ...(price != null ? { unitCostOre: price } : {}),
      backordered: flags.backordered,
      ...(flags.backordered && flags.backorderDate ? { backorderDate: flags.backorderDate } : {}),
      ...(flags.substitute ? { substituteArticleNumber: flags.substitute } : {}),
      confidence,
      source: "text",
    });
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ConfirmationAttachmentInput {
  filename: string;
  contentType: string;
  contentBase64?: string;
}

export interface DeterministicConfirmation {
  reference?: string;
  references: string[];
  orderNumber?: string;
  deliveryDate?: string;
  totalOre?: number;
  lines: ParsedConfirmationLine[];
  /** Ingen strukturerad rad hittades – AI-fallback kan behövas. */
  needsFallback: boolean;
  message?: string;
}

/**
 * Hela den deterministiska tolkningen i prioritetsordning:
 * CSV/XML-bilaga → HTML-tabell → textrader. Första källan med rader vinner.
 */
export function parseConfirmationDeterministic(input: {
  subject: string;
  text: string;
  html?: string;
  attachments?: ConfirmationAttachmentInput[];
  snapshotLines: PurchaseOrderSnapshotLine[];
  now?: Date;
}): DeterministicConfirmation {
  const plain = input.text?.trim() ? input.text : input.html ? htmlToText(input.html) : "";
  const now = input.now ?? new Date();
  const references = extractAllFervaReferences(input.subject, plain, input.html);
  const reference = extractFervaReference(input.subject, plain, input.html);
  const orderNumber = extractOrderNumber(input.subject, plain);
  const deliveryDate = extractDeliveryDate(`${input.subject}\n${plain}`, now);
  const totalOre = extractTotalOre(plain);

  let lines: ParsedConfirmationLine[] = [];
  const tryTable = (table: RawTable) => {
    const matcher = new SnapshotMatcher(input.snapshotLines);
    const parsed = linesFromTable(table, matcher);
    if (parsed.some((l) => l.orderLineId)) lines = parsed;
  };

  for (const att of input.attachments ?? []) {
    if (lines.length > 0) break;
    if (!att.contentBase64) continue;
    try {
      const bytes = Buffer.from(att.contentBase64, "base64");
      if (/csv|text\/plain/i.test(att.contentType) || /\.(csv|txt)$/i.test(att.filename)) {
        tryTable(csvToTable(new TextDecoder("utf-8").decode(bytes)));
      } else if (/xml/i.test(att.contentType) || /\.xml$/i.test(att.filename)) {
        tryTable(xmlToTable(new TextDecoder("utf-8").decode(bytes)));
      }
    } catch {
      // Trasig bilaga: gå vidare till nästa källa.
    }
  }
  if (lines.length === 0 && input.html) {
    for (const table of htmlTables(input.html)) {
      tryTable(table);
      if (lines.length > 0) break;
    }
  }
  if (lines.length === 0 && plain) {
    const matcher = new SnapshotMatcher(input.snapshotLines);
    lines = linesFromText(plain, matcher);
  }

  const message = plain ? plain.slice(0, 2000) : undefined;
  return {
    ...(reference ? { reference } : {}),
    references,
    ...(orderNumber ? { orderNumber } : {}),
    ...(deliveryDate ? { deliveryDate } : {}),
    ...(totalOre != null ? { totalOre } : {}),
    lines,
    needsFallback: lines.length === 0,
    ...(message ? { message } : {}),
  };
}

/** Kandidater → lagrad rad (id + deviations fylls av avstämningen). */
export function toConfirmationLine(
  parsed: ParsedConfirmationLine,
  id: string,
): Omit<PurchaseOrderConfirmationLine, "deviations"> {
  return {
    id,
    ...(parsed.orderLineId ? { orderLineId: parsed.orderLineId } : {}),
    ...(parsed.articleNumber ? { articleNumber: parsed.articleNumber } : {}),
    ...(parsed.name ? { name: parsed.name } : {}),
    ...(parsed.confirmedQty != null ? { confirmedQty: parsed.confirmedQty } : {}),
    ...(parsed.unit ? { unit: parsed.unit } : {}),
    ...(parsed.unitCostOre != null ? { unitCostOre: parsed.unitCostOre } : {}),
    backordered: parsed.backordered,
    ...(parsed.backorderDate ? { backorderDate: parsed.backorderDate } : {}),
    ...(parsed.substituteArticleNumber ? { substituteArticleNumber: parsed.substituteArticleNumber } : {}),
    ...(parsed.substituteName ? { substituteName: parsed.substituteName } : {}),
    confidence: parsed.confidence,
    source: parsed.source,
  };
}

const INVOICE_SUBJECT_RE = /\b(faktura|invoice|kvitto|receipt|att betala|bankgiro|ocr|kreditfaktura|p[åa]minnelse)\b/i;
const CONFIRMATION_WORDS_RE =
  /\b(orderbekr[äa]ftelse|ordererk[äa]nnande|order confirmation|orderbest[äa]llning mottagen|vi har tagit emot (er|din) best[äa]llning|tack f[öo]r (er|din) best[äa]llning|best[äa]llningen [äa]r mottagen|leveransbesked|restnoterad|restorder)\b/i;

/**
 * Ser mejlet ut som en orderbekräftelse (och inte en faktura/kvitto)?
 * Fakturasignaler i ämnet eller tolkade fakturafält vinner alltid – en
 * leverantörsfaktura som nämner vår referens går kvar i fakturapipelinen.
 */
export function looksLikeOrderConfirmation(input: {
  subject: string;
  text: string;
  html?: string;
  invoiceHints?: boolean;
}): boolean {
  if (input.invoiceHints) return false;
  if (INVOICE_SUBJECT_RE.test(input.subject)) return false;
  const hay = `${input.subject}\n${input.text}\n${input.html ? htmlToText(input.html).slice(0, 4000) : ""}`;
  if (FERVA_REFERENCE_RE.test(hay)) return true;
  return CONFIRMATION_WORDS_RE.test(hay);
}
