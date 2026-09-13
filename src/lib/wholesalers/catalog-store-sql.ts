/**
 * SQL-lagringen för grossistkatalogen (Supabase/Postgres, PGlite i tester).
 *
 * Varje anrop körs i EN transaktion bunden till tenantens business_id
 * (bindTransaction: set local role driva_app + app.business_id-GUC) så att
 * RLS på wholesaler_products gäller hela vägen. Sökningen är paginerad och
 * använder tabellens index (normaliserade identifierare + trigram på söktext).
 */
import type { WholesalerAgreementTerm, WholesalerProduct } from "../types";
import type { SqlExecutor, SqlParam, SqlRow } from "../storage/executor";
import { sqlClient } from "../storage/adapter-supabase";
import { bindTransaction } from "../storage/load";
import { num } from "../storage/mappers";
import { articleTermKey, materialClassKey } from "./agreement-pricing";
import {
  CATALOG_MAX_CATEGORIES,
  CATALOG_SEARCH_MAX_PAGE_SIZE,
  categoryKey,
  normalizeIdentifier,
  normalizeText,
  parseCatalogQuery,
  productSearchText,
  type CatalogCategory,
} from "./catalog-search";
import type {
  AgreementCoverageArticle,
  AgreementLookupKeys,
  CatalogSearchInput,
  CatalogSearchResult,
  WholesalerCatalogStore,
} from "./catalog-store";

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
  "brand",
  "image_url",
  "discount_group",
  "unit",
  "pack_size",
  "stocked",
  "list_price_ore",
  "discount_percent",
  "net_price_ore",
  "net_price_source",
  "sales_price_ore",
  "article_key",
  "e_key",
  "rsk_key",
  "gtin_key",
  "category_key",
  "name_key",
  "search_text",
] as const;

/** Bara källor som får LAGRAS – avtalspriser räknas vid läsning och skrivs aldrig. */
function storedNetPriceSource(p: WholesalerProduct): "file" | "discount_group" | null {
  return p.netPriceSource === "file" || p.netPriceSource === "discount_group" ? p.netPriceSource : null;
}

