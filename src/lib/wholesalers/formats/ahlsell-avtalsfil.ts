/**
 * Ahlsell avtalsfil / rabattbrev – fastbreddsformat, 93 tecken per rad.
 *
 * Källa: https://www.ahlsell.se/globalassets/ahlsell_sv/dokumentation/prislistor/avtalsfil.pdf
 * Positionerna nedan är Ahlsells egna (1-indexerade, inklusiva) och
 * verifierade fält för fält mot en riktig fil. Hårdkodade – ingen gissning.
 *
 * Rad 1, huvud (79 tecken):
 *   TYP 1–2 · KUNDNUMMER 3–9 · ANLÄGGNINGSNUMMER 10–12 · BENÄMNING 13–42 ·
 *   KEDJERABATT (J/N) 43 · RESERV 44–73 · KÖRNINGSDATUM ÅÅMMDD 74–79
 *
 * Rad 2 och framåt (93 tecken):
 *   TYP 1–2 · KEDJERABATTKOD 3 · KUNDNUMMER 4–10 · ARTIKELNUMMER 11–30 ·
 *   MATERIALKLASS 31–36 · RABATT 37–40 · SPECRABATT 41–44 · NETTOPRIS 45–53 ·
 *   KEDJERABATT 54–57 · MATERIALKLASSTEXT 58–87 · SLUTDATUM ÅÅMMDD 88–93
 *
 * Antingen ARTIKELNUMMER eller MATERIALKLASS är ifyllt – aldrig båda. Rabatt
 * i tiondels procent (`0420` = 42,0 %), nettopris i ören (`000193500` =
 * 1 935,00 kr). Filen innehåller varken listpriser eller benämningar: den
 * måste kombineras med Ahlsells bruttoprisfil (ahlsell-prisfil.ts).
 *
 * Kedjerabatt (KEDJERABATTKOD = J) parsas och lagras men det byggs ingen
 * beräkning på den – vi har inget riktigt exempel. Rader med J räknas och
 * flaggas i UI:t.
 */
import {
  MIN_ROWS_FOR_KNOWN_FORMAT,
  WholesalerFileParseError,
  type ArticleTerm,
  type ClassDiscount,
  type ParsedDiscountAgreement,
  type WholesalerFileParser,
} from "./types";
import { alphaField, field, isBlank, isDigits, numericField, parseYYMMDD, splitFixedWidthLines } from "./fixed-width";

export const AHLSELL_AGREEMENT_HEADER_LENGTH = 79;
export const AHLSELL_AGREEMENT_ROW_LENGTH = 93;

const HEADER = {
  type: [1, 2],
  customerNumber: [3, 9],
  facilityNumber: [10, 12],
  name: [13, 42],
  chainDiscount: [43, 43],
  reserve: [44, 73],
  runDate: [74, 79],
} as const;

const ROW = {
  type: [1, 2],
  chainDiscountCode: [3, 3],
  customerNumber: [4, 10],
  articleNumber: [11, 30],
  materialClass: [31, 36],
  discount: [37, 40],
  specDiscount: [41, 44],
  netPrice: [45, 53],
  chainDiscount: [54, 57],
  materialClassText: [58, 87],
  endDate: [88, 93],
} as const;

type Span = readonly [number, number];
const f = (line: string, span: Span) => field(line, span[0], span[1]);
const alpha = (line: string, span: Span) => alphaField(line, span[0], span[1]);

function isAgreementType(value: string): value is " 1" | " 3" {
  return value === " 1" || value === " 3";
}

function isChainCode(value: string): value is "J" | "N" {
  return value === "J" || value === "N";
}

/** Snabb, kastar aldrig – används av detekteringen. */
export function looksLikeAgreementHeader(line: string): boolean {
  return (
    line.length === AHLSELL_AGREEMENT_HEADER_LENGTH &&
    isAgreementType(f(line, HEADER.type)) &&
    isDigits(f(line, HEADER.customerNumber)) &&
    isDigits(f(line, HEADER.facilityNumber)) &&
    isChainCode(f(line, HEADER.chainDiscount)) &&
    isDigits(f(line, HEADER.runDate))
  );
}

/**
 * Detekteringsregeln ur specen: exakt 93 tecken, TYP " 1"/" 3", kod J/N,
 * kundnummer siffror, exakt ett av ARTIKELNUMMER/MATERIALKLASS ifyllt.
 */
export function looksLikeAgreementRow(line: string): boolean {
  if (line.length !== AHLSELL_AGREEMENT_ROW_LENGTH) return false;
  if (!isAgreementType(f(line, ROW.type))) return false;
  if (!isChainCode(f(line, ROW.chainDiscountCode))) return false;
  if (!isDigits(f(line, ROW.customerNumber))) return false;
  const hasArticle = !isBlank(f(line, ROW.articleNumber));
  const hasClass = !isBlank(f(line, ROW.materialClass));
  return hasArticle !== hasClass;
}

