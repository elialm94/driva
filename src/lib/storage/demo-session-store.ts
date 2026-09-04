/**
 * Store för demosessioner: ETT DB-objekt (samma JSON-form som den lokala
 * utvecklingen använder) per besökare, aldrig en andra Driva. Skillnaden mot
 * den globala JSON-storen är bara VAR objektet bor:
 *
 *   * JSON-läge (lokal utveckling, tester): en fil per session under
 *     .data/demo-sessions/<session-id>.json – en process, en disk.
 *   * Supabase-läge (produktion/Vercel): EN rad per session i tabellen
 *     public.demo_sessions (id, state jsonb, state_version). Serverless kör
 *     flera instanser med var sin process och var sitt /tmp – en fil skriven
 *     av instansen som tog emot kundens "Godkänn offert" syns aldrig för
 *     instansen som renderar Ekonomi-registret. Tillståndet måste därför bo
 *     i något som alla instanser delar, och databasen är det enda delade
 *     lagret appen har. Raden är INTE ett företag: inga businesses-,
 *     auth.users- eller tenantrader skapas – demon rör aldrig riktiga
 *     företags data.
 *
 * Gemensamt för båda lagren:
 *   * Första träffen klonar det kanoniska seedet (buildSeed) med
 *     meta.demo = true så att alla servergrindar (mejl/SMS/BankID/AI-budget)
 *     behandlar sessionen som demo.
 *   * Läsningar cacheas per instans (samma objektidentitet – parallella
 *     requests i samma session muterar samma objekt och save() skriver ner
 *     hela tillståndet). I Supabase-läget nycklas cachen med state_version
 *     och verifieras med EN billig fråga per läsning (samma mönster som
 *     snapshot-cache.ts): andra instansers skrivningar upptäcks alltid.
 *   * Utgångna sessioner städas opportunistiskt när nya klonas (mtime resp.
 *     expires_at äldre än livslängden + marginal). Ingen cron.
 *
 * Session-id:n valideras mot ett strikt alfabet innan de blir filnamn eller
 * nycklar (isValidDemoSessionId) – ingen väg ut ur katalogen.
 */
import fs from "fs";
import path from "path";
import type { DB } from "../types";
import { buildSeed } from "../seed";
import { normalize } from "../store";
import { isSupabaseMode } from "./config";
import type { SqlClient } from "./executor";
import { sqlClient } from "./adapter-supabase";
import { ensureDemoSessionsSchema } from "./apply-pending-schema";
import { demoSessionMaxAgeSeconds, isValidDemoSessionId } from "../auth/demo-session";

const onServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

/** Marginal utöver cookiens livslängd innan en session räknas som utgången. */
const EXPIRY_MARGIN_MS = 60 * 60_000;

function assertSessionId(id: string): void {
  if (!isValidDemoSessionId(id)) {
    throw new Error("Ogiltigt demosessions-id.");
  }
}

/** Färsk klon av det kanoniska exempeldatat, märkt som demo. */
export function buildDemoSessionSeed(): DB {
  const seed = buildSeed();
  seed.meta.demo = true;
  // persistIfDirty=false: normaliseringen får aldrig skriva den GLOBALA
  // JSON-filen som bieffekt – sessionens lager skrivs uttryckligen.
  return normalize(seed, { persistIfDirty: false });
}

/* ------------------------------------------------------------------ */
/* Lagerval                                                            */
/* ------------------------------------------------------------------ */

type Backend = "file" | "sql";

let backendOverride: Backend | null = null;

/**
 * Testkrok: tvinga SQL-lagret (mot PGlite via setSqlClientForTests) eller
 * fil-lagret oberoende av miljön. null = välj efter lagringsläget.
 */
export function setDemoSessionBackendForTests(backend: Backend | null): void {
  backendOverride = backend;
}

function backend(): Backend {
  if (backendOverride) return backendOverride;
  return isSupabaseMode() ? "sql" : "file";
}

/* ------------------------------------------------------------------ */
/* Fil-lagret (JSON-läge)                                              */
/* ------------------------------------------------------------------ */