export function productToRow(p: WholesalerProduct, businessId: string): SqlParam[] {
  const storedSource = storedNetPriceSource(p);
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
    p.brand ?? null,
    p.imageUrl ?? null,
    p.discountGroup ?? null,
    p.unit,
    p.packSize ?? null,
    p.stocked ?? null,
    p.listPriceOre ?? null,
    storedSource ? (p.discountPercent ?? null) : null,
    storedSource ? (p.netPriceOre ?? null) : null,
    storedSource,
    p.salesPriceOre ?? null,
    normalizeIdentifier(p.articleNumber),
    normalizeIdentifier(p.eNumber) || null,
    normalizeIdentifier(p.rskNumber) || null,
    normalizeIdentifier(p.gtin) || null,
    categoryKey(p.category) || null,
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
    ...opt("brand", strOrU(r.brand)),
    ...opt("imageUrl", strOrU(r.image_url)),
    ...opt("discountGroup", strOrU(r.discount_group)),
    unit: String(r.unit ?? "st"),
    ...opt("packSize", numOrU(r.pack_size)),
    ...opt("stocked", r.stocked == null ? undefined : Boolean(r.stocked)),
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

/** Postgres-arrayliteral för text[] – citerar varje element. */
function textArray(values: string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

const AGREEMENT_TERM_COLUMNS = [
  "id",
  "business_id",
  "connection_id",
  "agreement_id",
  "kind",
  "material_class",
  "material_class_text",
  "article_number",
  "article_key",
  "discount_tenths",
  "net_price_ore",
  "chain_discount_tenths",
  "end_date",
] as const;

function termToRow(t: WholesalerAgreementTerm, businessId: string): SqlParam[] {
  return [
    t.id,
    businessId,
    t.connectionId,
    t.agreementId,
    t.kind,
    t.kind === "class" ? materialClassKey(t.materialClass) : null,
    t.materialClassText ?? null,
    t.kind === "article" ? (t.articleNumber ?? null) : null,
    t.kind === "article" ? articleTermKey(t.articleNumber) || null : null,
    t.discountTenths ?? null,
    t.netPriceOre ?? null,
    t.chainDiscountTenths ?? null,
    t.endDate ?? null,
  ];
}

function dateOnlyOrU(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function termFromRow(r: SqlRow): WholesalerAgreementTerm {
  return {
    id: String(r.id),
    connectionId: String(r.connection_id),
    agreementId: String(r.agreement_id),
    kind: r.kind as WholesalerAgreementTerm["kind"],
    ...opt("materialClass", strOrU(r.material_class)),
    ...opt("materialClassText", strOrU(r.material_class_text)),
    ...opt("articleNumber", strOrU(r.article_number)),
    ...opt("discountTenths", numOrU(r.discount_tenths)),
    ...opt("netPriceOre", numOrU(r.net_price_ore)),
    ...opt("chainDiscountTenths", numOrU(r.chain_discount_tenths)),
    ...opt("endDate", dateOnlyOrU(r.end_date)),
  };
}

async function insertTermBatch(tx: SqlExecutor, businessId: string, batch: WholesalerAgreementTerm[]): Promise<void> {
  if (batch.length === 0) return;
  const cols = AGREEMENT_TERM_COLUMNS.length;
  const params: SqlParam[] = [];
  const tuples: string[] = [];
  batch.forEach((t, i) => {
    const row = termToRow(t, businessId);
    params.push(...row);
    tuples.push(`(${row.map((_, j) => `$${i * cols + j + 1}`).join(", ")})`);
  });
  await tx.query(
    `insert into public.wholesaler_agreement_terms (${AGREEMENT_TERM_COLUMNS.join(", ")})
     values ${tuples.join(",\n")}
     on conflict (id) do nothing`,
    params,
  );
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
    const wantedCategory = categoryKey(input.category);
    if (q.empty && !wantedCategory) return { rows: [], total: 0 };
    const limit = Math.max(1, Math.min(input.limit, CATALOG_SEARCH_MAX_PAGE_SIZE));
    const offset = Math.max(0, input.offset);

    // WHERE-parametrarna först (delas av count och select); rankningens
    // parametrar läggs efter så att count-frågan inte får oanvända $n.
    const params: SqlParam[] = [businessId, input.importId, input.connectionId];
    let scope = `business_id = $1 and import_id = $2 and connection_id = $3`;
    if (wantedCategory) {
      params.push(wantedCategory);
      scope += ` and category_key = $${params.length}`;
    }

    if (q.empty) {
      // Bläddra kategorin: inget att ranka – namnordning, som en hylla.
      return inTenantTx(businessId, async (tx) => {
        const countRows = await tx.query(`select count(*)::int as n from public.wholesaler_products where ${scope}`, params);
        const rows = await tx.query(
          `select * from public.wholesaler_products where ${scope}
            order by name_key, article_key limit ${limit} offset ${offset}`,
          params,
        );
        return { rows: rows.map(productFromRow), total: num(countRows[0]?.n) };
      });
    }

    const conditions: string[] = [];
    let prefixParam: string | undefined;

    const identifierSearch = q.identifier.length >= 3;
    if (identifierSearch) {
      params.push(`${likeEscape(q.identifier)}%`);
      prefixParam = `$${params.length}`;
      conditions.push(
        `(article_key like ${prefixParam} or e_key like ${prefixParam} or rsk_key like ${prefixParam} or gtin_key like ${prefixParam})`,
      );
    }
    if (q.tokens.length > 0) {
      const tokenConds = q.tokens.map((t) => {
        params.push(`%${likeEscape(t)}%`);
        return `search_text like $${params.length}`;
      });
      conditions.push(`(${tokenConds.join(" and ")})`);
    }
    if (conditions.length === 0) return { rows: [], total: 0 };
    const where = `${scope} and (${conditions.join(" or ")})`;

    const rankParams: SqlParam[] = [];
    let rankSql = "40";
    if (identifierSearch && prefixParam) {
      rankParams.push(q.identifier);
      const idParam = `$${params.length + rankParams.length}::text`;
      rankSql = `case
        when article_key = ${idParam} or e_key = ${idParam} or rsk_key = ${idParam} or gtin_key = ${idParam} then 100
        when article_key like ${prefixParam} or e_key like ${prefixParam} or rsk_key like ${prefixParam} or gtin_key like ${prefixParam} then 80
        else 0 end`;
    }
    if (q.tokens.length > 0) {
      rankParams.push(`${likeEscape(q.tokens.join(" "))}%`);
      const phraseParam = `$${params.length + rankParams.length}::text`;
      rankSql = `greatest(${rankSql}, case when name_key like ${phraseParam} then 60 else 40 end)`;
    }

    return inTenantTx(businessId, async (tx) => {
      const countRows = await tx.query(`select count(*)::int as n from public.wholesaler_products where ${where}`, params);
      const total = num(countRows[0]?.n);
      const rows = await tx.query(
        `select *, (${rankSql}) as rank
           from public.wholesaler_products
          where ${where}
          order by rank desc, name_key, article_key
          limit ${limit} offset ${offset}`,
        [...params, ...rankParams],
      );
      return { rows: rows.map(productFromRow), total };
    });
  }

  async categories(businessId: string, connectionId: string, importId: string): Promise<CatalogCategory[]> {
    const rows = await inTenantTx(businessId, (tx) =>
      tx.query(
        `select min(category) as name, count(*)::int as n
           from public.wholesaler_products
          where business_id = $1 and import_id = $2 and connection_id = $3 and category_key is not null
          group by category_key
          order by n desc, min(category)
          limit ${CATALOG_MAX_CATEGORIES}`,
        [businessId, importId, connectionId],
      ),
    );
    return rows.map((r) => ({ name: String(r.name ?? "").trim(), count: num(r.n) })).filter((c) => c.name);
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

  async listArticleClasses(businessId: string, importId: string): Promise<AgreementCoverageArticle[]> {
    const rows = await inTenantTx(businessId, (tx) =>
      tx.query(
        `select article_number, discount_group from public.wholesaler_products
          where business_id = $1 and import_id = $2`,
        [businessId, importId],
      ),
    );
    return rows.map((r) => ({
      articleNumber: String(r.article_number),
      ...opt("materialClass", strOrU(r.discount_group)),
    }));
  }

  async insertAgreementTerms(businessId: string, terms: WholesalerAgreementTerm[]): Promise<void> {
    if (terms.length === 0) return;
    await inTenantTx(businessId, async (tx) => {
      for (let i = 0; i < terms.length; i += INSERT_BATCH) {
        await insertTermBatch(tx, businessId, terms.slice(i, i + INSERT_BATCH));
      }
    });
  }

  async deleteAgreement(businessId: string, agreementId: string): Promise<void> {
    await inTenantTx(businessId, (tx) =>
      tx.query(`delete from public.wholesaler_agreement_terms where business_id = $1 and agreement_id = $2`, [
        businessId,
        agreementId,
      ]),
    );
  }

  async countAgreementTerms(businessId: string, agreementId: string): Promise<number> {
    const rows = await inTenantTx(businessId, (tx) =>
      tx.query(
        `select count(*)::int as n from public.wholesaler_agreement_terms where business_id = $1 and agreement_id = $2`,
        [businessId, agreementId],
      ),
    );
    return num(rows[0]?.n);
  }

  async agreementTermsFor(businessId: string, agreementId: string, keys: AgreementLookupKeys): Promise<WholesalerAgreementTerm[]> {
    const articleKeys = keys.articleKeys.filter(Boolean);
    const classKeys = keys.classKeys.filter(Boolean);
    if (articleKeys.length === 0 && classKeys.length === 0) return [];
    const rows = await inTenantTx(businessId, (tx) =>
      tx.query(
        `select * from public.wholesaler_agreement_terms
          where business_id = $1 and agreement_id = $2
            and ((kind = 'article' and article_key = any($3::text[]))
              or (kind = 'class' and material_class = any($4::text[])))`,
        [businessId, agreementId, textArray(articleKeys), textArray(classKeys)],
      ),
    );
    return rows.map(termFromRow);
  }

  async allAgreementTerms(businessId: string, agreementId: string): Promise<WholesalerAgreementTerm[]> {
    const rows = await inTenantTx(businessId, (tx) =>
      tx.query(`select * from public.wholesaler_agreement_terms where business_id = $1 and agreement_id = $2`, [
        businessId,
        agreementId,
      ]),
    );
    return rows.map(termFromRow);
  }

  async deleteBusiness(businessId: string): Promise<void> {
    await inTenantTx(businessId, async (tx) => {
      await tx.query(`delete from public.wholesaler_agreement_terms where business_id = $1`, [businessId]);
      await tx.query(`delete from public.wholesaler_products where business_id = $1`, [businessId]);
    });
  }
}

let sqlStore: SqlCatalogStore | undefined;

export function sqlCatalogStore(): WholesalerCatalogStore {
  return (sqlStore ??= new SqlCatalogStore());
}
