import fs from "fs";
import path from "path";
import type { CompanySettings, DB, Job, JobSource } from "./types";
import { buildSeed } from "./seed";
import { hydrateIssuedInvoices, hydrateQuoteSellerSnapshots } from "./invoices/snapshot";
import { taxReductionFields } from "./tax-reduction-terms";
import { migrateAccounting } from "./accounting/migrate";
import { normalizeDomains } from "./domains/normalize";
import { storageMode } from "./storage/config";
import { tenantContext } from "./storage/context";
import { requestTenantState } from "./storage/request-scope";
import { hydrateQuotedBaselines } from "./services/job-work-baseline";

/**
 * Lagringsfasad: all domänkod läser/skriver via db() + save().
 *
 * Två lägen (se storage/config.ts):
 *
 *   * SUPABASE (produktion): en request-skopad tenantkontext (AsyncLocalStorage,
 *     se storage/adapter-supabase.ts) håller företagets tillstånd laddat från
 *     Postgres. db() returnerar kontextens tillstånd, save() flaggar för
 *     commit – diffen skrivs atomärt i EN transaktion när kontexten stängs.
 *     Utan kontext kastar db(): åtkomst utan verifierad tenant är en bugg.
 *
 *   * JSON (endast utveckling/tester): `.data/db.json` lokalt, in-memory +
 *     /tmp på serverless. I produktion är JSON-läget AVSTÄNGT – saknas
 *     Supabase-miljön stannar appen med tydligt fel (config.ts).
 *
 * Personnummer i JSON-läget ligger i klartext i den lokala filen – endast
 * utvecklingsdata. I Supabase-läget gäller databasens skydd (RLS med mera).
 */

const onServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const DATA_FILE = onServerless
  ? path.join("/tmp", "driva-db.json")
  : path.join(process.cwd(), ".data", "db.json");

type GlobalWithDb = typeof globalThis & { __drivaDb?: DB };
const g = globalThis as GlobalWithDb;

function hydrateTaxReductionTerms(data: DB): boolean {
  let changed = false;
  for (const v of data.quoteVersions) {
    if (v.lockedAt) continue;
    if (v.rot && !v.taxReductionTerms) {
      Object.assign(v, taxReductionFields(v.rot));
      changed = true;
    } else if (!v.rot && v.taxReductionTerms) {
      v.taxReductionTerms = null;
      changed = true;
    }
  }
  return changed;
}

function hydrateTaxReductionDemo(data: DB): boolean {
  // Engångshydrering: körs den varje laddning återuppstår demo-personnumret
  // även om användaren medvetet tagit bort det från kundkortet.
  if (data.meta.taxReductionDemoHydrated) return false;
  const anna = data.customers.find((c) => c.id === "cust-anna");
  if (anna && !anna.personalIdentityNumber) {
    anna.personalIdentityNumber = "19850515-1234";
  }
  const kok = data.jobs.find((j) => j.id === "job-kok");
  if (kok && !kok.housing) {
    kok.housing = { dwellingType: "smahus" };
  }
  data.meta.taxReductionDemoHydrated = true;
  return true;
}

/**
 * Normalisering/hydrering för JSON-lagret (äldre filer får nya fält).
 * Supabase-läget behöver den inte: laddade rader är alltid kompletta, och
 * migreringsskriptet kör normalize() på källdatat FÖRE insättning.
 */
type LegacyRequest = {
  id: string;
  customerId: string;
  title: string;
  message: string;
  source: string;
  quoteId?: string;
  createdAt: string;
  idempotencyKey?: string;
  notification?: Job["notification"];
};

function mapLegacyRequestSource(source: string): JobSource {
  switch (source) {
    case "hemsida":
      return "web_form";
    case "telefon":
      return "phone";
    case "manuell":
      return "manual";
    case "assistent":
      return "import";
    case "email":
      return "email";
    default:
      return "other";
  }
}

