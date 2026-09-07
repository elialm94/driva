/**
 * Sökning i grossistkatalogen – gemensam normalisering och rankning för
 * båda lagringarna (fil/minne i JSON/demo, SQL i Supabase). Klientsäker.
 *
 * Användaren söker på artikelnamn, artikelnummer, E-nummer eller RSK-nummer.
 * Identifierare matchas på prefix (E-nummer skrivs ofta med mellanslag/
 * bindestreck – de tas bort), fritext ordvis mot namn/kategori.
 */
import type { WholesalerProduct } from "../types";

export const CATALOG_SEARCH_MIN_CHARS = 2;
export const CATALOG_SEARCH_PAGE_SIZE = 25;
export const CATALOG_SEARCH_MAX_PAGE_SIZE = 50;

/** Identifierare utan skiljetecken: "E 12 345 67" → "1234567", "RSK 831 24 40" → "8312440". */
export function normalizeIdentifier(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/^(e-?nr\.?|e|rsk|gtin|ean|art\.?nr\.?)\s*[:.]?\s*/i, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Fritext normaliserad för innehållssök. */
export function normalizeText(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Texten som indexeras per artikel (namn + identifierare + kategori + varumärke). */
export function productSearchText(
  p: Pick<WholesalerProduct, "name" | "articleNumber" | "eNumber" | "rskNumber" | "gtin" | "category" | "brand">,
): string {
  return [
    normalizeText(p.name),
    normalizeIdentifier(p.articleNumber),
    normalizeIdentifier(p.eNumber),
    normalizeIdentifier(p.rskNumber),
    normalizeIdentifier(p.gtin),
    normalizeText(p.category),
    normalizeText(p.brand),
  ]
    .filter(Boolean)
    .join(" ");
}

/** Kategorinyckel för filtrering/gruppering – grossistens text trimmad, skiftlägesokänslig. */
export function categoryKey(category: string | undefined | null): string {
  return normalizeText(category);
}

export interface CatalogCategory {
  /** Grossistens egen benämning (första förekomsten). */
  name: string;
  count: number;
}

export const CATALOG_MAX_CATEGORIES = 200;

/** Kategorier med antal artiklar, störst först (minneslagringen). */
export function categoriesInMemory(products: readonly WholesalerProduct[]): CatalogCategory[] {
  const byKey = new Map<string, CatalogCategory>();
  for (const p of products) {
    const key = categoryKey(p.category);
    if (!key) continue;
    const entry = byKey.get(key);
    if (entry) entry.count += 1;
    else byKey.set(key, { name: p.category!.trim(), count: 1 });
  }
  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "sv"))
    .slice(0, CATALOG_MAX_CATEGORIES);
}

export interface ParsedCatalogQuery {
  /** Hela frågan som identifierare (siffror/bokstäver utan skiljetecken). */
  identifier: string;
  /** Ordvisa fritexttokens. */
  tokens: string[];
  /** Frågan är för kort/tom – sök inte. */
  empty: boolean;
}

export function parseCatalogQuery(raw: string): ParsedCatalogQuery {
  const text = normalizeText(raw);
  const tokens = text.split(" ").filter((t) => t.length > 0);
  const identifier = normalizeIdentifier(raw);
  const empty = text.replace(/\s/g, "").length < CATALOG_SEARCH_MIN_CHARS;
  return { identifier, tokens, empty };
}

/**
 * Rankning (högre = bättre). 0 = ingen träff.
 *   100 exakt identifierare · 80 identifierare börjar med · 60 namn börjar med
 *   · 40 alla ord finns i söktexten · 20 minst ett ord finns (bara enordsfrågor).
 */
export function rankProduct(p: WholesalerProduct, q: ParsedCatalogQuery): number {
  if (q.empty) return 0;
  const ids = [p.articleNumber, p.eNumber, p.rskNumber, p.gtin].map(normalizeIdentifier).filter(Boolean);
  if (q.identifier.length >= 3) {
    if (ids.some((id) => id === q.identifier)) return 100;
    if (ids.some((id) => id.startsWith(q.identifier))) return 80;
  }
  const name = normalizeText(p.name);
  const text = productSearchText(p);
  const phrase = q.tokens.join(" ");
  if (phrase && name.startsWith(phrase)) return 60;
  if (q.tokens.length > 0 && q.tokens.every((t) => text.includes(t))) return 40;
  return 0;
}

export function compareRanked(a: { rank: number; product: WholesalerProduct }, b: { rank: number; product: WholesalerProduct }): number {
  if (b.rank !== a.rank) return b.rank - a.rank;
  return a.product.name.localeCompare(b.product.name, "sv") || a.product.articleNumber.localeCompare(b.product.articleNumber, "sv");
}

/**
 * Filtrera + ranka i minnet (fil-/minneslagringen och tester). Med en
 * kategori och tom fråga bläddras kategorin i namnordning – det är butikens
 * "visa alla i Kabel". Utan kategori krävs fortfarande en sökfråga.
 */
export function searchInMemory(
  products: readonly WholesalerProduct[],
  raw: string,
  page: { limit: number; offset: number },
  filter: { category?: string } = {},
): { rows: WholesalerProduct[]; total: number } {
  const q = parseCatalogQuery(raw);
  const wantedCategory = categoryKey(filter.category);
  const scope = wantedCategory ? products.filter((p) => categoryKey(p.category) === wantedCategory) : products;
  const limit = Math.max(1, Math.min(page.limit, CATALOG_SEARCH_MAX_PAGE_SIZE));
  const offset = Math.max(0, page.offset);
  if (q.empty) {
    if (!wantedCategory) return { rows: [], total: 0 };
    const sorted = scope.slice().sort((a, b) => compareRanked({ rank: 0, product: a }, { rank: 0, product: b }));
    return { rows: sorted.slice(offset, offset + limit), total: sorted.length };
  }
  const ranked: { rank: number; product: WholesalerProduct }[] = [];
  for (const product of scope) {
    const rank = rankProduct(product, q);
    if (rank > 0) ranked.push({ rank, product });
  }
  ranked.sort(compareRanked);
  return { rows: ranked.slice(offset, offset + limit).map((r) => r.product), total: ranked.length };
}
