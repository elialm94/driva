/**
 * Ahlsell bruttoprisfil / prislista – fastbreddsformat, 112 tecken per rad.
 *
 * Källa: https://www.ahlsell.se/globalassets/ahlsell_sv/dokumentation/prislistor/filspecifikation-prisfil-ahlsell_171026.pdf
 * Positioner (1-indexerade, inklusiva), hårdkodade enligt specen:
 *
 *   Artikelnummer 1–20 · Grundnettopris (ören) 21–32 · Materialklass 33–38 ·
 *   Lagerenhet 39–41 · Lagerförd 42 · Artikelbenämning 43–102 ·
 *   Beställningsmultipel (två decimaler utan decimaltecken) 103–109 ·
 *   Miljöavgift ingår 110 · Förlängd ansvarstid 111 · Energieffektivt 112
 *
 * Pris 0 betyder "pris på begäran", inte gratis – behandlas som saknat pris.
 * Materialklasserna PAA–PAB (koppar) och PJA–PJL (stål) har dagspris
 * respektive periodvis justering; priserna där är per definition ungefärliga.
 */
import { MIN_ROWS_FOR_KNOWN_FORMAT, WholesalerFileParseError, type ParsedPriceList, type PriceListArticle, type WholesalerFileParser } from "./types";
import { alphaField, field, isBlank, isDigits, numericField, splitFixedWidthLines } from "./fixed-width";

export const AHLSELL_PRICE_ROW_LENGTH = 112;

const ROW = {
  articleNumber: [1, 20],
  listPrice: [21, 32],
  materialClass: [33, 38],
  unit: [39, 41],
  stocked: [42, 42],
  name: [43, 102],
  orderMultiple: [103, 109],
  envFee: [110, 110],
  extendedLiability: [111, 111],
  energyEfficient: [112, 112],
} as const;

type Span = readonly [number, number];
const f = (line: string, span: Span) => field(line, span[0], span[1]);
const alpha = (line: string, span: Span) => alphaField(line, span[0], span[1]);

/** Detekteringsregeln ur specen: 112 tecken och siffror i tecken 21–32. */
export function looksLikePriceRow(line: string): boolean {
  return (
    line.length === AHLSELL_PRICE_ROW_LENGTH &&
    isDigits(f(line, ROW.listPrice)) &&
    !isBlank(f(line, ROW.articleNumber))
  );
}

/** Ahlsells ja/nej-flaggor: J = ja, N/blank = nej. Annat värde lämnas okänt. */
function flag(raw: string): boolean | undefined {
  const v = raw.trim().toUpperCase();
  if (v === "J") return true;
  if (v === "N" || v === "") return false;
  return undefined;
}

/** Materialklasser med dagspris/periodpris – priset är ungefärligt. */
export function isVolatilePriceClass(materialClass: string | undefined): boolean {
  if (!materialClass) return false;
  const head = materialClass.slice(0, 3).toUpperCase();
  return head === "PAA" || head === "PAB" || (head >= "PJA" && head <= "PJL");
}

function parseRow(line: string, row: number): PriceListArticle {
  if (line.length !== AHLSELL_PRICE_ROW_LENGTH) {
    throw new WholesalerFileParseError(
      `raden ska vara ${AHLSELL_PRICE_ROW_LENGTH} tecken men är ${line.length}. Filen är inte en komplett Ahlsell-prisfil.`,
      row,
    );
  }
  const articleNumber = alpha(line, ROW.articleNumber);
  if (!articleNumber) throw new WholesalerFileParseError("artikelnummer saknas.", row);
  const priceOre = numericField(line, ROW.listPrice[0], ROW.listPrice[1], "Grundnettopris", row);
  const name = alpha(line, ROW.name).trimStart();
  if (!name) throw new WholesalerFileParseError(`benämning saknas för artikel ${articleNumber}.`, row);
  const materialClass = alpha(line, ROW.materialClass);
  const unit = alpha(line, ROW.unit).trimStart();
  const multipleRaw = f(line, ROW.orderMultiple);
  let orderMultiple: number | undefined;
  if (!isBlank(multipleRaw)) {
    if (!isDigits(multipleRaw)) {
      throw new WholesalerFileParseError(`fältet Beställningsmultipel ska vara siffror men är "${multipleRaw}".`, row);
    }
    const n = Number(multipleRaw) / 100;
    if (n > 0) orderMultiple = n;
  }
  const stocked = flag(f(line, ROW.stocked));
  const envFeeIncluded = flag(f(line, ROW.envFee));
  const extendedLiability = flag(f(line, ROW.extendedLiability));
  const energyEfficient = flag(f(line, ROW.energyEfficient));
  return {
    articleNumber,
    name,
    ...(priceOre > 0 ? { listPriceOre: priceOre } : {}),
    priceOnRequest: priceOre === 0,
    ...(materialClass ? { materialClass } : {}),
    unit: unit || "st",
    ...(stocked != null ? { stocked } : {}),
    ...(orderMultiple != null ? { orderMultiple } : {}),
    ...(envFeeIncluded != null ? { envFeeIncluded } : {}),
    ...(extendedLiability != null ? { extendedLiability } : {}),
    ...(energyEfficient != null ? { energyEfficient } : {}),
    row,
  };
}

export function parseAhlsellPriceList(text: string): ParsedPriceList {
  const lines = splitFixedWidthLines(text);
  if (lines.length === 0) throw new WholesalerFileParseError("Filen är tom.");
  const articles: PriceListArticle[] = [];
  let priceOnRequestCount = 0;
  lines.forEach((line, i) => {
    const article = parseRow(line, i + 1);
    if (article.priceOnRequest) priceOnRequestCount += 1;
    articles.push(article);
  });
  return {
    kind: "price_list",
    wholesaler: "ahlsell",
    format: "ahlsell-prisfil",
    articles,
    rowCount: lines.length,
    priceOnRequestCount,
  };
}

export function detectAhlsellPriceList(sample: string[]): number {
  if (sample.length === 0) return 0;
  let rows = 0;
  for (const line of sample) {
    if (!looksLikePriceRow(line)) return 0;
    rows += 1;
  }
  return Math.min(1, rows / MIN_ROWS_FOR_KNOWN_FORMAT);
}

export const ahlsellPrisfilParser: WholesalerFileParser = {
  id: "ahlsell-prisfil",
  wholesaler: "ahlsell",
  label: "Ahlsell prisfil (bruttoprislista)",
  kind: "price_list",
  detect: detectAhlsellPriceList,
  parse: parseAhlsellPriceList,
};
