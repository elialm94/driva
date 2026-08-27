import fs from "fs";
import path from "path";
import type { DB } from "./types";
import { buildSeed } from "./seed";

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

function normalize(loaded: DB): DB {
  // Fält tillagda efter att filen skapades får sina standardvärden här.
  loaded.settings.lateInterestRate ??= 10;
  return loaded;
}

export function db(): DB {
  if (!g.__drivaDb) {
    if (fs.existsSync(DATA_FILE)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as DB;
        g.__drivaDb = normalize(loaded);
      } catch {
        g.__drivaDb = buildSeed();
        persist(g.__drivaDb);
      }
    } else {
      g.__drivaDb = buildSeed();
      persist(g.__drivaDb);
    }
  }
  return g.__drivaDb;
}

function persist(data: DB) {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), "utf8");
    fs.renameSync(tmp, DATA_FILE);
  } catch {
    // Read-only FS: in-memory räcker för demon.
  }
}

/** Spara efter varje mutation. */
export function save(): void {
  if (g.__drivaDb) persist(g.__drivaDb);
}

/** Återställ demodatat helt. */
export function resetDemoData(): void {
  g.__drivaDb = buildSeed();
  persist(g.__drivaDb);
}
