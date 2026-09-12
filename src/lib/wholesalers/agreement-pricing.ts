/**
 * Inköpspris ur rabattavtal – räknas vid LÄSNING, aldrig vid importen.
 *
 * Rabattavtalet (t.ex. Ahlsell avtalsfil) och prislistan (t.ex. Ahlsell
 * prisfil) lagras var för sig. När ett pris ska visas slås de ihop här, i
 * exakt den ordning grossisten själv tillämpar:
 *
 *   1. Nettopris på artikeln (artikelvillkor med NETTOPRIS)
 *   2. Specrabatt på artikeln (artikelvillkor med SPECRABATT) × listpris
 *   3. Rabatt på materialklassen: exakt klass först, sedan längsta prefix
 *      (en artikel i klass CÄÄ011 träffar huvudgruppen CÄÄ01 om ingen rad
 *      för CÄÄ011 finns) × listpris
 *   4. Listpris utan rabatt
 *
 * Ett nettopris som står uttryckligen i prislistan (netPriceSource "file",
 * kundunik nettoprislista) är redan grossistens avtalade pris och rabatteras
 * inte igen. Det äldre rabattbrevet (netPriceSource "discount_group") räknas
 * fortfarande vid importen och gäller när inget avtal finns.
 *
 * Rabatter är heltal i tiondels procent, priser heltalsören. Avrundning till
 * hela kronor sker först när priset går in i en offert-/fakturarad – se
 * README, ADR-1 (tillägg om grossistpriser). KEDJERABATT lagras men ingen
 * beräkning bygger på den.
 *
 * Modulen är ren (inga I/O-beroenden) så att förklaringen kan visas i
 * klientkomponenter.
 */
import { datumLang } from "../format";
import { formatOre } from "./money";
import type {
  WholesalerAgreementTerm,
  WholesalerDiscountAgreement,
  WholesalerPriceExplanation,
  WholesalerProduct,
} from "../types";

