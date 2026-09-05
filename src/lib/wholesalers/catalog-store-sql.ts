/**
 * SQL-lagringen för grossistkatalogen (Supabase/Postgres, PGlite i tester).
 *
 * Varje anrop körs i EN transaktion bunden till tenantens business_id
 * (bindTransaction: set local role driva_app + app.business_id-GUC) så att
 * RLS på wholesaler_products gäller hela vägen. Sökningen är paginerad och
 * använder tabellens index (normaliserade identifierare + trigram på söktext).
 */
import type { WholesalerProduct } from "../types";
import type { SqlExecutor, SqlParam, SqlRow } from "../storage/executor";
import { sqlClient } from "../storage/adapter-supabase";
import { bindTransaction } from "../storage/load";
import { num } from "../storage/mappers";
import {
  CATALOG_SEARCH_MAX_PAGE_SIZE,
  normalizeIdentifier,
  normalizeText,
  parseCatalogQuery,
  productSearchText,
} from "./catalog-search";
import type { CatalogSearchInput, CatalogSearchResult, WholesalerCatalogStore } from "./catalog-store";

const INSERT_BATCH = 500;

export const WHOLESALER_PRODUCT_COLUMNS = [
  "id",
  "business_id",
  "connection_id",
  "import_id",
  "article_number",
  "name",
  "e_number",
  "rsk_number",
  "gtin",
  "category",
  "discount_group",
  "unit",
  "pack_size",
  "list_price_ore",
  "discount_percent",
  "net_price_ore",
  "net_price_source",
  "sales_price_ore",
  "article_key",
  "e_key",
  "rsk_key",
  "gtin_key",
  "name_key",
  "search_text",
] as const;

export function productToRow(p: WholesalerProduct, businessId: string): SqlParam[] {
  return [
    p.id,
    businessId,
    p.connectionId,
    p.importId,
    p.articleNumber,
    p.name,
    p.eNumber ?? null,
    p.rskNumber ?? null,
    p.gtin ?? null,
    p.category ?? null,
    p.discountGroup ?? null,
    p.unit,
    p.packSize ?? null,
    p.listPriceOre ?? null,
    p.discountPercent ?? null,
    p.netPriceOre ?? null,
    p.netPriceSource ?? null,
    p.salesPriceOre ?? null,
    normalizeIdentifier(p.articleNumber),
    normalizeIdentifier(p.eNumber) || null,
    normalizeIdentifier(p.rskNumber) || null,
    normalizeIdentifier(p.gtin) || null,
    normalizeText(p.name),
    productSearchText(p),
  ];
}

function strOrU(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}
function numOrU(v: unknown): number | undefined {
  return v == null ? undefined : num(v);
}
function opt<K extends string, V>(key: K, v: V | undefined): { [P in K]?: V } {
  return v === undefined ? {} : ({ [key]: v } as { [P in K]?: V });
}

export function productFromRow(r: SqlRow): WholesalerProduct {
  return {
    id: String(r.id),
    connectionId: String(r.connection_id),
    importId: String(r.import_id),
    articleNumber: String(r.article_number),
    name: String(r.name),
    ...opt("eNumber", strOrU(r.e_number)),
    ...opt("rskNumber", strOrU(r.rsk_number)),
    ...opt("gtin", strOrU(r.gtin)),
    ...opt("category", strOrU(r.category)),
    ...opt("discountGroup", strOrU(r.discount_group)),
    unit: String(r.unit ?? "st"),
    ...opt("packSize", numOrU(r.pack_size)),
    ...opt("listPriceOre", numOrU(r.list_price_ore)),
    ...opt("discountPercent", numOrU(r.discount_percent)),
    ...opt("netPriceOre", numOrU(r.net_price_ore)),
    ...opt("netPriceSource", strOrU(r.net_price_source) as WholesalerProduct["netPriceSource"] | undefined),
    ...opt("salesPriceOre", numOrU(r.sales_price_ore)),
  };
}

async function inTenantTx<T>(businessId: string, fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
  const client = await sqlClient();
  return client.transaction(async (tx) => {
    await bindTransaction(tx, businessId);
    return fn(tx);
  });
}

