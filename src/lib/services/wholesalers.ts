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
  WholesalerAgreementCoverage,
  WholesalerAgreementTerm,
  WholesalerColumnMapping,
  WholesalerConnection,
  WholesalerCustomerPriceRule,
  WholesalerDeliveryMode,
  WholesalerDiscountAgreement,
  WholesalerKey,
  WholesalerPriceFileKind,
  WholesalerPriceImport,
  WholesalerProduct,
} from "../types";
import { catalogStore, catalogStoreFor, currentBusinessId } from "../wholesalers/catalog";
import type { WholesalerCatalogStore } from "../wholesalers/catalog-store";
import { CATALOG_SEARCH_PAGE_SIZE, normalizeIdentifier, type CatalogCategory } from "../wholesalers/catalog-search";
import { connectionLabel, isDeliveryMode, isWholesalerKey, priceListIsStale } from "../wholesalers/labels";
import {
  buildPriceListProducts,
  buildProducts,
  parsePriceFile,
  previewImport,
  sanitizeMapping,
  type ImportPreview,
  type KnownFormatFile,
  type PreviewContext,
} from "../wholesalers/import-engine";
import type { ParsedDiscountAgreement } from "../wholesalers/formats/types";
import { PriceFileError } from "../wholesalers/file-detect";
import { customerPriceForProduct, type CustomerPrice } from "../wholesalers/pricing";
import {
  agreementCoverage,
  agreementExpired,
  agreementLookupKeys,
  applyAgreementToProducts,
  indexAgreementTerms,
} from "../wholesalers/agreement-pricing";
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
  /** Rabattavtal i grossistens format (t.ex. Ahlsell avtalsfil), om något. */
  agreement: WholesalerAgreementOverview | null;
}

export interface WholesalerAgreementOverview extends WholesalerDiscountAgreement {
  /** Slutdatumet har passerat. Visas – blockerar aldrig. */
  expired: boolean;
  /** Avtal utan aktiv prislista: inga priser kan räknas förrän prisfilen laddats upp. */
  priceListMissing: boolean;
  /** Kundnumret i avtalet skiljer sig från anslutningens. */
  customerNumberMismatch: boolean;
  /** Täckningen gäller den aktiva prislistan (annars är den inaktuell). */
  coverageCurrent: boolean;
}

function agreementOverview(
  connection: WholesalerConnection,
  active: WholesalerPriceImport | undefined,
  now: Date,
): WholesalerAgreementOverview | null {
  const agreement = connection.discountAgreement;
  if (!agreement) return null;
  const connectionNumber = connection.customerNumber.replace(/\D/g, "");
  return {
    ...agreement,
    expired: agreementExpired(agreement.endDate, now),
    priceListMissing: !active,
    customerNumberMismatch: Boolean(connectionNumber) && connectionNumber !== agreement.customerNumber,
    coverageCurrent: Boolean(active && agreement.coverage && agreement.coverage.importId === active.id),
  };
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
    agreement: agreementOverview(connection, active, now),
  };
}

function previewContextFor(connection: WholesalerConnection): PreviewContext {
  return {
    customerNumber: connection.customerNumber,
    hasActivePriceList: Boolean(activeImportFor(connection)),
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
    context: previewContextFor(connection),
  });
}

/** Kör ett steg i egen tenantcommit (withBusiness i appen, direkt i tester). */
export type ImportRunner = <T>(fn: () => T | Promise<T>) => Promise<T>;

export type PriceImportOutcome =
  | {
      ok: true;
      importId: string;
      productCount: number;
      discountLetter: boolean;
      message: string;
      /** Filen var ett rabattavtal i grossistens format – huvudet som sparades. */
      agreement?: WholesalerDiscountAgreement;
      /** Varningar som inte stoppade importen (visas, blockerar inte). */
      warnings?: string[];
    }
  | { ok: false; error: string; importId?: string; errors?: WholesalerPriceImport["errors"] };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function sv(n: number): string {
  return n.toLocaleString("sv-SE");
}

/**
 * Täckningen: hur många artiklar i prislistan får ingen rabatt ur avtalet.
 * Räknas om vid varje import av endera filen – siffran avslöjar fel avtalsfil.
 */