/** Materialklass/rabattgrupp som nyckel: trimmad, versaler, ett mellanslag. */
export function materialClassKey(raw: string | undefined | null): string {
  return (raw ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

/** Artikelnyckel: samma normalisering som katalogens article_key. */
export function articleTermKey(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Alla prefix som kan matcha en materialklass, längst först:
 * "CÄÄ011" → ["CÄÄ011", "CÄÄ01", "CÄÄ0", "CÄÄ", "CÄ", "C"].
 */
export function classPrefixes(materialClass: string | undefined | null): string[] {
  const key = materialClassKey(materialClass);
  const out: string[] = [];
  for (let len = key.length; len >= 1; len--) out.push(key.slice(0, len));
  return out;
}

export interface AgreementTermIndex {
  byArticle: Map<string, WholesalerAgreementTerm>;
  byClass: Map<string, WholesalerAgreementTerm>;
}

export function indexAgreementTerms(terms: Iterable<WholesalerAgreementTerm>): AgreementTermIndex {
  const byArticle = new Map<string, WholesalerAgreementTerm>();
  const byClass = new Map<string, WholesalerAgreementTerm>();
  for (const t of terms) {
    if (t.kind === "article") {
      const key = articleTermKey(t.articleNumber);
      if (key) byArticle.set(key, t);
    } else {
      const key = materialClassKey(t.materialClass);
      if (key) byClass.set(key, t);
    }
  }
  return { byArticle, byClass };
}

/** Exakt klass först, därefter längsta prefix som har en rad i avtalet. */
export function pickClassTerm(
  materialClass: string | undefined | null,
  byClass: Map<string, WholesalerAgreementTerm>,
): WholesalerAgreementTerm | undefined {
  for (const prefix of classPrefixes(materialClass)) {
    const hit = byClass.get(prefix);
    if (hit) return hit;
  }
  return undefined;
}

/** Listpris × (1 − rabatt), i ören, avrundat till heltalsöre. */
export function applyDiscountTenths(listPriceOre: number, tenths: number): number {
  return Math.round((listPriceOre * (1000 - tenths)) / 1000);
}

export function formatTenthsPercent(tenths: number): string {
  const whole = Math.floor(tenths / 10);
  const rest = tenths % 10;
  return rest === 0 ? `${whole} %` : `${whole},${rest} %`;
}

function agreementSuffix(agreement: WholesalerDiscountAgreement, endDate?: string): string {
  const parts: string[] = [];
  if (agreement.name) parts.push(`avtal ${agreement.name}`);
  const until = endDate ?? agreement.endDate;
  if (until) parts.push(`gäller t.o.m. ${datumLang(until)}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

export interface ResolvedPurchasePrice {
  netPriceOre?: number;
  netPriceSource?: WholesalerProduct["netPriceSource"];
  explanation: WholesalerPriceExplanation;
}

/**
 * Räkna fram inköpspriset för en artikel givet avtalets villkor. Returnerar
 * alltid en förklaring – även när inget pris kan räknas fram.
 */
export function resolvePurchasePrice(
  product: WholesalerProduct,
  agreement: WholesalerDiscountAgreement | undefined,
  index: AgreementTermIndex | undefined,
): ResolvedPurchasePrice {
  const listPriceOre = product.listPriceOre;
  const materialClass = product.discountGroup;

  if (product.netPriceOre != null && product.netPriceSource === "file") {
    return {
      netPriceOre: product.netPriceOre,
      netPriceSource: "file",
      explanation: {
        rule: "file",
        listPriceOre,
        materialClass,
        text: `Nettopris ${formatOre(product.netPriceOre, { alwaysDecimals: true })} anges direkt i prislistan.`,
      },
    };
  }

  if (agreement && index) {
    const articleTerm = index.byArticle.get(articleTermKey(product.articleNumber));
    if (articleTerm?.netPriceOre != null) {
      return {
        netPriceOre: articleTerm.netPriceOre,
        netPriceSource: "agreement_net_price",
        explanation: {
          rule: "agreement_net_price",
          listPriceOre,
          materialClass,
          agreementName: agreement.name,
          agreementEndDate: articleTerm.endDate ?? agreement.endDate,
          text: `Nettopris ${formatOre(articleTerm.netPriceOre, { alwaysDecimals: true })} för artikeln${agreementSuffix(agreement, articleTerm.endDate)}.`,
        },
      };
    }
    if (articleTerm?.discountTenths != null && listPriceOre != null) {
      const net = applyDiscountTenths(listPriceOre, articleTerm.discountTenths);
      return {
        netPriceOre: net,
        netPriceSource: "agreement_spec_discount",
        explanation: {
          rule: "agreement_spec_discount",
          listPriceOre,
          discountTenths: articleTerm.discountTenths,
          materialClass,
          agreementName: agreement.name,
          agreementEndDate: articleTerm.endDate ?? agreement.endDate,
          text: `Listpris ${formatOre(listPriceOre, { alwaysDecimals: true })} − ${formatTenthsPercent(articleTerm.discountTenths)} specrabatt för artikeln${agreementSuffix(agreement, articleTerm.endDate)} = ${formatOre(net, { alwaysDecimals: true })}.`,
        },
      };
    }
    const classTerm = pickClassTerm(materialClass, index.byClass);
    if (classTerm?.discountTenths != null && listPriceOre != null) {
      const net = applyDiscountTenths(listPriceOre, classTerm.discountTenths);
      const productKey = materialClassKey(materialClass);
      const matched = materialClassKey(classTerm.materialClass);
      const viaPrefix = matched !== productKey;
      const classLabel = viaPrefix
        ? `materialklass ${productKey} via huvudgrupp ${matched}${classTerm.materialClassText ? ` (${classTerm.materialClassText})` : ""}`
        : `materialklass ${matched}${classTerm.materialClassText ? ` (${classTerm.materialClassText})` : ""}`;
      return {
        netPriceOre: net,
        netPriceSource: "agreement_class_discount",
        explanation: {
          rule: "agreement_class_discount",
          listPriceOre,
          discountTenths: classTerm.discountTenths,
          materialClass,
          matchedClass: classTerm.materialClass,
          matchedClassText: classTerm.materialClassText,
          agreementName: agreement.name,
          agreementEndDate: classTerm.endDate ?? agreement.endDate,
          text: `Listpris ${formatOre(listPriceOre, { alwaysDecimals: true })} − ${formatTenthsPercent(classTerm.discountTenths)} för ${classLabel}${agreementSuffix(agreement, classTerm.endDate)} = ${formatOre(net, { alwaysDecimals: true })}.`,
        },
      };
    }
  }

  if (product.netPriceOre != null && product.netPriceSource === "discount_group") {
    return {
      netPriceOre: product.netPriceOre,
      netPriceSource: "discount_group",
      explanation: {
        rule: "discount_group",
        listPriceOre,
        discountTenths: product.discountPercent != null ? Math.round(product.discountPercent * 10) : undefined,
        materialClass,
        text:
          listPriceOre != null && product.discountPercent != null
            ? `Listpris ${formatOre(listPriceOre, { alwaysDecimals: true })} − ${formatTenthsPercent(Math.round(product.discountPercent * 10))} enligt rabattbrevet för rabattgrupp ${materialClassKey(materialClass) || "–"} = ${formatOre(product.netPriceOre, { alwaysDecimals: true })}.`
            : `Nettopris ${formatOre(product.netPriceOre, { alwaysDecimals: true })} enligt rabattbrevet.`,
      },
    };
  }

  if (listPriceOre != null) {
    const why = agreement
      ? materialClass
        ? `Ingen rabatt i avtalet ${agreement.name} för materialklass ${materialClassKey(materialClass)}.`
        : `Artikeln saknar materialklass – ingen avtalsrabatt kan slås upp.`
      : `Inget rabattavtal är inläst för grossisten.`;
    return {
      netPriceOre: undefined,
      netPriceSource: undefined,
      explanation: {
        rule: "list_price",
        listPriceOre,
        materialClass,
        agreementName: agreement?.name,
        text: `Listpris ${formatOre(listPriceOre, { alwaysDecimals: true })} utan rabatt. ${why}`,
      },
    };
  }

  return {
    netPriceOre: undefined,
    netPriceSource: undefined,
    explanation: {
      rule: "none",
      materialClass,
      agreementName: agreement?.name,
      text: "Pris på begäran – prislistan saknar listpris för artikeln.",
    },
  };
}

/**
 * Lägg avtalspris + förklaring på artiklarna. Lagrade fält (netPriceOre från
 * filen/rabattbrevet) rörs inte när avtalet inte ger något bättre svar.
 */
export function applyAgreementToProducts(
  products: WholesalerProduct[],
  agreement: WholesalerDiscountAgreement | undefined,
  index: AgreementTermIndex | undefined,
): WholesalerProduct[] {
  return products.map((p) => {
    const resolved = resolvePurchasePrice(p, agreement, index);
    const next: WholesalerProduct = { ...p, priceExplanation: resolved.explanation };
    if (resolved.netPriceOre != null) {
      next.netPriceOre = resolved.netPriceOre;
      next.netPriceSource = resolved.netPriceSource;
      if (resolved.explanation.discountTenths != null) {
        next.discountPercent = resolved.explanation.discountTenths / 10;
      }
    }
    return next;
  });
}

/** Nycklar som behöver hämtas ur avtalet för en uppsättning artiklar. */
export function agreementLookupKeys(products: Array<Pick<WholesalerProduct, "articleNumber" | "discountGroup">>): {
  articleKeys: string[];
  classKeys: string[];
} {
  const articleKeys = new Set<string>();
  const classKeys = new Set<string>();
  for (const p of products) {
    const a = articleTermKey(p.articleNumber);
    if (a) articleKeys.add(a);
    for (const prefix of classPrefixes(p.discountGroup)) classKeys.add(prefix);
  }
  return { articleKeys: [...articleKeys], classKeys: [...classKeys] };
}

/**
 * Täckning: hur många artiklar i prislistan får ingen rabatt alls ur avtalet
 * (varken artikelvillkor eller klassrabatt, inte ens via prefix). En hög
 * siffra betyder oftast fel avtalsfil.
 */
export function agreementCoverage(
  articles: Array<{ articleNumber: string; materialClass?: string }>,
  index: AgreementTermIndex,
): { articleCount: number; withoutTermsCount: number } {
  let without = 0;
  for (const a of articles) {
    if (index.byArticle.has(articleTermKey(a.articleNumber))) continue;
    if (pickClassTerm(a.materialClass, index.byClass)) continue;
    without++;
  }
  return { articleCount: articles.length, withoutTermsCount: without };
}

/** Har avtalet (eller en rad i det) passerat sitt slutdatum? Visas – blockerar aldrig. */
export function agreementExpired(endDate: string | undefined, today = new Date()): boolean {
  if (!endDate) return false;
  const end = new Date(`${endDate}T23:59:59`);
  return !Number.isNaN(end.getTime()) && end.getTime() < today.getTime();
}
