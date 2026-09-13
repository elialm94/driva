/**
 * Kända grossistformat – gemensamt gränssnitt för parsrar.
 *
 * En grossistfil är antingen en PRISLISTA (artiklar med listpris) eller ett
 * RABATTAVTAL/rabattbrev (rabatter per materialklass + artikelvillkor). De
 * lagras separat och slås ihop först när ett pris ska visas
 * (lib/wholesalers/agreement-pricing.ts) – aldrig vid importen.
 *
 * Pengar är heltalsören, rabatter heltal i tiondels procent (`0420` = 42,0 %).
 * Klientsäker (inga beroenden).
 */

import type { WholesalerFileFormatId, WholesalerKey } from "../../types";

export type { WholesalerFileFormatId };

export type WholesalerFileKind = "price_list" | "discount_agreement";

/** Artikel ur en bruttoprisfil. `listPriceOre` saknas när priset är 0 = "pris på begäran". */
export interface PriceListArticle {
  articleNumber: string;
  name: string;
  listPriceOre?: number;
  /** Pris 0 i filen – betyder "pris på begäran", aldrig gratis. */
  priceOnRequest: boolean;
  /** Grossistens materialklass/rabattgrupp – nyckeln mot rabattavtalet. Högertrimmad. */
  materialClass?: string;
  unit: string;
  stocked?: boolean;
  /** Beställningsmultipel (antal), t.ex. 100 för kabel som säljs per 100 m. */
  orderMultiple?: number;
  envFeeIncluded?: boolean;
  extendedLiability?: boolean;
  energyEfficient?: boolean;
  /** Radnummer i filen (1-indexerat) – för felmeddelanden. */
  row: number;
}

export interface AgreementHeader {
  /** 1 = kundavtal/standardavtal, 3 = anläggningsavtal. */
  agreementType: "1" | "3";
  customerNumber: string;
  /** "000" för kundavtal. */
  facilityNumber: string;
  name: string;
  /** KEDJERABATT J/N i huvudet. */
  chainDiscount: "J" | "N";
  /** Körningsdatum (YYYY-MM-DD). */
  runDate?: string;
}

export interface ClassDiscount {
  /** Materialklass, högertrimmad – kan vara huvudgrupp (5 tecken) eller undergrupp (6). */
  materialClass: string;
  /** Rabatt i tiondels procent (heltal). */
  discountTenths: number;
  text: string;
  /** Avtalet giltigt till och med (YYYY-MM-DD). */
  endDate?: string;
  chainDiscountCode: "J" | "N";
  /** Bara ifyllt när KEDJERABATTKOD = J – lagras, räknas aldrig. */
  chainDiscountTenths?: number;
  row: number;
}

export interface ArticleTerm {
  articleNumber: string;
  /** Specrabatt på listpriset i tiondels procent. */
  specDiscountTenths?: number;
  /** Nettopris i ören. */
  netPriceOre?: number;
  endDate?: string;
  chainDiscountCode: "J" | "N";
  chainDiscountTenths?: number;
  row: number;
}

export interface ParsedPriceList {
  kind: "price_list";
  wholesaler: WholesalerKey;
  format: WholesalerFileFormatId;
  articles: PriceListArticle[];
  rowCount: number;
  /** Rader med pris 0 ("pris på begäran"). */
  priceOnRequestCount: number;
}

export interface ParsedDiscountAgreement {
  kind: "discount_agreement";
  wholesaler: WholesalerKey;
  format: WholesalerFileFormatId;
  header: AgreementHeader;
  classDiscounts: ClassDiscount[];
  articleTerms: ArticleTerm[];
  rowCount: number;
  /** Slutdatum ur raderna (det senaste om de skiljer sig). */
  endDate?: string;
  /** Antal rader med KEDJERABATTKOD = J – flaggas, ingen beräkning byggs på dem. */
  chainDiscountRows: number;
  /** Anmärkningar som inte stoppar importen (t.ex. artikelrad med både specrabatt och nettopris). */
  warnings: string[];
}

export type ParsedWholesalerFile = ParsedPriceList | ParsedDiscountAgreement;

export interface WholesalerFileParser {
  /** T.ex. "ahlsell-avtalsfil". */
  id: WholesalerFileFormatId;
  /** T.ex. "ahlsell" – matchar WholesalerKey när grossisten finns i listan. */
  wholesaler: WholesalerKey;
  /** Svensk etikett för UI:t. */
  label: string;
  kind: WholesalerFileKind;
  /** 0..1 – hur säkert de första raderna är det här formatet. */
  detect(sample: string[]): number;
  /** Tolka hela filen. Kastar WholesalerFileParseError med radnummer vid avvikande rader. */
  parse(text: string): ParsedWholesalerFile;
}

/** Hur många rader detekteringen måste ha kontrollerat innan ett format räknas som känt. */
export const MIN_ROWS_FOR_KNOWN_FORMAT = 50;

/** Hur många icke-tomma rader detekteringen tittar på. */
export const DETECTION_SAMPLE_ROWS = 200;

export class WholesalerFileParseError extends Error {
  readonly row?: number;
  constructor(message: string, row?: number) {
    super(row != null ? `Rad ${row}: ${message}` : message);
    this.name = "WholesalerFileParseError";
    this.row = row;
  }
}