/** Testkrok: DRIVA_DEMO_SESSIONS_DIR pekar om katalogen (tmp-kataloger i tester). */
export function demoSessionsDir(): string {
  const override = process.env.DRIVA_DEMO_SESSIONS_DIR?.trim();
  if (override) return override;
  return onServerless
    ? path.join("/tmp", "driva-demo-sessions")
    : path.join(process.cwd(), ".data", "demo-sessions");
}

function sessionFile(id: string): string {
  assertSessionId(id);
  return path.join(demoSessionsDir(), `${id}.json`);
}

/** Per-instans-cache för fil-lagret: samma objekt för alla requests i samma session. */
type GlobalWithDemoCache = typeof globalThis & { __drivaDemoSessions?: Map<string, DB> };
const g = globalThis as GlobalWithDemoCache;

function fileCache(): Map<string, DB> {
  return (g.__drivaDemoSessions ??= new Map());
}

function filePersist(id: string, state: DB): void {
  const file = sessionFile(id);
  fileCache().set(id, state);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    // Read-only FS: in-memory-cachen räcker på den här instansen.
  }
}

function fileLoad(id: string): DB | null {
  const cached = fileCache().get(id);
  if (cached) return cached;
  const file = sessionFile(id);
  try {
    if (!fs.existsSync(file)) return null;
    const loaded = JSON.parse(fs.readFileSync(file, "utf8")) as DB;
    const state = normalize(loaded, { persistIfDirty: false });
    fileCache().set(id, state);
    return state;
  } catch {
    // Trasig/halvskriven fil: behandla som saknad – anroparen klonar färskt.
    return null;
  }
}

function fileDelete(id: string): void {
  fileCache().delete(id);
  try {
    fs.rmSync(sessionFile(id), { force: true });
  } catch {
    // Filen städas annars av katalogstädningen.
  }
}

function fileCleanup(now: number): number {
  const dir = demoSessionsDir();
  const maxAgeMs = demoSessionMaxAgeSeconds() * 1000 + EXPIRY_MARGIN_MS;
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
      fileCache().delete(name.replace(/\.json(\.tmp)?$/, ""));
      removed += 1;
    } catch {
      // Fil försvann under städningen – nästa körning tar resten.
    }
  }
  return removed;
}

/* ------------------------------------------------------------------ */
/* SQL-lagret (Supabase-läge)                                          */
/* ------------------------------------------------------------------ */

interface SqlCacheEntry {
  state: DB;
  stateVersion: number;
}

/**
 * Per-instans-cache nycklad med state_version. Träff = objektet återanvänds
 * (samma identitet inom instansen); en avvikande version i databasen betyder
 * att en annan instans skrivit – då läses raden om.
 */
let sqlCache = new Map<string, SqlCacheEntry>();

let schemaEnsured = false;

async function demoSql(): Promise<SqlClient> {
  const client = await sqlClient();
  if (!schemaEnsured) {
    // Idempotent (IF NOT EXISTS). Misslyckad apply cachas inte – nästa
    // anrop försöker igen. Ingen tyst fallback till fil: på serverless vore
    // filen exakt den inkonsekvens tabellen finns för att undvika.
    await ensureDemoSessionsSchema(client);
    schemaEnsured = true;
  }
  return client;
}

function parseStateColumn(value: unknown): DB {
  return (typeof value === "string" ? JSON.parse(value) : value) as DB;
}

async function sqlVersion(client: SqlClient, id: string): Promise<number | null> {
  const rows = await client.query(`select state_version from public.demo_sessions where id = $1`, [id]);
  const v = rows[0]?.state_version;
  return v == null ? null : Number(v);
}

async function sqlLoad(id: string): Promise<DB | null> {
  assertSessionId(id);
  const client = await demoSql();
  const entry = sqlCache.get(id);
  if (entry) {
    const version = await sqlVersion(client, id);
    if (version !== null && version === entry.stateVersion) return entry.state;
    sqlCache.delete(id);
    if (version === null) return null;
  }
  const rows = await client.query(`select state, state_version from public.demo_sessions where id = $1`, [id]);
  const row = rows[0];
  if (!row) return null;
  const state = normalize(parseStateColumn(row.state), { persistIfDirty: false });
  sqlCache.set(id, { state, stateVersion: Number(row.state_version) });
  return state;
}

