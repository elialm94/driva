import fs from "fs";
import path from "path";
import type { DB } from "./types";
import { buildSeed } from "./seed";
import { hydrateIssuedInvoices, hydrateQuoteSellerSnapshots } from "./invoices/snapshot";
import { taxReductionFields } from "./tax-reduction-terms";
import { migrateAccounting } from "./accounting/migrate";
import { normalizeDomains } from "./domains/normalize";

/**
 * Enkel JSON-baserad lagring för demon.
 * Datamodellen är riktig – lagret kan bytas mot Postgres/SQLite utan att
 * tjänstelagret behöver ändras (all åtkomst går via db() + save()).
 *
 * Lokalt: `.data/db.json`. På Vercel (serverless) är filsystemet read-only
 * utom `/tmp`, så vi skriver dit och håller samma data i minnet (globalThis).
 * Kalla starter nollställer till seed – avsiktligt för en demo.
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
  let changed = false;
  const anna = data.customers.find((c) => c.id === "cust-anna");
  if (anna && !anna.personalIdentityNumber) {
    anna.personalIdentityNumber = "19850515-1234";
    changed = true;
  }
  const kok = data.jobs.find((j) => j.id === "job-kok");
  if (kok && !kok.housing) {
    kok.housing = { dwellingType: "smahus" };
    changed = true;
  }
  return changed;
}

function normalize(loaded: DB): DB {
  // Fält tillagda efter att filen skapades får sina standardvärden här.
  loaded.settings.lateInterestRate ??= 10;
  loaded.settings.quoteValidityDays ??= 30;
  loaded.settings.defaultVatRate ??= 25;
  loaded.settings.country ??= "Sverige";
  loaded.assistantAudit ??= [];
  loaded.assistantMessages ??= [];
  loaded.pendingActions ??= [];
  const domainsChanged = normalizeDomains(loaded);
  // Bokföringsmotorn: räkenskapsår, IB och verifikationsfält (idempotent).
  const migrated = migrateAccounting(loaded);
  const dirty =
    hydrateIssuedInvoices(loaded) ||
    hydrateQuoteSellerSnapshots(loaded) ||
    hydrateTaxReductionTerms(loaded) ||
    hydrateTaxReductionDemo(loaded);
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
  const anna = data.customers.find((c) => c.id === "cust-anna");
  if (anna && !anna.personalIdentityNumber) return true;
  const kok = data.jobs.find((j) => j.id === "job-kok");
  if (kok && !kok.housing) return true;
  return false;
}

export function db(): DB {
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
  if (g.__drivaDb) persist(g.__drivaDb);
}

/** Återställ demodatat helt. */
export function resetDemoData(): void {
  g.__drivaDb = freshSeed();
  persist(g.__drivaDb);
}
