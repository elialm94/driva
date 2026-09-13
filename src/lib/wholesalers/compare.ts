/**
 * Prisjämförelse mellan grossister. Samma produkt slås ihop bara när det
 * finns en säker identifierare: E-nummer, RSK, GTIN eller exakt
 * tillverkarartikel + tillverkare. Aldrig bara liknande namn.
 */
import type { WholesalerProduct } from "../types";
import { normalizeIdentifier, normalizeText } from "./catalog-search";

export type ComparableKeyKind = "e" | "rsk" | "gtin" | "mfr";

export interface ComparableKey {
  kind: ComparableKeyKind;
  key: string;
}

export function comparableProductKey(
  product: Pick<WholesalerProduct, "eNumber" | "rskNumber" | "gtin" | "articleNumber" | "brand">
): ComparableKey | null {
  const e = normalizeIdentifier(product.eNumber);
  if (e.length >= 6) return { kind: "e", key: `e:${e}` };
  const rsk = normalizeIdentifier(product.rskNumber);
  if (rsk.length >= 6) return { kind: "rsk", key: `rsk:${rsk}` };
  const gtin = normalizeIdentifier(product.gtin);
  if (gtin.length >= 8) return { kind: "gtin", key: `gtin:${gtin}` };
  const brand = normalizeText(product.brand);
  const art = normalizeIdentifier(product.articleNumber);
  if (brand && art) return { kind: "mfr", key: `mfr:${brand}:${art}` };
  return null;
}

export function sameComparableProduct(
  a: Pick<WholesalerProduct, "eNumber" | "rskNumber" | "gtin" | "articleNumber" | "brand" | "name">,
  b: Pick<WholesalerProduct, "eNumber" | "rskNumber" | "gtin" | "articleNumber" | "brand" | "name">
): boolean {
  const ka = comparableProductKey(a);
  const kb = comparableProductKey(b);
  if (!ka || !kb) return false;
  return ka.key === kb.key;
}

export function comparableUnitPriceOre(input: {
  netPriceOre?: number;
  packSize?: number;
}): number | undefined {
  if (input.netPriceOre == null) return undefined;
  const pack = input.packSize && input.packSize > 0 ? input.packSize : 1;
  return Math.round(input.netPriceOre / pack);
}

export interface ComparedOffer {
  connectionId: string;
  wholesalerLabel: string;
  productId: string;
  articleNumber: string;
  netPriceOre?: number;
  packSize?: number;
  unitPriceOre?: number;
  priceDate?: string;
  stale?: boolean;
  customerPriceOre?: number;
}

export interface PriceComparison {
  key: ComparableKey;
  offers: ComparedOffer[];
  lowestConnectionId?: string;
}

export function compareOffers(offers: ComparedOffer[]): PriceComparison | undefined {
  const priced = offers.filter((o) => o.unitPriceOre != null);
  if (priced.length === 0) return undefined;
  const lowest = priced.reduce((a, b) => ((a.unitPriceOre ?? Infinity) <= (b.unitPriceOre ?? Infinity) ? a : b));
  return {
    key: { kind: "e", key: "group" },
    offers,
    lowestConnectionId: lowest.connectionId,
  };
}