function parseHeader(line: string): ParsedDiscountAgreement["header"] {
  if (line.length !== AHLSELL_AGREEMENT_HEADER_LENGTH) {
    throw new WholesalerFileParseError(
      `huvudraden i en Ahlsell-avtalsfil ska vara ${AHLSELL_AGREEMENT_HEADER_LENGTH} tecken men är ${line.length}.`,
      1,
    );
  }
  const type = f(line, HEADER.type);
  if (!isAgreementType(type)) {
    throw new WholesalerFileParseError(`fältet TYP ska vara " 1" (kundavtal) eller " 3" (anläggningsavtal) men är "${type}".`, 1);
  }
  const customerNumber = f(line, HEADER.customerNumber);
  if (!isDigits(customerNumber)) {
    throw new WholesalerFileParseError(`fältet KUNDNUMMER ska vara sju siffror men är "${customerNumber}".`, 1);
  }
  const facilityNumber = f(line, HEADER.facilityNumber);
  if (!isDigits(facilityNumber)) {
    throw new WholesalerFileParseError(`fältet ANLÄGGNINGSNUMMER ska vara tre siffror men är "${facilityNumber}".`, 1);
  }
  const chainDiscount = f(line, HEADER.chainDiscount);
  if (!isChainCode(chainDiscount)) {
    throw new WholesalerFileParseError(`fältet KEDJERABATT ska vara J eller N men är "${chainDiscount}".`, 1);
  }
  return {
    agreementType: type.trim() as "1" | "3",
    customerNumber,
    facilityNumber,
    name: alpha(line, HEADER.name).trimStart(),
    chainDiscount,
    runDate: parseYYMMDD(f(line, HEADER.runDate), "KÖRNINGSDATUM", 1),
  };
}

interface ParsedRow {
  classDiscount?: ClassDiscount;
  articleTerm?: ArticleTerm;
  customerNumber: string;
  chainCode: "J" | "N";
  warning?: string;
}

function parseRow(line: string, row: number): ParsedRow {
  if (line.length !== AHLSELL_AGREEMENT_ROW_LENGTH) {
    throw new WholesalerFileParseError(
      `raden ska vara ${AHLSELL_AGREEMENT_ROW_LENGTH} tecken men är ${line.length}. Filen är inte en komplett Ahlsell-avtalsfil.`,
      row,
    );
  }
  const type = f(line, ROW.type);
  if (!isAgreementType(type)) {
    throw new WholesalerFileParseError(`fältet TYP ska vara " 1" eller " 3" men är "${type}".`, row);
  }
  const chainCode = f(line, ROW.chainDiscountCode);
  if (!isChainCode(chainCode)) {
    throw new WholesalerFileParseError(`fältet KEDJERABATTKOD ska vara J eller N men är "${chainCode}".`, row);
  }
  const customerNumber = f(line, ROW.customerNumber);
  if (!isDigits(customerNumber)) {
    throw new WholesalerFileParseError(`fältet KUNDNUMMER ska vara sju siffror men är "${customerNumber}".`, row);
  }
  const articleNumber = alpha(line, ROW.articleNumber);
  const materialClass = alpha(line, ROW.materialClass);
  if (articleNumber && materialClass) {
    throw new WholesalerFileParseError(
      `raden har både artikelnummer "${articleNumber}" och materialklass "${materialClass}" – enligt Ahlsells spec är bara ett av fälten ifyllt.`,
      row,
    );
  }
  if (!articleNumber && !materialClass) {
    throw new WholesalerFileParseError("raden saknar både artikelnummer och materialklass.", row);
  }
  const discount = numericField(line, ROW.discount[0], ROW.discount[1], "RABATT", row);
  const specDiscount = numericField(line, ROW.specDiscount[0], ROW.specDiscount[1], "SPECRABATT", row);
  const netPrice = numericField(line, ROW.netPrice[0], ROW.netPrice[1], "NETTOPRIS", row);
  const chainDiscount = numericField(line, ROW.chainDiscount[0], ROW.chainDiscount[1], "KEDJERABATT", row);
  const endDate = parseYYMMDD(f(line, ROW.endDate), "SLUTDATUM", row);
  const chainTenths = chainCode === "J" && chainDiscount > 0 ? chainDiscount : undefined;

  if (materialClass) {
    if (specDiscount !== 0 || netPrice !== 0) {
      throw new WholesalerFileParseError(
        `materialklassraden ${materialClass} har specrabatt/nettopris ifyllt – det hör bara hemma på artikelrader.`,
        row,
      );
    }
    return {
      customerNumber,
      chainCode,
      classDiscount: {
        materialClass,
        discountTenths: discount,
        text: alpha(line, ROW.materialClassText).trimStart(),
        ...(endDate ? { endDate } : {}),
        chainDiscountCode: chainCode,
        ...(chainTenths != null ? { chainDiscountTenths: chainTenths } : {}),
        row,
      },
    };
  }

  if (discount !== 0) {
    throw new WholesalerFileParseError(
      `artikelraden ${articleNumber} har materialklassrabatt ifylld – det hör bara hemma på materialklassrader.`,
      row,
    );
  }
  const term: ArticleTerm = {
    articleNumber,
    ...(specDiscount > 0 ? { specDiscountTenths: specDiscount } : {}),
    ...(netPrice > 0 ? { netPriceOre: netPrice } : {}),
    ...(endDate ? { endDate } : {}),
    chainDiscountCode: chainCode,
    ...(chainTenths != null ? { chainDiscountTenths: chainTenths } : {}),
    row,
  };
  let warning: string | undefined;
  if (specDiscount > 0 && netPrice > 0) {
    warning = `Rad ${row}: artikel ${articleNumber} har både specrabatt och nettopris – nettopriset används.`;
  } else if (specDiscount === 0 && netPrice === 0) {
    warning = `Rad ${row}: artikel ${articleNumber} saknar både specrabatt och nettopris.`;
  }
  return { customerNumber, chainCode, articleTerm: term, ...(warning ? { warning } : {}) };
}