/** Multi-row insert: (…),(…),… med löpande $-parametrar. */
export async function insertProductBatch(tx: SqlExecutor, businessId: string, batch: WholesalerProduct[]): Promise<void> {
  if (batch.length === 0) return;
  const cols = WHOLESALER_PRODUCT_COLUMNS.length;
  const params: SqlParam[] = [];
  const tuples: string[] = [];
  batch.forEach((p, i) => {
    const row = productToRow(p, businessId);
    params.push(...row);
    const placeholders = row.map((_, j) => `$${i * cols + j + 1}`);
    tuples.push(`(${placeholders.join(", ")})`);
  });
  await tx.query(
    `insert into public.wholesaler_products (${WHOLESALER_PRODUCT_COLUMNS.join(", ")})
     values ${tuples.join(",\n")}
     on conflict (id) do nothing`,
    params,
  );
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class SqlCatalogStore implements WholesalerCatalogStore {
  async insertProducts(businessId: string, products: WholesalerProduct[]): Promise<void> {
    if (products.length === 0) return;
    await inTenantTx(businessId, async (tx) => {
      for (let i = 0; i < products.length; i += INSERT_BATCH) {
        await insertProductBatch(tx, businessId, products.slice(i, i + INSERT_BATCH));
      }
    });
  }

  async deleteImport(businessId: string, importId: string): Promise<void> {
    await inTenantTx(businessId, (tx) =>
      tx.query(`delete from public.wholesaler_products where business_id = $1 and import_id = $2`, [businessId, importId]),
    );
  }

  async countImport(businessId: string, importId: string): Promise<number> {
    const rows = await inTenantTx(businessId, (tx) =>
      tx.query(`select count(*)::int as n from public.wholesaler_products where business_id = $1 and import_id = $2`, [
        businessId,
        importId,
      ]),
    );
    return num(rows[0]?.n);
  }

  async search(businessId: string, input: CatalogSearchInput): Promise<CatalogSearchResult> {
    const q = parseCatalogQuery(input.query);
    if (q.empty) return { rows: [], total: 0 };
    const limit = Math.max(1, Math.min(input.limit, CATALOG_SEARCH_MAX_PAGE_SIZE));
    const offset = Math.max(0, input.offset);

    const params: SqlParam[] = [businessId, input.importId, input.connectionId];
    const conditions: string[] = [];
    let rankSql = "40";

    const identifierSearch = q.identifier.length >= 3;
    if (identifierSearch) {
      params.push(q.identifier);
      const idParam = `$${params.length}`;
      params.push(`${likeEscape(q.identifier)}%`);
      const prefixParam = `$${params.length}`;
      conditions.push(
        `(article_key like ${prefixParam} or e_key like ${prefixParam} or rsk_key like ${prefixParam} or gtin_key like ${prefixParam})`,
      );
      rankSql = `case
        when article_key = ${idParam} or e_key = ${idParam} or rsk_key = ${idParam} or gtin_key = ${idParam} then 100
        when article_key like ${prefixParam} or e_key like ${prefixParam} or rsk_key like ${prefixParam} or gtin_key like ${prefixParam} then 80
        else 0 end`;
    }

    if (q.tokens.length > 0) {
      const tokenConds = q.tokens.map((t) => {
        params.push(`%${likeEscape(t)}%`);
        return `search_text like $${params.length}`;
      });
      conditions.push(`(${tokenConds.join(" and ")})`);
      params.push(`${likeEscape(q.tokens.join(" "))}%`);
      const phraseParam = `$${params.length}`;
      rankSql = `greatest(${rankSql}, case when name_key like ${phraseParam} then 60 else 40 end)`;
    }

    if (conditions.length === 0) return { rows: [], total: 0 };
    const where = `business_id = $1 and import_id = $2 and connection_id = $3 and (${conditions.join(" or ")})`;

    return inTenantTx(businessId, async (tx) => {
      const countRows = await tx.query(`select count(*)::int as n from public.wholesaler_products where ${where}`, params);
      const total = num(countRows[0]?.n);
      const rows = await tx.query(
        `select *, (${rankSql}) as rank
           from public.wholesaler_products
          where ${where}
          order by rank desc, name_key, article_key
          limit ${limit} offset ${offset}`,
        params,
      );
      return { rows: rows.map(productFromRow), total };
    });
  }

  async getByIds(businessId: string, importId: string, ids: string[]): Promise<WholesalerProduct[]> {
    if (ids.length === 0) return [];
    const rows = await inTenantTx(businessId, (tx) =>
      tx.query(
        `select * from public.wholesaler_products
          where business_id = $1 and import_id = $2 and id = any($3::text[])`,
        [businessId, importId, `{${ids.map((id) => `"${id.replace(/["\\]/g, "")}"`).join(",")}}`],
      ),
    );
    return rows.map(productFromRow);
  }

  async findByArticleNumbers(businessId: string, importId: string, articleNumbers: string[]): Promise<WholesalerProduct[]> {
    const keys = articleNumbers.map(normalizeIdentifier).filter(Boolean);
    if (keys.length === 0) return [];
    const rows = await inTenantTx(businessId, (tx) =>
      tx.query(
        `select * from public.wholesaler_products
          where business_id = $1 and import_id = $2 and article_key = any($3::text[])`,
        [businessId, importId, `{${keys.map((k) => `"${k}"`).join(",")}}`],
      ),
    );
    return rows.map(productFromRow);
  }

  async deleteBusiness(businessId: string): Promise<void> {
    await inTenantTx(businessId, (tx) =>
      tx.query(`delete from public.wholesaler_products where business_id = $1`, [businessId]),
    );
  }
}

let sqlStore: SqlCatalogStore | undefined;

export function sqlCatalogStore(): WholesalerCatalogStore {
  return (sqlStore ??= new SqlCatalogStore());
}