/** Äldre JSON-filer hade en requests-tabell. Flytta till uppdrag, en gång. */
function migrateRequestsToJobs(data: DB): boolean {
  const bag = data as DB & { requests?: LegacyRequest[] };
  const leftover = bag.requests;
  let changed = false;

  if (leftover?.length) {
    for (const r of leftover) {
      const quote = data.quotes.find(
        (q) => q.id === r.quoteId || (q as QuoteWithLegacyRequest).requestId === r.id
      );
      const existing =
        data.jobs.find((j) => j.id === r.id) ??
        (quote?.jobId ? data.jobs.find((j) => j.id === quote.jobId) : undefined) ??
        (r.idempotencyKey ? data.jobs.find((j) => j.idempotencyKey === r.idempotencyKey) : undefined);
      const source = mapLegacyRequestSource(r.source);
      if (existing) {
        if (!existing.source || existing.source === "manual") existing.source = source;
        existing.originalMessage ??= r.message;
        existing.idempotencyKey ??= r.idempotencyKey;
        existing.notification ??= r.notification;
        if (quote && !quote.jobId) quote.jobId = existing.id;
        changed = true;
        continue;
      }
      const job: Job = {
        id: r.id,
        customerId: r.customerId,
        quoteId: r.quoteId ?? quote?.id,
        title: r.title || r.message.replace(/\s+/g, " ").trim().slice(0, 60),
        description: r.message,
        status: "kommande",
        checklist: [],
        notes: "",
        createdAt: r.createdAt,
        source,
        originalMessage: r.message,
      };
      if (r.idempotencyKey) job.idempotencyKey = r.idempotencyKey;
      if (r.notification) job.notification = r.notification;
      data.jobs.push(job);
      if (quote) quote.jobId = job.id;
      changed = true;
    }
  }

  for (const q of data.quotes) {
    const legacy = q as QuoteWithLegacyRequest;
    if (legacy.requestId) {
      if (!q.jobId) {
        const byId = data.jobs.find((j) => j.id === legacy.requestId);
        if (byId) q.jobId = byId.id;
      }
      delete legacy.requestId;
      changed = true;
    }
  }

  if ("requests" in bag) {
    delete bag.requests;
    changed = true;
  }

  const settings = data.settings as CompanySettings & { inquiryNotificationEmail?: string };
  if (settings.inquiryNotificationEmail != null) {
    if (!settings.websiteNotificationEmail) settings.websiteNotificationEmail = settings.inquiryNotificationEmail;
    delete settings.inquiryNotificationEmail;
    changed = true;
  }

  return changed;
}

type QuoteWithLegacyRequest = { requestId?: string };

export function normalize(loaded: DB): DB {
  // Fält tillagda efter att filen skapades får sina standardvärden här.
  loaded.settings.lateInterestRate ??= 10;
  loaded.settings.quoteValidityDays ??= 30;
  loaded.settings.defaultVatRate ??= 25;
  loaded.settings.country ??= "Sverige";
  loaded.assistantAudit ??= [];
  loaded.assistantMessages ??= [];
  loaded.pendingActions ??= [];
  loaded.reminders ??= [];
  loaded.attentionStates ??= [];
  loaded.inboxItems ??= [];
  loaded.supplierPayments ??= [];
  loaded.jobWorkEntries ??= [];
  loaded.collaborationInvitations ??= [];
  loaded.clientInformationRequests ??= [];
  loaded.settings.inboundMailSlug ??= "demo";
  for (const sup of loaded.supplierInvoices ?? []) {
    sup.accountingStatus ??= sup.verificationId ? "bokford" : "obokford";
  }
  for (const item of loaded.inboxItems) {
    item.documentType ??=
      item.expenseId || /kvitto/i.test(item.subject) ? "kvitto" : "ekonomiskt_dokument";
  }
  const domainsChanged = normalizeDomains(loaded);
  // Bokföringsmotorn: räkenskapsår, IB och verifikationsfält (idempotent).
  const migrated = migrateAccounting(loaded);
  const dirty =
    migrateRequestsToJobs(loaded) ||
    hydrateIssuedInvoices(loaded) ||
    hydrateQuoteSellerSnapshots(loaded) ||
    hydrateTaxReductionTerms(loaded) ||
    hydrateTaxReductionDemo(loaded) ||
    hydrateQuotedBaselines(loaded);
  // Persist snapshots so later settings changes cannot rewrite seed/historical docs.
  if (dirty || migrated || domainsChanged) persist(loaded);
  return loaded;
}

function freshSeed(): DB {
  return normalize(buildSeed());
}

function schemaNeedsNormalize(data: DB | undefined): boolean {
  if (!data) return true;
  if (!Array.isArray(data.domains) || !Array.isArray(data.domainAudit)) return true;
  if (!Array.isArray(data.inboxItems)) return true;
  if (!Array.isArray(data.supplierPayments)) return true;
  if (!Array.isArray(data.jobWorkEntries)) return true;
  if (!Array.isArray(data.collaborationInvitations)) return true;
  if (!Array.isArray(data.clientInformationRequests)) return true;
  if ("requests" in (data as object)) return true;
  if (!data.meta.taxReductionDemoHydrated) return true;
  return false;
}

