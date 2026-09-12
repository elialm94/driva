/**
 * Grossistkatalogen (artiklar) – lagras UTANFÖR tenantaggregatet.
 *
 * Aggregatet (db()/save()) laddas i sin helhet vid varje request; en katalog
 * på tiotusentals artiklar hör inte hemma där. Artiklarna bor därför i en
 * egen lagring med serversök och paginering:
 *
 *   * Supabase-läge, riktigt företag (uuid): tabellen wholesaler_products med
 *     RLS + index (catalog-store-sql.ts). Alla frågor körs i en transaktion
 *     bunden till tenantens business_id (bindTransaction) – aldrig utan.
 *   * JSON-läge, demosessioner (business-id "demo-…") och DRIVA_TEST: en fil
 *     per företag (eller bara minne i tester) – den här modulen.
 *
 * Metadata om importen (status, fel, antal) ligger i aggregatet
 * (wholesalerPriceImports) och pekas ut av anslutningens activeImportId.
 * Byte av aktiv import är därför en aggregatcommit; artikelraderna kan
 * skrivas före och städas efter utan att en halv import någonsin blir synlig.
 *
 * Rabattavtalets villkor (rabatt per materialklass, artikelvillkor – tusentals
 * rader) bor här av samma skäl, nycklade på connection.discountAgreement.id.
 * Huvudet ligger i aggregatet; bytet av avtal är en aggregatcommit.
 */
import fs from "fs";
import path from "path";
import type { WholesalerAgreementTerm, WholesalerProduct } from "../types";
import { articleTermKey, materialClassKey } from "./agreement-pricing";
import { categoriesInMemory, searchInMemory, type CatalogCategory } from "./catalog-search";

export interface CatalogSearchInput {
  connectionId: string;
  importId: string;
  query: string;
  /** Begränsa till grossistens kategori (exakt namn från categories()). Tom fråga + kategori = bläddra. */
  category?: string;
  limit: number;
  offset: number;
}

export interface CatalogSearchResult {
  rows: WholesalerProduct[];
  total: number;
}

export interface WholesalerCatalogStore {
  insertProducts(businessId: string, products: WholesalerProduct[]): Promise<void>;
  deleteImport(businessId: string, importId: string): Promise<void>;
  countImport(businessId: string, importId: string): Promise<number>;
  search(businessId: string, input: CatalogSearchInput): Promise<CatalogSearchResult>;
  /** Grossistens kategorier i den aktiva prislistan med antal artiklar, störst först. */
  categories(businessId: string, connectionId: string, importId: string): Promise<CatalogCategory[]>;
  getByIds(businessId: string, importId: string, ids: string[]): Promise<WholesalerProduct[]>;
  findByArticleNumbers(businessId: string, importId: string, articleNumbers: string[]): Promise<WholesalerProduct[]>;
  /** Artikelnummer + materialklass för alla artiklar i en import (täckningsberäkning). */
  listArticleClasses(businessId: string, importId: string): Promise<AgreementCoverageArticle[]>;

  /** Rabattavtal: skriv villkoren för ett avtal (idempotent på id). */
  insertAgreementTerms(businessId: string, terms: WholesalerAgreementTerm[]): Promise<void>;
  deleteAgreement(businessId: string, agreementId: string): Promise<void>;
  countAgreementTerms(businessId: string, agreementId: string): Promise<number>;
  /**
   * Villkoren som kan påverka en uppsättning artiklar: artikelnycklar
   * (normaliserade som article_key) och alla klassprefix (versaler).
   */
  agreementTermsFor(businessId: string, agreementId: string, keys: AgreementLookupKeys): Promise<WholesalerAgreementTerm[]>;
  /** Alla villkor för avtalet – bara för täckningsberäkningen vid import. */
  allAgreementTerms(businessId: string, agreementId: string): Promise<WholesalerAgreementTerm[]>;

