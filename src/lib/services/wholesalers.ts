/**
 * Grossistanslutningar, prisimporter och artikelsök (valfri funktion
 * `wholesalers`). Anslutningar/importer bor i tenantaggregatet; artiklarna i
 * katalogstoren (lib/wholesalers/catalog*). Alla läsningar/skrivningar sker
 * i tenantkontext (withBusiness/withBusinessRead) – business_id kommer
 * aldrig från klienten.
 */
import { db, save } from "../store";
import { uid } from "../ids";
import { isEmailFormat } from "../settings-validation";
import type {
  WholesalerColumnMapping,
  WholesalerConnection,
  WholesalerCustomerPriceRule,
  WholesalerDeliveryMode,
  WholesalerKey,
  WholesalerPriceFileKind,
  WholesalerPriceImport,
  WholesalerProduct,
} from "../types";
import { catalogStore, catalogStoreFor, currentBusinessId } from "../wholesalers/catalog";
import { CATALOG_SEARCH_PAGE_SIZE } from "../wholesalers/catalog-search";
import { connectionLabel, isDeliveryMode, isWholesalerKey, priceListIsStale } from "../wholesalers/labels";
import {
  buildProducts,
  parsePriceFile,
  previewImport,
  sanitizeMapping,
  type ImportPreview,
} from "../wholesalers/import-engine";
import { PriceFileError } from "../wholesalers/file-detect";
import { customerPriceForProduct, type CustomerPrice } from "../wholesalers/pricing";
import { logActivity } from "./activity";

export const MAX_PRODUCTS_PER_IMPORT = 50_000;

/* ------------------------------- anslutningar ------------------------------ */

export function wholesalerConnections(): WholesalerConnection[] {
  return db().wholesalerConnections ?? [];
}

export function getWholesalerConnection(id: string): WholesalerConnection | undefined {
  return wholesalerConnections().find((c) => c.id === id);
}

export function requireWholesalerConnection(id: string): WholesalerConnection {
  const c = getWholesalerConnection(id);
  if (!c) throw new Error("Grossistanslutningen finns inte.");
  return c;
}

/** Aktiva anslutningar i visningsordning (namn). */
export function activeWholesalerConnections(): WholesalerConnection[] {
  return wholesalerConnections()
    .filter((c) => c.active)
    .sort((a, b) => connectionLabel(a).localeCompare(connectionLabel(b), "sv"));
}

