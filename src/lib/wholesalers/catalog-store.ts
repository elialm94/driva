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
 */
import fs from "fs";
import path from "path";
import type { WholesalerProduct } from "../types";
import { searchInMemory } from "./catalog-search";

export interface CatalogSearchInput {
  connectionId: string;
  importId: string;
  query: string;
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
  getByIds(businessId: string, importId: string, ids: string[]): Promise<WholesalerProduct[]>;
  findByArticleNumbers(businessId: string, importId: string, articleNumbers: string[]): Promise<WholesalerProduct[]>;
  /** Demo-/dev-återställning: släng allt för företaget. */
  deleteBusiness(businessId: string): Promise<void> | void;
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

type CatalogFile = { products: WholesalerProduct[] };

type GlobalWithCatalog = typeof globalThis & { __drivaWholesalerCatalog?: Map<string, WholesalerProduct[]> };
const g = globalThis as GlobalWithCatalog;

function cache(): Map<string, WholesalerProduct[]> {
  return (g.__drivaWholesalerCatalog ??= new Map());
}

function memoryOnly(): boolean {
  return process.env.DRIVA_TEST === "1";
}

function loadFile(businessId: string): WholesalerProduct[] {
  const cached = cache().get(businessId);
  if (cached) return cached;
  let products: WholesalerProduct[] = [];
  if (!memoryOnly()) {
    try {
      const file = safeBusinessFile(businessId);
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as CatalogFile;
        products = Array.isArray(parsed.products) ? parsed.products : [];
      }
    } catch {
      products = [];
    }
  }
  cache().set(businessId, products);
  return products;
}

function persistFile(businessId: string, products: WholesalerProduct[]): void {
  cache().set(businessId, products);
  if (memoryOnly()) return;
  try {
    const file = safeBusinessFile(businessId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ products } satisfies CatalogFile), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    // Read-only FS: minnescachen räcker på den här instansen.
  }
}

/** Fil-/minneslagringen: JSON-läge, demosessioner och tester. */
class FileCatalogStore implements WholesalerCatalogStore {
  async insertProducts(businessId: string, products: WholesalerProduct[]): Promise<void> {
    if (products.length === 0) return;
    const current = loadFile(businessId);
    const ids = new Set(products.map((p) => p.id));
    persistFile(businessId, [...current.filter((p) => !ids.has(p.id)), ...products]);
  }
  async deleteImport(businessId: string, importId: string): Promise<void> {
    const current = loadFile(businessId);
    const next = current.filter((p) => p.importId !== importId);
    if (next.length !== current.length) persistFile(businessId, next);
  }
  async countImport(businessId: string, importId: string): Promise<number> {
    return loadFile(businessId).filter((p) => p.importId === importId).length;
  }
  async search(businessId: string, input: CatalogSearchInput): Promise<CatalogSearchResult> {
    const scope = loadFile(businessId).filter(
      (p) => p.importId === input.importId && p.connectionId === input.connectionId,
    );
    return searchInMemory(scope, input.query, { limit: input.limit, offset: input.offset });
  }
  async getByIds(businessId: string, importId: string, ids: string[]): Promise<WholesalerProduct[]> {
    const wanted = new Set(ids);
    return loadFile(businessId).filter((p) => p.importId === importId && wanted.has(p.id));
  }
  async findByArticleNumbers(businessId: string, importId: string, articleNumbers: string[]): Promise<WholesalerProduct[]> {
    const wanted = new Set(articleNumbers.map((a) => a.trim().toLowerCase()));
    return loadFile(businessId).filter(
      (p) => p.importId === importId && wanted.has(p.articleNumber.trim().toLowerCase()),
    );
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