export function parseAhlsellAgreement(text: string): ParsedDiscountAgreement {
  const lines = splitFixedWidthLines(text);
  if (lines.length === 0) throw new WholesalerFileParseError("Filen är tom.");
  const header = parseHeader(lines[0]);
  const classDiscounts: ClassDiscount[] = [];
  const articleTerms: ArticleTerm[] = [];
  const warnings: string[] = [];
  const customerNumbers = new Set<string>();
  let chainDiscountRows = 0;
  let endDate: string | undefined;
  for (let i = 1; i < lines.length; i++) {
    const parsed = parseRow(lines[i], i + 1);
    customerNumbers.add(parsed.customerNumber);
    if (parsed.chainCode === "J") chainDiscountRows += 1;
    if (parsed.classDiscount) {
      classDiscounts.push(parsed.classDiscount);
      if (parsed.classDiscount.endDate && (!endDate || parsed.classDiscount.endDate > endDate)) endDate = parsed.classDiscount.endDate;
    }
    if (parsed.articleTerm) {
      articleTerms.push(parsed.articleTerm);
      if (parsed.articleTerm.endDate && (!endDate || parsed.articleTerm.endDate > endDate)) endDate = parsed.articleTerm.endDate;
    }
    if (parsed.warning && warnings.length < 20) warnings.push(parsed.warning);
  }
  if (classDiscounts.length === 0 && articleTerms.length === 0) {
    throw new WholesalerFileParseError("Avtalsfilen innehåller bara en huvudrad – inga rabatter eller artikelvillkor.");
  }
  const others = [...customerNumbers].filter((n) => n !== header.customerNumber);
  if (others.length > 0) {
    warnings.unshift(`Raderna gäller kundnummer ${others.join(", ")} men huvudraden ${header.customerNumber}.`);
  }
  return {
    kind: "discount_agreement",
    wholesaler: "ahlsell",
    format: "ahlsell-avtalsfil",
    header,
    classDiscounts,
    articleTerms,
    rowCount: lines.length - 1,
    ...(endDate ? { endDate } : {}),
    chainDiscountRows,
    warnings,
  };
}

/**
 * 0..1. Huvudraden måste stämma och varje kontrollerad datarad måste följa
 * regeln. Full säkerhet först efter MIN_ROWS_FOR_KNOWN_FORMAT rader – färre
 * rader ger proportionellt lägre värde så att korta filer inte gissas.
 */
export function detectAhlsellAgreement(sample: string[]): number {
  if (sample.length < 2) return 0;
  if (!looksLikeAgreementHeader(sample[0])) return 0;
  let rows = 0;
  for (const line of sample.slice(1)) {
    if (!looksLikeAgreementRow(line)) return 0;
    rows += 1;
  }
  return Math.min(1, rows / MIN_ROWS_FOR_KNOWN_FORMAT);
}

export const ahlsellAvtalsfilParser: WholesalerFileParser = {
  id: "ahlsell-avtalsfil",
  wholesaler: "ahlsell",
  label: "Ahlsell avtalsfil (rabattbrev)",
  kind: "discount_agreement",
  detect: detectAhlsellAgreement,
  parse: parseAhlsellAgreement,
};