  /** Demo-/dev-återställning: släng allt för företaget. */
  deleteBusiness(businessId: string): Promise<void> | void;
}

export interface AgreementLookupKeys {
  articleKeys: string[];
  classKeys: string[];
}

export interface AgreementCoverageArticle {
  articleNumber: string;
  materialClass?: string;
}

const onServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function catalogDir(): string {
  const override = process.env.DRIVA_WHOLESALER_CATALOG_DIR?.trim();
  if (override) return override;
  return onServerless
    ? path.join("/tmp", "driva-wholesaler-catalog")
    : path.join(process.cwd(), ".data", "wholesaler-catalog");
}

/** Filnamn får bara innehålla ett strikt alfabet – aldrig en väg ut ur katalogen. */
function safeBusinessFile(businessId: string): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(businessId)) {
    throw new Error("Ogiltigt företags-id för katalogen.");
  }
  return path.join(catalogDir(), `${businessId}.json`);
}

type CatalogFile = { products: WholesalerProduct[]; agreementTerms?: WholesalerAgreementTerm[] };
type CatalogData = { products: WholesalerProduct[]; terms: WholesalerAgreementTerm[] };

type GlobalWithCatalog = typeof globalThis & { __drivaWholesalerCatalog?: Map<string, CatalogData> };
const g = globalThis as GlobalWithCatalog;

function cache(): Map<string, CatalogData> {
  return (g.__drivaWholesalerCatalog ??= new Map());
}

function memoryOnly(): boolean {
  return process.env.DRIVA_TEST === "1";
}

function loadFile(businessId: string): CatalogData {
  const cached = cache().get(businessId);
  if (cached) return cached;
  let data: CatalogData = { products: [], terms: [] };
  if (!memoryOnly()) {
    try {
      const file = safeBusinessFile(businessId);
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as CatalogFile;
        data = {
          products: Array.isArray(parsed.products) ? parsed.products : [],
          terms: Array.isArray(parsed.agreementTerms) ? parsed.agreementTerms : [],
        };
      }
    } catch {
      data = { products: [], terms: [] };
    }
  }
  cache().set(businessId, data);
  return data;
}

