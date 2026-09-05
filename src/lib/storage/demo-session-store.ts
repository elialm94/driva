/**
 * Fil-store för demosessioner: EN JSON-fil per besökare.
 *
 * Detta är samma JSON-lager som den lokala utvecklingen använder (ett
 * DB-objekt, serialiserat till disk) – inte en andra Driva. Skillnaden är
 * bara VAR objektet bor: i stället för den globala .data/db.json får varje
 * demosession sin egen fil under .data/demo-sessions/<session-id>.json
 * (/tmp på serverless).
 *
 *   * Första träffen klonar det kanoniska seedet (buildSeed) till
 *     sessionens fil, med meta.demo = true så att alla servergrindar
 *     (mejl/SMS/BankID/AI-budget) behandlar sessionen som demo.
 *   * Läsningar cacheas per instans (samma objektidentitet som den globala
 *     JSON-storen har via g.__drivaDb) – parallella requests i samma
 *     session muterar samma objekt och save() skriver ner filen.
 *   * Utgångna filer städas med enkel katalogstädning (mtime äldre än
 *     livslängden). Ingen SQL – Supabase-rader rörs ALDRIG av demon.
 *
 * Session-id:n valideras mot ett strikt alfabet innan de blir filnamn
 * (isValidDemoSessionId) – ingen väg ut ur katalogen.
 */
import fs from "fs";
import path from "path";
import type { DB } from "../types";
import { buildSeed } from "../seed";
import { normalize } from "../store";
import { demoSessionMaxAgeSeconds, isValidDemoSessionId } from "../auth/demo-session";
import { deleteCatalogFileFor } from "../wholesalers/catalog-store";

/** Speglar auth/demo-request.demoBusinessIdFor – dupliceras för att undvika importcykel (next/headers). */
function demoCatalogBusinessId(sessionId: string): string {
  return `demo-${sessionId}`;
}

const onServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

/** Testkrok: DRIVA_DEMO_SESSIONS_DIR pekar om katalogen (tmp-kataloger i tester). */
export function demoSessionsDir(): string {
  const override = process.env.DRIVA_DEMO_SESSIONS_DIR?.trim();
  if (override) return override;
  return onServerless
    ? path.join("/tmp", "driva-demo-sessions")
    : path.join(process.cwd(), ".data", "demo-sessions");
}

function sessionFile(id: string): string {
  if (!isValidDemoSessionId(id)) {
    throw new Error("Ogiltigt demosessions-id.");
  }
  return path.join(demoSessionsDir(), `${id}.json`);
}

/** Per-instans-cache: samma objekt för alla requests i samma session. */
type GlobalWithDemoCache = typeof globalThis & { __drivaDemoSessions?: Map<string, DB> };
const g = globalThis as GlobalWithDemoCache;

function cache(): Map<string, DB> {
  return (g.__drivaDemoSessions ??= new Map());
}

/** Färsk klon av det kanoniska exempeldatat, märkt som demo. */
export function buildDemoSessionSeed(): DB {
  const seed = buildSeed();
  seed.meta.demo = true;
  // persistIfDirty=false: normaliseringen får aldrig skriva den GLOBALA
  // JSON-filen som bieffekt – sessionens fil skrivs uttryckligen nedan.
  return normalize(seed, { persistIfDirty: false });
}

export function persistDemoSessionState(id: string, state: DB): void {
  const file = sessionFile(id);
  cache().set(id, state);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    // Read-only FS: in-memory-cachen räcker på den här instansen.
  }
}

/** Sessionens tillstånd om det finns (cache eller fil) – annars null. */
export function loadDemoSessionState(id: string): DB | null {
  const cached = cache().get(id);
  if (cached) return cached;
  const file = sessionFile(id);
  try {
    if (!fs.existsSync(file)) return null;
    const loaded = JSON.parse(fs.readFileSync(file, "utf8")) as DB;
    const state = normalize(loaded, { persistIfDirty: false });
    cache().set(id, state);
    return state;
  } catch {
    // Trasig/halvskriven fil: behandla som saknad – anroparen klonar färskt.
    return null;
  }
}

/**
 * Sessionens tillstånd; första träffen klonar seedet till sessionens fil.
 * Vid klonen passas även på att städa utgångna filer i katalogen.
 */
export function ensureDemoSessionState(id: string): DB {
  const existing = loadDemoSessionState(id);
  if (existing) return existing;
  const state = buildDemoSessionSeed();
  persistDemoSessionState(id, state);
  cleanupExpiredDemoSessions();
  return state;
}

/** Återställ: skriv över sessionens fil med färskt seed. */
export function resetDemoSessionState(id: string): DB {
  const state = buildDemoSessionSeed();
  persistDemoSessionState(id, state);
  // Grossistkatalogen (artiklar) bor i en egen fil per session – nollställs
  // ihop med sessionen så att återställningen aldrig lämnar gamla artiklar.
  deleteCatalogFileFor(demoCatalogBusinessId(id));
  return state;
}

/** Avsluta: släng sessionens fil och cachepost. Rör aldrig något annat. */
export function deleteDemoSessionState(id: string): void {
  cache().delete(id);
  try {
    fs.rmSync(sessionFile(id), { force: true });
  } catch {
    // Filen städas annars av katalogstädningen.
  }
  deleteCatalogFileFor(demoCatalogBusinessId(id));
}

/**
 * Enkel katalogstädning: ta bort sessionsfiler vars senaste skrivning är
 * äldre än livslängden (+ marginal). Körs opportunistiskt när nya sessioner
 * klonas – ingen cron, ingen databas.
 */
export function cleanupExpiredDemoSessions(now = Date.now()): number {
  const dir = demoSessionsDir();
  const maxAgeMs = demoSessionMaxAgeSeconds() * 1000 + 60 * 60_000;
  let removed = 0;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.endsWith(".json") && !name.endsWith(".json.tmp")) continue;
    const file = path.join(dir, name);
    try {
      const stat = fs.statSync(file);
      if (now - stat.mtimeMs <= maxAgeMs) continue;
      fs.rmSync(file, { force: true });
      const sessionId = name.replace(/\.json(\.tmp)?$/, "");
      cache().delete(sessionId);
      deleteCatalogFileFor(demoCatalogBusinessId(sessionId));
      removed += 1;
    } catch {
      // Fil försvann under städningen – nästa körning tar resten.
    }
  }
  return removed;
}

export function __resetDemoSessionCacheForTests(): void {
  cache().clear();
}