export interface WholesalerConnectionInput {
  wholesaler: WholesalerKey;
  displayName?: string;
  customerNumber: string;
  orderEmail: string;
  ccSelf?: boolean;
  defaultDeliveryMode: WholesalerDeliveryMode;
  defaultStore?: string;
  defaultDeliveryAddress?: string;
  contactPerson?: string;
  phone?: string;
  customerPriceRule: WholesalerCustomerPriceRule;
  active?: boolean;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function optionalText(value: unknown, max: number): string | undefined {
  const v = text(value, max);
  return v ? v : undefined;
}

export function normalizeCustomerPriceRule(raw: unknown): WholesalerCustomerPriceRule {
  if (!raw || typeof raw !== "object") return { kind: "later" };
  const r = raw as { kind?: unknown; percent?: unknown };
  if (r.kind === "file_sales_price") return { kind: "file_sales_price" };
  if (r.kind === "markup") {
    const percent = typeof r.percent === "number" ? r.percent : Number(String(r.percent ?? "").replace(",", "."));
    if (!Number.isFinite(percent) || percent < 0 || percent > 500) {
      throw new Error("Ange påslaget i procent (0–500).");
    }
    return { kind: "markup", percent: Math.round(percent * 100) / 100 };
  }
  return { kind: "later" };
}

/** Servern validerar allt – klientens formulär är bara hjälp. */
export function validateConnectionInput(raw: unknown): WholesalerConnectionInput {
  if (!raw || typeof raw !== "object") throw new Error("Ogiltiga uppgifter.");
  const r = raw as Record<string, unknown>;
  if (!isWholesalerKey(r.wholesaler)) throw new Error("Välj grossist.");
  const customerNumber = text(r.customerNumber, 40);
  if (!customerNumber) throw new Error("Ange ert kundnummer hos grossisten.");
  const orderEmail = text(r.orderEmail, 120).toLowerCase();
  if (!orderEmail || !isEmailFormat(orderEmail)) {
    throw new Error("Ange grossistens ordermejl eller er säljares e-postadress.");
  }
  const defaultDeliveryMode = isDeliveryMode(r.defaultDeliveryMode) ? r.defaultDeliveryMode : "pickup";
  const displayName = optionalText(r.displayName, 60);
  if (r.wholesaler === "other" && !displayName) throw new Error("Ange grossistens namn.");
  return {
    wholesaler: r.wholesaler,
    displayName,
    customerNumber,
    orderEmail,
    ccSelf: r.ccSelf === true,
    defaultDeliveryMode,
    defaultStore: optionalText(r.defaultStore, 120),
    defaultDeliveryAddress: optionalText(r.defaultDeliveryAddress, 200),
    contactPerson: optionalText(r.contactPerson, 80),
    phone: optionalText(r.phone, 40),
    customerPriceRule: normalizeCustomerPriceRule(r.customerPriceRule),
    active: r.active === undefined ? true : r.active === true,
  };
}

export function createWholesalerConnection(raw: unknown): WholesalerConnection {
  const input = validateConnectionInput(raw);
  const data = db();
  data.wholesalerConnections ??= [];
  const now = new Date().toISOString();
  const connection: WholesalerConnection = {
    id: uid(),
    wholesaler: input.wholesaler,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    customerNumber: input.customerNumber,
    orderEmail: input.orderEmail,
    ccSelf: input.ccSelf ?? false,
    defaultDeliveryMode: input.defaultDeliveryMode,
    ...(input.defaultStore ? { defaultStore: input.defaultStore } : {}),
    ...(input.defaultDeliveryAddress ? { defaultDeliveryAddress: input.defaultDeliveryAddress } : {}),
    ...(input.contactPerson ? { contactPerson: input.contactPerson } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
    customerPriceRule: input.customerPriceRule,
    active: input.active ?? true,
    createdAt: now,
    updatedAt: now,
  };
  data.wholesalerConnections.push(connection);
  logActivity(`Lade till grossisten ${connectionLabel(connection)}.`);
  save();
  return connection;
}

export function updateWholesalerConnection(id: string, raw: unknown): WholesalerConnection {
  const connection = requireWholesalerConnection(id);
  const input = validateConnectionInput({ ...connection, ...(raw as object) });
  connection.wholesaler = input.wholesaler;
  if (input.displayName) connection.displayName = input.displayName;
  else delete connection.displayName;
  connection.customerNumber = input.customerNumber;
  connection.orderEmail = input.orderEmail;
  connection.ccSelf = input.ccSelf ?? false;
  connection.defaultDeliveryMode = input.defaultDeliveryMode;
  if (input.defaultStore) connection.defaultStore = input.defaultStore;
  else delete connection.defaultStore;
  if (input.defaultDeliveryAddress) connection.defaultDeliveryAddress = input.defaultDeliveryAddress;
  else delete connection.defaultDeliveryAddress;
  if (input.contactPerson) connection.contactPerson = input.contactPerson;
  else delete connection.contactPerson;
  if (input.phone) connection.phone = input.phone;
  else delete connection.phone;
  connection.customerPriceRule = input.customerPriceRule;
  connection.active = input.active ?? connection.active;
  connection.updatedAt = new Date().toISOString();
  save();
  return connection;
}

/** Inaktivera/aktivera – rör aldrig prisfiler, artiklar eller order. */
export function setWholesalerConnectionActive(id: string, active: boolean): WholesalerConnection {
  const connection = requireWholesalerConnection(id);
  if (connection.active !== active) {
    connection.active = active;
    connection.updatedAt = new Date().toISOString();
    logActivity(`${active ? "Aktiverade" : "Inaktiverade"} grossisten ${connectionLabel(connection)}.`);
    save();
  }
  return connection;
}

/* --------------------------------- importer -------------------------------- */

export function priceImports(): WholesalerPriceImport[] {
  return db().wholesalerPriceImports ?? [];
}

export function priceImportsFor(connectionId: string): WholesalerPriceImport[] {
  return priceImports()
    .filter((i) => i.connectionId === connectionId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function activeImportFor(connection: WholesalerConnection): WholesalerPriceImport | undefined {
  if (!connection.activeImportId) return undefined;
  return priceImports().find((i) => i.id === connection.activeImportId && i.status === "active");
}

export interface WholesalerConnectionOverview {
  connection: WholesalerConnection;
  label: string;
  /** Aktiv prislista, om någon. */
  priceList: {
    importId: string;
    priceDate: string;
    productCount: number;
    stale: boolean;
    filename: string;
  } | null;
  /** Senaste importförsöket (lyckat eller misslyckat). */
  lastImport: WholesalerPriceImport | null;
  /** Rabattbrev finns men inget artikelregister. */
  discountsWithoutRegister: boolean;
}

export function connectionOverview(connection: WholesalerConnection, now = new Date()): WholesalerConnectionOverview {
  const active = activeImportFor(connection);
  const imports = priceImportsFor(connection.id);
  const lastImport = imports.find((i) => i.status !== "processing") ?? imports[0] ?? null;
  const hasDiscountLetter = Object.keys(connection.discountGroups ?? {}).length > 0;
  return {
    connection,
    label: connectionLabel(connection),
    priceList: active
      ? {
          importId: active.id,
          priceDate: active.priceDate,
          productCount: active.productCount,
          stale: priceListIsStale(active.priceDate, now),
          filename: active.filename,
        }
      : null,
    lastImport,
    discountsWithoutRegister: hasDiscountLetter && !active,
  };
}

export function listConnectionOverviews(now = new Date()): WholesalerConnectionOverview[] {
  return wholesalerConnections()
    .slice()
    .sort((a, b) => connectionLabel(a).localeCompare(connectionLabel(b), "sv"))
    .map((c) => connectionOverview(c, now));
}

/** Förhandsgranskning: tolka filen och föreslå mappning (sparad mappning först). */
export function previewPriceFile(input: {
  connectionId: string;
  filename: string;
  bytes: Buffer;
  mapping?: WholesalerColumnMapping;
}): ImportPreview {
  const connection = requireWholesalerConnection(input.connectionId);
  const parsed = parsePriceFile(input.bytes, input.filename);
  return previewImport(parsed, {
    remembered: connection.columnMapping,
    override: input.mapping ? sanitizeMapping(parsed.table, input.mapping) : undefined,
  });
}

/** Kör ett steg i egen tenantcommit (withBusiness i appen, direkt i tester). */
export type ImportRunner = <T>(fn: () => T | Promise<T>) => Promise<T>;

export type PriceImportOutcome =
  | { ok: true; importId: string; productCount: number; discountLetter: boolean; message: string }
  | { ok: false; error: string; importId?: string; errors?: WholesalerPriceImport["errors"] };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Atomisk import i tre steg: (1) importpost "processing" committas, (2)
 * artiklarna skrivs till katalogen under det nya import-id:t, (3) importen
 * aktiveras och den gamla markeras ersatt i en egen commit. Faller steg 2
 * eller 3 blir posten "failed" och den tidigare prislistan står orörd.
 */
export async function importPriceFile(
  input: {
    connectionId: string;
    filename: string;
    bytes: Buffer;
    mapping?: WholesalerColumnMapping;
  },
  run: ImportRunner,
): Promise<PriceImportOutcome> {
  let parsed;
  try {
    parsed = parsePriceFile(input.bytes, input.filename);
  } catch (e) {
    return { ok: false, error: e instanceof PriceFileError ? e.message : "Filen kunde inte läsas." };
  }

  type Prepared =
    | { kind: "problems"; problems: string[] }
    | { kind: "failed"; failed: string; importId: string; errors: WholesalerPriceImport["errors"] }
    | { kind: "discount_letter"; importId: string; groups: number }
    | {
        kind: "ready";
        importId: string;
        businessId: string;
        products: WholesalerProduct[];
        discountGroups: Record<string, number>;
        mapping: WholesalerColumnMapping;
      };

  const prepared = await run((): Prepared => {
    const connection = requireWholesalerConnection(input.connectionId);
    const preview = previewImport(parsed, {
      remembered: connection.columnMapping,
      override: input.mapping ? sanitizeMapping(parsed.table, input.mapping) : undefined,
    });
    if (preview.problems.length > 0) {
      return { kind: "problems", problems: preview.problems };
    }
    const importId = uid();
    const result = buildProducts(parsed.table, preview.mapping, {
      connectionId: connection.id,
      importId,
      discountGroups: connection.discountGroups,
    });
    const now = new Date().toISOString();
    const record: WholesalerPriceImport = {
      id: importId,
      connectionId: connection.id,
      filename: input.filename.slice(0, 160),
      fileKind: parsed.detected.kind as WholesalerPriceFileKind,
      status: "processing",
      mapping: preview.mapping,
      rowCount: result.rowCount,
      productCount: result.products.length,
      skippedCount: result.skippedCount,
      errors: result.errors,
      hasArticleRegister: result.hasArticleRegister,
      hasDiscounts: result.hasDiscounts,
      discountGroupCount: result.discountGroupCount,
      priceDate: todayISO(),
      createdAt: now,
    };
    const data = db();
    data.wholesalerPriceImports ??= [];

    if (preview.discountLetter) {
      // Rabattbrev: spara grupperna på anslutningen och markera importen
      // klar utan artiklar. Prislistan (om någon) fortsätter gälla.
      connection.discountGroups = { ...(connection.discountGroups ?? {}), ...result.discountGroups };
      connection.columnMapping = preview.mapping;
      connection.updatedAt = now;
      record.status = "superseded";
      record.completedAt = now;
      data.wholesalerPriceImports.push(record);
      save();
      return { kind: "discount_letter", importId, groups: result.discountGroupCount };
    }

    if (result.products.length === 0) {
      record.status = "failed";
      record.failedReason = "Inga artiklar kunde läsas ur filen.";
      record.completedAt = now;
      data.wholesalerPriceImports.push(record);
      save();
      return { kind: "failed", failed: record.failedReason, importId, errors: record.errors };
    }
    if (result.products.length > MAX_PRODUCTS_PER_IMPORT) {
      record.status = "failed";
      record.failedReason = `Filen innehåller fler än ${MAX_PRODUCTS_PER_IMPORT.toLocaleString("sv-SE")} artiklar. Exportera ett urval, t.ex. ert avtalssortiment.`;
      record.completedAt = now;
      data.wholesalerPriceImports.push(record);
      save();
      return { kind: "failed", failed: record.failedReason, importId, errors: record.errors };
    }
    data.wholesalerPriceImports.push(record);
    save();
    return {
      kind: "ready",
      importId,
      businessId: currentBusinessId(),
      products: result.products,
      discountGroups: result.discountGroups,
      mapping: preview.mapping,
    };
  });

  if (prepared.kind === "problems") return { ok: false, error: prepared.problems.join(" ") };
  if (prepared.kind === "failed") {
    return { ok: false, error: prepared.failed, importId: prepared.importId, errors: prepared.errors };
  }
  if (prepared.kind === "discount_letter") {
    return {
      ok: true,
      importId: prepared.importId,
      productCount: 0,
      discountLetter: true,
      message:
        prepared.groups === 1
          ? "1 rabattgrupp sparades. Vi hittade rabatter men saknar artikelregistret. Ladda även upp grossistens artikel- eller prislista."
          : `${prepared.groups.toLocaleString("sv-SE")} rabattgrupper sparades. Vi hittade rabatter men saknar artikelregistret. Ladda även upp grossistens artikel- eller prislista.`,
    };
  }

  const { importId, businessId, products } = prepared;
  try {
    const store = await catalogStoreFor(businessId);
    await store.insertProducts(businessId, products);
    const count = await store.countImport(businessId, importId);
    if (count !== products.length) {
      throw new Error(`Bara ${count} av ${products.length} artiklar kunde sparas.`);
    }
  } catch (e) {
    const reason = "Artiklarna kunde inte sparas. Den tidigare prislistan gäller fortfarande.";
    await run(() => {
      const record = priceImports().find((i) => i.id === importId);
      if (record) {
        record.status = "failed";
        record.failedReason = reason;
        record.completedAt = new Date().toISOString();
        save();
      }
    });
    try {
      const store = await catalogStoreFor(businessId);
      await store.deleteImport(businessId, importId);
    } catch {
      // Städning är bäst-ansträngning – posten är redan markerad misslyckad.
    }
    return {
      ok: false,
      error: `${reason} ${e instanceof Error && /Bara \d+ av/.test(e.message) ? e.message : ""}`.trim(),
      importId,
    };
  }

  const activated = await run(() => {
    const connection = requireWholesalerConnection(input.connectionId);
    const record = priceImports().find((i) => i.id === importId);
    if (!record) throw new Error("Importen försvann under körningen.");
    const now = new Date().toISOString();
    const previousId = connection.activeImportId;
    for (const other of priceImports()) {
      if (other.connectionId === connection.id && other.id !== importId && other.status === "active") {
        other.status = "superseded";
      }
    }
    record.status = "active";
    record.completedAt = now;
    connection.activeImportId = importId;
    connection.columnMapping = prepared.mapping;
    if (Object.keys(prepared.discountGroups).length > 0) {
      connection.discountGroups = { ...(connection.discountGroups ?? {}), ...prepared.discountGroups };
    }
    connection.updatedAt = now;
    logActivity(
      `Uppdaterade prislistan för ${connectionLabel(connection)} (${record.productCount.toLocaleString("sv-SE")} artiklar).`,
    );
    save();
    return { previousId, productCount: record.productCount };
  });

  if (activated.previousId && activated.previousId !== importId) {
    try {
      const store = await catalogStoreFor(businessId);
      await store.deleteImport(businessId, activated.previousId);
    } catch {
      // Gamla artiklar städas vid nästa import om det misslyckas – de är
      // ändå inte sökbara (fel import-id).
    }
  }

  return {
    ok: true,
    importId,
    productCount: activated.productCount,
    discountLetter: false,
    message: `${activated.productCount.toLocaleString("sv-SE")} artiklar importerades.`,
  };
}

/* ------------------------------------ sök ---------------------------------- */

export interface WholesalerSearchRow {
  productId: string;
  articleNumber: string;
  name: string;
  eNumber?: string;
  rskNumber?: string;
  unit: string;
  packSize?: number;
  /** Eget inköpspris per enhet i ören, om känt. */
  netPriceOre?: number;
  listPriceOre?: number;
  customerPrice: CustomerPrice;
}

export interface WholesalerSearchResult {
  rows: WholesalerSearchRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Prislistans datum – visas när priset kan vara gammalt. */
  priceDate: string | null;
  stale: boolean;
}

export function toSearchRow(product: WholesalerProduct, rule: WholesalerCustomerPriceRule): WholesalerSearchRow {
  return {
    productId: product.id,
    articleNumber: product.articleNumber,
    name: product.name,
    ...(product.eNumber ? { eNumber: product.eNumber } : {}),
    ...(product.rskNumber ? { rskNumber: product.rskNumber } : {}),
    unit: product.unit,
    ...(product.packSize != null ? { packSize: product.packSize } : {}),
    ...(product.netPriceOre != null ? { netPriceOre: product.netPriceOre } : {}),
    ...(product.listPriceOre != null ? { listPriceOre: product.listPriceOre } : {}),
    customerPrice: customerPriceForProduct(product, rule),
  };
}

export async function searchWholesalerProducts(input: {
  connectionId: string;
  query: string;
  page?: number;
}): Promise<WholesalerSearchResult> {
  const connection = requireWholesalerConnection(input.connectionId);
  const active = activeImportFor(connection);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = CATALOG_SEARCH_PAGE_SIZE;
  if (!active) return { rows: [], total: 0, page, pageSize, priceDate: null, stale: false };
  const { businessId, store } = await catalogStore();
  const result = await store.search(businessId, {
    connectionId: connection.id,
    importId: active.id,
    query: input.query.slice(0, 120),
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return {
    rows: result.rows.map((p) => toSearchRow(p, connection.customerPriceRule)),
    total: result.total,
    page,
    pageSize,
    priceDate: active.priceDate,
    stale: priceListIsStale(active.priceDate),
  };
}

/** Artiklar per id ur den aktiva prislistan (varukorgens tillägg). */
export async function catalogProductsByIds(connectionId: string, ids: string[]): Promise<WholesalerProduct[]> {
  const connection = requireWholesalerConnection(connectionId);
  const active = activeImportFor(connection);
  if (!active || ids.length === 0) return [];
  const { businessId, store } = await catalogStore();
  return store.getByIds(businessId, active.id, ids);
}

/** Artiklar per artikelnummer ur den aktiva prislistan (bekräftelsematchning). */
export async function catalogProductsByArticleNumbers(
  connectionId: string,
  articleNumbers: string[],
): Promise<WholesalerProduct[]> {
  const connection = requireWholesalerConnection(connectionId);
  const active = activeImportFor(connection);
  if (!active || articleNumbers.length === 0) return [];
  const { businessId, store } = await catalogStore();
  return store.findByArticleNumbers(businessId, active.id, articleNumbers);
}