function coverageSnapshot(
  importId: string,
  articles: Array<{ articleNumber: string; materialClass?: string }>,
  terms: WholesalerAgreementTerm[],
): WholesalerAgreementCoverage {
  const result = agreementCoverage(articles, indexAgreementTerms(terms));
  return { importId, ...result, computedAt: new Date().toISOString() };
}

/** Villkor ur avtalsfilen → lagringsrader i katalogstoren. */
function agreementTermsFrom(
  file: ParsedDiscountAgreement,
  ctx: { connectionId: string; agreementId: string },
): WholesalerAgreementTerm[] {
  const terms: WholesalerAgreementTerm[] = [];
  for (const c of file.classDiscounts) {
    terms.push({
      id: uid(),
      connectionId: ctx.connectionId,
      agreementId: ctx.agreementId,
      kind: "class",
      materialClass: c.materialClass,
      materialClassText: c.text || undefined,
      discountTenths: c.discountTenths,
      ...(c.chainDiscountTenths != null ? { chainDiscountTenths: c.chainDiscountTenths } : {}),
      ...(c.endDate ? { endDate: c.endDate } : {}),
    });
  }
  for (const a of file.articleTerms) {
    terms.push({
      id: uid(),
      connectionId: ctx.connectionId,
      agreementId: ctx.agreementId,
      kind: "article",
      articleNumber: a.articleNumber,
      ...(a.specDiscountTenths != null ? { discountTenths: a.specDiscountTenths } : {}),
      ...(a.netPriceOre != null ? { netPriceOre: a.netPriceOre } : {}),
      ...(a.chainDiscountTenths != null ? { chainDiscountTenths: a.chainDiscountTenths } : {}),
      ...(a.endDate ? { endDate: a.endDate } : {}),
    });
  }
  return terms;
}

/**
 * Rabattavtal i grossistens format (Ahlsell avtalsfil). Samma tre steg som
 * prislistan: (1) importpost "processing", (2) villkoren skrivs till
 * katalogstoren under ett nytt avtals-id, (3) huvudet byts på anslutningen i
 * en egen commit och det gamla avtalets villkor städas. Prislistan rörs inte.
 */