export function db(): DB {
  // Supabase-läge: tillståndet ägs av requestens tenantkontext (server
  // actions/API) eller sidans request-cell (RSC-renderingar).
  const ctx = tenantContext();
  if (ctx) return ctx.state;
  const pageState = requestTenantState();
  if (pageState) return pageState;
  if (storageMode() === "supabase") {
    throw new Error(
      "Ingen tenantkontext: db() i Supabase-läge kräver withBusiness()/withPublicBusiness() (server actions, API-routes) eller ensurePageBusiness()/ensurePublicPage() (sidor)."
    );
  }

  if (!g.__drivaDb) {
    if (fs.existsSync(DATA_FILE)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as DB;
        g.__drivaDb = normalize(loaded);
      } catch {
        g.__drivaDb = freshSeed();
        persist(g.__drivaDb);
      }
    } else {
      g.__drivaDb = freshSeed();
      persist(g.__drivaDb);
    }
  } else if (schemaNeedsNormalize(g.__drivaDb)) {
    // HMR / äldre in-memory cache saknar nya fält – kör migration igen.
    g.__drivaDb = normalize(g.__drivaDb);
  }
  return g.__drivaDb;
}

function persist(data: DB) {
  if (process.env.DRIVA_TEST === "1") return;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), "utf8");
    fs.renameSync(tmp, DATA_FILE);
  } catch {
    // Read-only FS: in-memory räcker för demon.
  }
}

/** Ersätt in-memory-databasen utan att skriva till disk (tester). */
export function replaceDb(data: DB): void {
  g.__drivaDb = normalize(data);
}

/** Spara efter varje mutation. */
export function save(): void {
  const ctx = tenantContext();
  if (ctx) {
    if (!ctx.writable) {
      throw new Error(
        "save() anropades i en läskontext. Sidorenderingar får inte mutera – flytta ändringen till en server action."
      );
    }
    ctx.dirty = true;
    return;
  }
  if (storageMode() === "supabase") {
    // Sidorenderingar (request-cellen) och kod utanför tenantkontext får
    // aldrig mutera i Supabase-läge – ändringen skulle tyst försvinna.
    throw new Error(
      "save() utan skrivkontext i Supabase-läge. Muteringar måste gå via withBusiness()/withPublicBusiness()."
    );
  }
  if (g.__drivaDb) persist(g.__drivaDb);
}

/** Återställ demodatat helt (endast JSON-läget – dev/tester). */
export function resetDemoData(): void {
  assertJsonMode("resetDemoData");
  g.__drivaDb = freshSeed();
  persist(g.__drivaDb);
}

/**
 * Dev-verktyg: nollställ till ett helt tomt företag (0 kunder, 0 dokument,
 * 0 transaktioner) med behållna företagsinställningar. Används för att granska
 * tomma vyer – exponeras endast via dev-API:t, aldrig i produktions-UI.
 */
export function resetToEmptyCompany(): void {
  assertJsonMode("resetToEmptyCompany");
  const settings = g.__drivaDb?.settings ?? buildSeed().settings;
  const seeded = new Date().toISOString();
  const empty: DB = {
    settings,
    sequences: { quote: 1, invoice: 1, verification: 1 },
    customers: [],
    quotes: [],
    quoteVersions: [],
    signatures: [],
    bankidOrders: [],
    jobs: [],
    jobWorkEntries: [],
    invoices: [],
    payments: [],
    bankAccounts: [],
    bankTransactions: [],
    expenses: [],
    receipts: [],
    supplierInvoices: [],
    verifications: [],
    fiscalYears: [],
    accounting: {},
    vatReports: [],
    assets: [],
    accruals: [],
    auditTrail: [],
    annualReports: [],
    activity: [],
    website: null,
    domains: [],
    domainAudit: [],
    assistantMessages: [],
    pendingActions: [],
    assistantAudit: [],
    reminders: [],
    attentionStates: [],
    inboxItems: [],
    supplierPayments: [],
    collaborationInvitations: [],
    clientInformationRequests: [],
    meta: { seededAt: seeded, taxReductionDemoHydrated: true },
  };
  g.__drivaDb = normalize(empty);
  persist(g.__drivaDb);
}

function assertJsonMode(operation: string): void {
  if (storageMode() === "supabase") {
    throw new Error(
      `${operation} är ett JSON-läges-verktyg och körs aldrig mot Supabase. Använd npm run db:seed för demodata i en riktig databas.`
    );
  }
}
