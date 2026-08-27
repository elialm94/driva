import fs from "fs";
import path from "path";
import type { DB } from "./types";
import { buildSeed } from "./seed";

/**
 * Enkel JSON-baserad lagring för demon.
 * Datamodellen är riktig – lagret kan bytas mot Postgres/SQLite utan att
 * tjänstelagret behöver ändras (all åtkomst går via db() + save()).
 */

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "db.json");

type GlobalWithDb = typeof globalThis & { __drivaDb?: DB };
const g = globalThis as GlobalWithDb;

export function db(): DB {
  if (!g.__drivaDb) {
    if (fs.existsSync(DATA_FILE)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as DB;
        // Fält tillagda efter att filen skapades får sina standardvärden här.
        loaded.settings.lateInterestRate ??= 10;
        g.__drivaDb = loaded;
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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), "utf8");
  fs.renameSync(tmp, DATA_FILE);
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