async function importDiscountAgreement(
  known: KnownFormatFile,
  file: ParsedDiscountAgreement,
  input: { connectionId: string; filename: string },
  run: ImportRunner,
): Promise<PriceImportOutcome> {
  type Prepared =
    | { kind: "wrong_wholesaler"; error: string }
    | {
        kind: "ok";
        importId: string;
        agreementId: string;
        businessId: string;
        connectionId: string;
        previousAgreementId?: string;
        activeImportId?: string;
      };

  const prepared = await run((): Prepared => {
    const connection = requireWholesalerConnection(input.connectionId);
    if (known.parser.wholesaler !== connection.wholesaler && connection.wholesaler !== "other") {
      return {
        kind: "wrong_wholesaler",
        error: `Filen är en ${known.parser.label} men anslutningen gäller ${connectionLabel(connection)}. Ladda upp den på rätt grossist.`,
      };
    }
    const importId = uid();
    const agreementId = uid();
    const now = new Date().toISOString();
    const record: WholesalerPriceImport = {
      id: importId,
      connectionId: connection.id,
      filename: input.filename.slice(0, 160),
      fileKind: "txt",
      format: known.parser.id,
      status: "processing",
      mapping: {},
      rowCount: file.rowCount,
      productCount: 0,
      skippedCount: 0,
      errors: [],
      hasArticleRegister: false,
      hasDiscounts: true,
      discountGroupCount: file.classDiscounts.length,
      priceDate: file.header.runDate ?? todayISO(),
      createdAt: now,
    };
    const data = db();
    data.wholesalerPriceImports ??= [];
    data.wholesalerPriceImports.push(record);
    save();
    const active = activeImportFor(connection);
    return {
      kind: "ok",
      importId,
      agreementId,
      businessId: currentBusinessId(),
      connectionId: connection.id,
      previousAgreementId: connection.discountAgreement?.id,
      activeImportId: active?.id,
    };
  });
  if (prepared.kind === "wrong_wholesaler") return { ok: false, error: prepared.error };

  const terms = agreementTermsFrom(file, { connectionId: prepared.connectionId, agreementId: prepared.agreementId });
  const { businessId, importId, agreementId } = prepared;

  const failImport = async (reason: string): Promise<PriceImportOutcome> => {
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
      await store.deleteAgreement(businessId, agreementId);
    } catch {
      // Städning är bäst-ansträngning – posten är redan markerad misslyckad.
    }
    return { ok: false, error: reason, importId };
  };

  let coverage: WholesalerAgreementCoverage | undefined;
  try {
    const store = await catalogStoreFor(businessId);
    await store.insertAgreementTerms(businessId, terms);
    const count = await store.countAgreementTerms(businessId, agreementId);
    if (count !== terms.length) {
      throw new Error(`Bara ${count} av ${terms.length} villkor kunde sparas.`);
    }
    if (prepared.activeImportId) {
      try {
        const articles = await store.listArticleClasses(businessId, prepared.activeImportId);
        coverage = coverageSnapshot(prepared.activeImportId, articles, terms);
      } catch {
        coverage = undefined;
      }
    }
  } catch (e) {
    const detail = e instanceof Error && /Bara \d+ av/.test(e.message) ? ` ${e.message}` : "";
    return failImport(`Rabattavtalet kunde inte sparas. Det tidigare avtalet gäller fortfarande.${detail}`);
  }

  const now = new Date().toISOString();
  const agreement: WholesalerDiscountAgreement = {
    id: agreementId,
    format: known.parser.id,
    filename: input.filename.slice(0, 160),
    importId,
    agreementType: file.header.agreementType,
    customerNumber: file.header.customerNumber,
    facilityNumber: file.header.facilityNumber,
    name: file.header.name,
    chainDiscountCode: file.header.chainDiscount,
    ...(file.header.runDate ? { runDate: file.header.runDate } : {}),
    ...(file.endDate ? { endDate: file.endDate } : {}),
    classDiscountCount: file.classDiscounts.length,
    articleTermCount: file.articleTerms.length,
    specDiscountCount: file.articleTerms.filter((t) => t.specDiscountTenths != null).length,
    netPriceCount: file.articleTerms.filter((t) => t.netPriceOre != null).length,
    chainDiscountRows: file.chainDiscountRows,
    importedAt: now,
    ...(coverage ? { coverage } : {}),
  };

  await run(() => {
    const connection = requireWholesalerConnection(input.connectionId);
    const record = priceImports().find((i) => i.id === importId);
    if (!record) throw new Error("Importen försvann under körningen.");
    record.status = "superseded";
    record.completedAt = now;
    connection.discountAgreement = agreement;
    connection.updatedAt = now;
    logActivity(
      `Läste in rabattavtalet ${agreement.name || agreement.customerNumber} för ${connectionLabel(connection)} (${sv(agreement.classDiscountCount)} materialklasser, ${sv(agreement.articleTermCount)} artikelvillkor).`,
    );
    save();
  });

  if (prepared.previousAgreementId && prepared.previousAgreementId !== agreementId) {
    try {
      const store = await catalogStoreFor(businessId);
      await store.deleteAgreement(businessId, prepared.previousAgreementId);
    } catch {
      // Gamla villkor städas vid nästa import om det misslyckas – de är ändå
      // inte nåbara (fel avtals-id).
    }
  }

  const warnings = [...file.warnings];
  if (file.chainDiscountRows > 0) {
    warnings.push(
      `${sv(file.chainDiscountRows)} rader har kedjerabattkod J. Kedjerabatt lagras men räknas inte – kontrollera priserna mot Ahlsell.`,
    );
  }
  if (file.header.chainDiscount === "J") {
    warnings.push("Avtalet har kedjerabatt (J) i huvudet. Kedjerabatt räknas inte i Driva – priserna kan avvika.");
  }
  const parts = [
    `Rabattavtalet ${agreement.name ? `${agreement.name} ` : ""}(kundnummer ${agreement.customerNumber}) lästes in: ${sv(agreement.classDiscountCount)} materialklasser och ${sv(agreement.articleTermCount)} artikelvillkor.`,
  ];
  if (!prepared.activeImportId) {
    parts.push("Prislistan saknas ännu – ladda även upp grossistens prisfil så att priserna kan räknas.");
  } else if (coverage) {
    parts.push(
      coverage.withoutTermsCount === 0
        ? `Alla ${sv(coverage.articleCount)} artiklar i prislistan träffas av avtalet.`
        : `${sv(coverage.withoutTermsCount)} av ${sv(coverage.articleCount)} artiklar i prislistan saknar rabatt i avtalet.`,
    );
  }
  return {
    ok: true,
    importId,
    productCount: 0,
    discountLetter: true,
    agreement,
    message: parts.join(" "),
    ...(warnings.length ? { warnings } : {}),
  };
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

  // Känt grossistformat: rabattavtalet har sitt eget flöde (villkoren bor
  // separat från prislistan); prislistan går genom samma tre steg som en
  // mappad fil, men utan kolumnmappning.
  const known = parsed.known;
  if (known && known.file.kind === "discount_agreement") {
    return importDiscountAgreement(known, known.file, input, run);
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
        knownFormat: boolean;
        agreementId?: string;
      };

  const prepared = await run((): Prepared => {
    const connection = requireWholesalerConnection(input.connectionId);
    if (known && known.parser.wholesaler !== connection.wholesaler && connection.wholesaler !== "other") {
      return {
        kind: "problems",
        problems: [
          `Filen är en ${known.parser.label} men anslutningen gäller ${connectionLabel(connection)}. Ladda upp den på rätt grossist.`,
        ],
      };
    }
    const preview = previewImport(parsed, {
      remembered: connection.columnMapping,
      override: input.mapping ? sanitizeMapping(parsed.table, input.mapping) : undefined,
      context: previewContextFor(connection),
    });
    if (preview.problems.length > 0) {
      return { kind: "problems", problems: preview.problems };
    }
    const importId = uid();
    const result =
      known && known.file.kind === "price_list"
        ? buildPriceListProducts(known.file, { connectionId: connection.id, importId })
        : buildProducts(parsed.table, preview.mapping, {
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
      ...(known ? { format: known.parser.id } : {}),
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
      knownFormat: Boolean(known),
      agreementId: connection.discountAgreement?.id,
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
  let coverage: WholesalerAgreementCoverage | undefined;
  try {
    const store = await catalogStoreFor(businessId);
    await store.insertProducts(businessId, products);
    const count = await store.countImport(businessId, importId);
    if (count !== products.length) {
      throw new Error(`Bara ${count} av ${products.length} artiklar kunde sparas.`);
    }
    if (prepared.agreementId) {
      // Ny prislista → räkna om avtalets täckning mot den (bäst-ansträngning).
      try {
        const terms = await store.allAgreementTerms(businessId, prepared.agreementId);
        coverage = coverageSnapshot(
          importId,
          products.map((p) => ({ articleNumber: p.articleNumber, materialClass: p.discountGroup })),
          terms,
        );
      } catch {
        coverage = undefined;
      }
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
    // Ett känt format har ingen kolumnmappning – rör inte den sparade.
    if (!prepared.knownFormat) connection.columnMapping = prepared.mapping;
    if (Object.keys(prepared.discountGroups).length > 0) {
      connection.discountGroups = { ...(connection.discountGroups ?? {}), ...prepared.discountGroups };
    }
    if (coverage && connection.discountAgreement && connection.discountAgreement.id === prepared.agreementId) {
      connection.discountAgreement = { ...connection.discountAgreement, coverage };
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

  const messageParts = [`${sv(activated.productCount)} artiklar importerades.`];
  if (coverage) {
    messageParts.push(
      coverage.withoutTermsCount === 0
        ? "Alla artiklar träffas av rabattavtalet."
        : `${sv(coverage.withoutTermsCount)} av ${sv(coverage.articleCount)} artiklar saknar rabatt i avtalet.`,
    );
  }
  return {
    ok: true,
    importId,
    productCount: activated.productCount,
    discountLetter: false,
    message: messageParts.join(" "),
  };
}

/* ------------------------------------ sök ---------------------------------- */

export interface WholesalerSearchRow {
  productId: string;
  articleNumber: string;
  name: string;
  eNumber?: string;
  rskNumber?: string;
  gtin?: string;
  category?: string;
  brand?: string;
  imageUrl?: string;
  unit: string;
  packSize?: number;
  /** Lagerförd hos grossisten (prisfilen). */
  stocked?: boolean;
  /** Materialklass/rabattgrupp i prislistan. */
  discountGroup?: string;
  /** Eget inköpspris per enhet i ören, om känt. */
  netPriceOre?: number;
  listPriceOre?: number;
  /** Hur inköpspriset räknats fram: listpris, regel, materialklass, avtal, datum. */
  priceExplanation?: string;
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
    ...(product.gtin ? { gtin: product.gtin } : {}),
    ...(product.category ? { category: product.category } : {}),
    ...(product.brand ? { brand: product.brand } : {}),
    ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
    unit: product.unit,
    ...(product.packSize != null ? { packSize: product.packSize } : {}),
    ...(product.stocked != null ? { stocked: product.stocked } : {}),
    ...(product.discountGroup ? { discountGroup: product.discountGroup } : {}),
    ...(product.netPriceOre != null ? { netPriceOre: product.netPriceOre } : {}),
    ...(product.listPriceOre != null ? { listPriceOre: product.listPriceOre } : {}),
    ...(product.priceExplanation ? { priceExplanation: product.priceExplanation.text } : {}),
    customerPrice: customerPriceForProduct(product, rule),
  };
}

/**
 * Slå ihop artiklarna med rabattavtalet – ENDA stället där avtalspriset
 * räknas. Alla läsningar ur katalogen går via den här funktionen så att
 * sök, favoriter, varukorg och bekräftelsematchning ser samma pris.
 */
async function withAgreementPrices(
  connection: WholesalerConnection,
  businessId: string,
  store: WholesalerCatalogStore,
  products: WholesalerProduct[],
): Promise<WholesalerProduct[]> {
  if (products.length === 0) return products;
  const agreement = connection.discountAgreement;
  if (!agreement) return applyAgreementToProducts(products, undefined, undefined);
  const terms = await store.agreementTermsFor(businessId, agreement.id, agreementLookupKeys(products));
  return applyAgreementToProducts(products, agreement, indexAgreementTerms(terms));
}

/**
 * Sök – eller bläddra en kategori när frågan är tom. Kategorin är grossistens
 * eget namn ur wholesalerCategories(); okänd kategori ger noll träffar.
 */
export async function searchWholesalerProducts(input: {
  connectionId: string;
  query: string;
  category?: string;
  page?: number;
}): Promise<WholesalerSearchResult> {
  const connection = requireWholesalerConnection(input.connectionId);
  const active = activeImportFor(connection);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = CATALOG_SEARCH_PAGE_SIZE;
  if (!active) return { rows: [], total: 0, page, pageSize, priceDate: null, stale: false };
  const { businessId, store } = await catalogStore();
  const category = typeof input.category === "string" ? input.category.trim().slice(0, 80) : "";
  const result = await store.search(businessId, {
    connectionId: connection.id,
    importId: active.id,
    query: input.query.slice(0, 120),
    ...(category ? { category } : {}),
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const priced = await withAgreementPrices(connection, businessId, store, result.rows);
  return {
    rows: priced.map((p) => toSearchRow(p, connection.customerPriceRule)),
    total: result.total,
    page,
    pageSize,
    priceDate: active.priceDate,
    stale: priceListIsStale(active.priceDate),
  };
}

/* ---------------------------------- butiken -------------------------------- */

export const SHOP_RECENT_LIMIT = 12;
export const MAX_FAVORITE_ARTICLES = 200;

export interface WholesalerShopContext {
  categories: CatalogCategory[];
  /** Favoritartiklar som finns i den aktiva prislistan, i favoritordning (senast tillagd först). */
  favorites: WholesalerSearchRow[];
  favoriteArticleNumbers: string[];
  /** Artiklar från tidigare skickade beställningar hos grossisten, senast först. */
  recent: WholesalerSearchRow[];
}

export async function wholesalerCategories(connectionId: string): Promise<CatalogCategory[]> {
  const connection = requireWholesalerConnection(connectionId);
  const active = activeImportFor(connection);
  if (!active) return [];
  const { businessId, store } = await catalogStore();
  return store.categories(businessId, connection.id, active.id);
}

/**
 * Artikelnummer ur tidigare skickade beställningar hos grossisten (alla
 * uppdrag), senast beställd först. Varukorgar och avbrutna order räknas inte –
 * "beställt tidigare" ska betyda att det faktiskt gick iväg.
 */
export function recentlyOrderedArticleNumbers(connectionId: string, limit = SHOP_RECENT_LIMIT): string[] {
  const data = db();
  const orders = (data.purchaseOrders ?? [])
    .filter((o) => o.connectionId === connectionId && o.status !== "draft" && o.status !== "cancelled" && o.sentAt)
    .sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));
  if (orders.length === 0) return [];
  const orderRank = new Map(orders.map((o, i) => [o.id, i] as const));
  const seen = new Set<string>();
  const out: string[] = [];
  const lines = (data.purchaseOrderLines ?? [])
    .filter((l) => orderRank.has(l.orderId) && l.articleNumber && !l.isFreeText)
    .sort((a, b) => (orderRank.get(a.orderId) ?? 0) - (orderRank.get(b.orderId) ?? 0) || a.position - b.position);
  for (const line of lines) {
    const key = normalizeIdentifier(line.articleNumber);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line.articleNumber!);
    if (out.length >= limit) break;
  }
  return out;
}

/** Ordna produkter i samma ordning som artikelnumren de slogs upp med. */
function inArticleOrder(products: WholesalerProduct[], articleNumbers: string[]): WholesalerProduct[] {
  const byKey = new Map(products.map((p) => [normalizeIdentifier(p.articleNumber), p] as const));
  const out: WholesalerProduct[] = [];
  for (const n of articleNumbers) {
    const p = byKey.get(normalizeIdentifier(n));
    if (p) out.push(p);
  }
  return out;
}

export async function wholesalerShopContext(connectionId: string): Promise<WholesalerShopContext> {
  const connection = requireWholesalerConnection(connectionId);
  const favoriteArticleNumbers = connection.favoriteArticleNumbers ?? [];
  const active = activeImportFor(connection);
  if (!active) return { categories: [], favorites: [], favoriteArticleNumbers, recent: [] };
  const { businessId, store } = await catalogStore();
  const recentNumbers = recentlyOrderedArticleNumbers(connection.id);
  const [categories, favoriteRaw, recentRaw] = await Promise.all([
    store.categories(businessId, connection.id, active.id),
    favoriteArticleNumbers.length ? store.findByArticleNumbers(businessId, active.id, favoriteArticleNumbers) : [],
    recentNumbers.length ? store.findByArticleNumbers(businessId, active.id, recentNumbers) : [],
  ]);
  const [favoriteProducts, recentProducts] = await Promise.all([
    withAgreementPrices(connection, businessId, store, favoriteRaw),
    withAgreementPrices(connection, businessId, store, recentRaw),
  ]);
  const rule = connection.customerPriceRule;
  return {
    categories,
    favorites: inArticleOrder(favoriteProducts, favoriteArticleNumbers).map((p) => toSearchRow(p, rule)),
    favoriteArticleNumbers,
    recent: inArticleOrder(recentProducts, recentNumbers).map((p) => toSearchRow(p, rule)),
  };
}

/**
 * Växla favorit. Nycklad på artikelnummer så att favoriten överlever nästa
 * prisimport. Senast tillagd först; listan är begränsad så att aggregatet
 * inte växer okontrollerat.
 */
export function toggleFavoriteArticle(connectionId: string, articleNumber: string): { favorite: boolean } {
  const connection = requireWholesalerConnection(connectionId);
  const value = text(articleNumber, 64);
  if (!value) throw new Error("Artikelnummer saknas.");
  const key = normalizeIdentifier(value);
  const current = connection.favoriteArticleNumbers ?? [];
  const without = current.filter((n) => normalizeIdentifier(n) !== key);
  const favorite = without.length === current.length;
  connection.favoriteArticleNumbers = favorite ? [value, ...without].slice(0, MAX_FAVORITE_ARTICLES) : without;
  if (connection.favoriteArticleNumbers.length === 0) delete connection.favoriteArticleNumbers;
  connection.updatedAt = new Date().toISOString();
  save();
  return { favorite };
}

/** Artiklar per id ur den aktiva prislistan (varukorgens tillägg). */
export async function catalogProductsByIds(connectionId: string, ids: string[]): Promise<WholesalerProduct[]> {
  const connection = requireWholesalerConnection(connectionId);
  const active = activeImportFor(connection);
  if (!active || ids.length === 0) return [];
  const { businessId, store } = await catalogStore();
  return withAgreementPrices(connection, businessId, store, await store.getByIds(businessId, active.id, ids));
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
  return withAgreementPrices(
    connection,
    businessId,
    store,
    await store.findByArticleNumbers(businessId, active.id, articleNumbers),
  );
}
