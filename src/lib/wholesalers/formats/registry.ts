/**
 * Parser-registry för kända grossistformat + formatdetektering.
 *
 * Detekteringen körs på filens första rader INNAN den generiska
 * kolumnmappningen och ger ett av tre utfall:
 *
 *   known        – en registrerad parser känner igen filen → parsa direkt,
 *                  visa en sammanfattning i stället för kolumnmappning
 *   delimited    – okänt separerat format → dagens kolumnmappning
 *   fixed_width  – okänt fastbreddsformat → ärligt fel, ingen mappningsdialog
 *                  (den kan inte fungera på positionsstyrda fält)
 *
 * Filnamnet används aldrig som signal – användare döper om filer.
 *
 * Nya grossister: skriv en parser mot en riktig fil + spec och lägg den i
 * WHOLESALER_FILE_PARSERS. Importflödet behöver inte röras.
 */
import { ahlsellAvtalsfilParser } from "./ahlsell-avtalsfil";
import { ahlsellPrisfilParser } from "./ahlsell-prisfil";
import { splitFixedWidthLines } from "./fixed-width";
import {
  DETECTION_SAMPLE_ROWS,
  MIN_ROWS_FOR_KNOWN_FORMAT,
  type WholesalerFileFormatId,
  type WholesalerFileParser,
} from "./types";

export const WHOLESALER_FILE_PARSERS: readonly WholesalerFileParser[] = [ahlsellAvtalsfilParser, ahlsellPrisfilParser];

/**
 * Formatet räknas som känt först när ALLA kontrollerade rader stämmer och
 * minst MIN_ROWS_FOR_KNOWN_FORMAT (50) rader kontrollerats – parserns
 * detect() ger rader/50, kapat vid 1.
 */
export const KNOWN_FORMAT_THRESHOLD = 1;

/**
 * Ahlsells egen sida om prislistor och avtalsfil ("Avtalsfilen kan du ladda
 * ner under Mina sidor → Beställ avtal"). Länkas när ett avtal laddats upp
 * utan prislista.
 */
export const AHLSELL_PRICE_FILE_HELP_URL = "https://www.ahlsell.se/handla-hos-oss/villkor-och-priser/prislistor_temp/";

export type FormatDetection =
  | { outcome: "known"; parser: WholesalerFileParser; confidence: number }
  /** Raderna stämmer med ett känt format men filen är för kort för att bedömas säkert. */
  | { outcome: "too_short"; parser: WholesalerFileParser; rows: number }
  | { outcome: "delimited" }
  | { outcome: "fixed_width"; lineLength: number };

export function parserById(id: string): WholesalerFileParser | undefined {
  return WHOLESALER_FILE_PARSERS.find((p) => p.id === id);
}

export function isKnownFormatId(value: unknown): value is WholesalerFileFormatId {
  return typeof value === "string" && WHOLESALER_FILE_PARSERS.some((p) => p.id === value);
}

/** De första icke-tomma raderna, otrimmade. */
export function detectionSample(text: string): string[] {
  return splitFixedWidthLines(text).slice(0, DETECTION_SAMPLE_ROWS);
}

const DELIMITERS = [";", "\t", "|"];

/**
 * Okänt fastbreddsformat: nästan alla rader lika långa (och långa nog att
 * inte vara en enkel lista), utan någon avgränsare som återkommer på
 * majoriteten av raderna.
 */
export function looksFixedWidth(sample: string[]): { fixed: boolean; lineLength: number } {
  if (sample.length < 5) return { fixed: false, lineLength: 0 };
  const counts = new Map<number, number>();
  for (const line of sample) counts.set(line.length, (counts.get(line.length) ?? 0) + 1);
  let best = 0;
  let bestLength = 0;
  for (const [length, n] of counts) {
    if (n > best) {
      best = n;
      bestLength = length;
    }
  }
  if (bestLength < 40 || best / sample.length < 0.95) return { fixed: false, lineLength: bestLength };
  for (const d of DELIMITERS) {
    const withDelimiter = sample.filter((l) => l.includes(d)).length;
    if (withDelimiter / sample.length >= 0.5) return { fixed: false, lineLength: bestLength };
  }
  return { fixed: true, lineLength: bestLength };
}

export function detectWholesalerFormat(text: string): FormatDetection {
  const sample = detectionSample(text);
  let best: { parser: WholesalerFileParser; confidence: number } | undefined;
  for (const parser of WHOLESALER_FILE_PARSERS) {
    const confidence = parser.detect(sample);
    if (confidence > 0 && (!best || confidence > best.confidence)) best = { parser, confidence };
  }
  if (best && best.confidence >= KNOWN_FORMAT_THRESHOLD) {
    return { outcome: "known", parser: best.parser, confidence: best.confidence };
  }
  if (best) {
    return { outcome: "too_short", parser: best.parser, rows: Math.round(best.confidence * MIN_ROWS_FOR_KNOWN_FORMAT) };
  }
  const fixed = looksFixedWidth(sample);
  if (fixed.fixed) return { outcome: "fixed_width", lineLength: fixed.lineLength };
  return { outcome: "delimited" };
}

/** Svensk etikett för ett känt format-id. */
export function formatLabel(id: WholesalerFileFormatId | string | undefined): string | undefined {
  return id ? parserById(id)?.label : undefined;
}