function persistFile(businessId: string, data: CatalogData): void {
  cache().set(businessId, data);
  if (memoryOnly()) return;
  try {
    const file = safeBusinessFile(businessId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    const payload: CatalogFile = { products: data.products, agreementTerms: data.terms };
    fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    // Read-only FS: minnescachen räcker på den här instansen.
  }
}

function loadProducts(businessId: string): WholesalerProduct[] {
  return loadFile(businessId).products;
}

function persistProducts(businessId: string, products: WholesalerProduct[]): void {
  persistFile(businessId, { products, terms: loadFile(businessId).terms });
}

function persistTerms(businessId: string, terms: WholesalerAgreementTerm[]): void {
  persistFile(businessId, { products: loadFile(businessId).products, terms });
}

/** Fil-/minneslagringen: JSON-läge, demosessioner och tester. */
class FileCatalogStore implements WholesalerCatalogStore {
  async insertProducts(businessId: string, products: WholesalerProduct[]): Promise<void> {
    if (products.length === 0) return;
    const current = loadProducts(businessId);
    const ids = new Set(products.map((p) => p.id));
    persistProducts(businessId, [...current.filter((p) => !ids.has(p.id)), ...products]);
  }
  async deleteImport(businessId: string, importId: string): Promise<void> {
    const current = loadProducts(businessId);
    const next = current.filter((p) => p.importId !== importId);
    if (next.length !== current.length) persistProducts(businessId, next);
  }
  async countImport(businessId: string, importId: string): Promise<number> {
    return loadProducts(businessId).filter((p) => p.importId === importId).length;
  }
  async search(businessId: string, input: CatalogSearchInput): Promise<CatalogSearchResult> {
    const scope = loadProducts(businessId).filter(
      (p) => p.importId === input.importId && p.connectionId === input.connectionId,
    );
    return searchInMemory(scope, input.query, { limit: input.limit, offset: input.offset }, { category: input.category });
  }
  async categories(businessId: string, connectionId: string, importId: string): Promise<CatalogCategory[]> {
    return categoriesInMemory(
      loadProducts(businessId).filter((p) => p.importId === importId && p.connectionId === connectionId),
    );
  }
  async getByIds(businessId: string, importId: string, ids: string[]): Promise<WholesalerProduct[]> {
    const wanted = new Set(ids);
    return loadProducts(businessId).filter((p) => p.importId === importId && wanted.has(p.id));
  }
  async findByArticleNumbers(businessId: string, importId: string, articleNumbers: string[]): Promise<WholesalerProduct[]> {
    const wanted = new Set(articleNumbers.map((a) => a.trim().toLowerCase()));
    return loadProducts(businessId).filter(
      (p) => p.importId === importId && wanted.has(p.articleNumber.trim().toLowerCase()),
    );
  }
  async listArticleClasses(businessId: string, importId: string): Promise<AgreementCoverageArticle[]> {
    return loadProducts(businessId)
      .filter((p) => p.importId === importId)
      .map((p) => ({ articleNumber: p.articleNumber, materialClass: p.discountGroup }));
  }

  async insertAgreementTerms(businessId: string, terms: WholesalerAgreementTerm[]): Promise<void> {
    if (terms.length === 0) return;
    const current = loadFile(businessId).terms;
    const ids = new Set(terms.map((t) => t.id));
    persistTerms(businessId, [...current.filter((t) => !ids.has(t.id)), ...terms]);
  }
  async deleteAgreement(businessId: string, agreementId: string): Promise<void> {
    const current = loadFile(businessId).terms;
    const next = current.filter((t) => t.agreementId !== agreementId);
    if (next.length !== current.length) persistTerms(businessId, next);
  }
  async countAgreementTerms(businessId: string, agreementId: string): Promise<number> {
    return loadFile(businessId).terms.filter((t) => t.agreementId === agreementId).length;
  }
  async agreementTermsFor(businessId: string, agreementId: string, keys: AgreementLookupKeys): Promise<WholesalerAgreementTerm[]> {
    const articleKeys = new Set(keys.articleKeys);
    const classKeys = new Set(keys.classKeys);
    return loadFile(businessId).terms.filter(
      (t) =>
        t.agreementId === agreementId &&
        (t.kind === "article"
          ? articleKeys.has(articleTermKey(t.articleNumber))
          : classKeys.has(materialClassKey(t.materialClass))),
    );
  }
  async allAgreementTerms(businessId: string, agreementId: string): Promise<WholesalerAgreementTerm[]> {
    return loadFile(businessId).terms.filter((t) => t.agreementId === agreementId);
  }

  deleteBusiness(businessId: string): void {
    cache().delete(businessId);
    if (memoryOnly()) return;
    try {
      fs.rmSync(safeBusinessFile(businessId), { force: true });
    } catch {
      // Saknas filen är det redan rent.
    }
  }
}

let fileStore: FileCatalogStore | undefined;

export function fileCatalogStore(): WholesalerCatalogStore {
  return (fileStore ??= new FileCatalogStore());
}

/** Katalogfiler för utgångna demosessioner städas ihop med sessionsfilerna. */
export function deleteCatalogFileFor(businessId: string): void {
  fileCatalogStore().deleteBusiness(businessId);
}

export function __resetCatalogCacheForTests(): void {
  cache().clear();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Riktiga företag i Supabase-läget har uuid-id:n och sin katalog i Postgres.
 * Demosessioner ("demo-…") och det lokala JSON-företaget ("local") går alltid
 * till fillagringen – en demosession kan aldrig nå databasen.
 */
export function usesSqlCatalog(businessId: string, supabaseMode: boolean): boolean {
  return supabaseMode && UUID_RE.test(businessId);
}