async function sqlPersist(id: string, state: DB): Promise<void> {
  assertSessionId(id);
  const client = await demoSql();
  // Hela tillståndet skrivs om (ingen diffning) och versionen bumpas så att
  // andra instansers cacheposter blir ogiltiga. Sista skrivaren vinner –
  // en demosession har en besökare.
  const expiresAt = new Date(Date.now() + demoSessionMaxAgeSeconds() * 1000 + EXPIRY_MARGIN_MS).toISOString();
  const rows = await client.query(
    `insert into public.demo_sessions (id, state, state_version, expires_at)
     values ($1, $2::jsonb, 1, $3::timestamptz)
     on conflict (id) do update
       set state = excluded.state,
           state_version = public.demo_sessions.state_version + 1,
           updated_at = now(),
           expires_at = excluded.expires_at
     returning state_version`,
    [id, JSON.stringify(state), expiresAt]
  );
  sqlCache.set(id, { state, stateVersion: Number(rows[0]?.state_version ?? 1) });
}

async function sqlDelete(id: string): Promise<void> {
  assertSessionId(id);
  sqlCache.delete(id);
  const client = await demoSql();
  await client.query(`delete from public.demo_sessions where id = $1`, [id]);
}

async function sqlCleanup(): Promise<number> {
  const client = await demoSql();
  const rows = await client.query(`delete from public.demo_sessions where expires_at < now() returning id`);
  for (const row of rows) sqlCache.delete(String(row.id));
  return rows.length;
}

/* ------------------------------------------------------------------ */
/* Publikt API (asynkront – SQL-lagret kräver det)                      */
/* ------------------------------------------------------------------ */

export async function persistDemoSessionState(id: string, state: DB): Promise<void> {
  if (backend() === "sql") return sqlPersist(id, state);
  filePersist(id, state);
}

/** Sessionens tillstånd om det finns (cache eller lager) – annars null. */
export async function loadDemoSessionState(id: string): Promise<DB | null> {
  if (backend() === "sql") return sqlLoad(id);
  return fileLoad(id);
}

/**
 * Sessionens tillstånd; första träffen klonar seedet till sessionens lager.
 * Vid klonen passas även på att städa utgångna sessioner.
 */
export async function ensureDemoSessionState(id: string): Promise<DB> {
  const existing = await loadDemoSessionState(id);
  if (existing) return existing;
  const state = buildDemoSessionSeed();
  await persistDemoSessionState(id, state);
  await cleanupExpiredDemoSessions();
  return state;
}

/** Återställ: skriv över sessionens tillstånd med färskt seed. */
export async function resetDemoSessionState(id: string): Promise<DB> {
  const state = buildDemoSessionSeed();
  await persistDemoSessionState(id, state);
  return state;
}

/** Avsluta: släng sessionens rad/fil och cachepost. Rör aldrig något annat. */
export async function deleteDemoSessionState(id: string): Promise<void> {
  if (backend() === "sql") return sqlDelete(id);
  fileDelete(id);
}

/**
 * Städning: ta bort sessioner vars senaste skrivning är äldre än
 * livslängden (+ marginal). Körs opportunistiskt när nya sessioner klonas –
 * ingen cron.
 */
export async function cleanupExpiredDemoSessions(now = Date.now()): Promise<number> {
  if (backend() === "sql") return sqlCleanup();
  return fileCleanup(now);
}

export function __resetDemoSessionCacheForTests(): void {
  fileCache().clear();
  sqlCache.clear();
  schemaEnsured = false;
}

/**
 * Testkrok: byt ut SQL-lagrets per-instans-cache. Två olika Map:ar
 * simulerar två serverless-instanser med var sitt minne mot samma databas.
 */
export function __useDemoSessionSqlCacheForTests(cache: Map<string, { state: DB; stateVersion: number }>): void {
  sqlCache = cache;
}
