/**
 * Publik demosession: en RIKTIG, begränsad identitet – aldrig en auth-bypass.
 *
 * Modellen (Supabase-läget):
 *   * En dedikerad, seedad demo-auth-användare (npm run db:seed -- --demo).
 *     /demo loggar in besökaren på servern med signInWithPassword mot
 *     inloggningsuppgifter som ENDAST finns i servermiljön
 *     (DEMO_USER_EMAIL / DEMO_USER_PASSWORD) – aldrig i klientbundeln.
 *     Varje besökare får en EGEN Supabase-session (egna tokens).
 *   * Varje session får dessutom ett EGET demoföretag (businesses.is_demo +
 *     demo_expires_at), seedat från exempeldatat. Sessionens hemliga token
 *     ligger i demo-cookien; serversidan mappar SHA-256(token) →
 *     businesses.demo_token_hash. Ett klientpåstått sessions-id räcker
 *     alltså aldrig för att nå någon annans session.
 *   * Per-sessionsföretaget har INGET medlemskap i business_memberships –
 *     demo-användarens JWT ger noll åtkomst via PostgREST. Auktoriseringen
 *     är token-uppslaget + samma tenantväg som riktiga företag (driva_app +
 *     app.business_id-GUC + RLS).
 *   * Sessionens livslängd är DEMO_SESSION_HOURS (standard 24 h) – både i
 *     cookien och i demo_expires_at. Proxyn loggar ut demo-sessioner vars
 *     cookie saknas eller gått ut; utgångna företag städas av
 *     app.cleanup_expired_demo_businesses (cron + opportunistiskt).
 *
 * JSON-läget (lokal utveckling) ÄR redan demon – där behövs ingen session.
 */
import { createHash, randomBytes } from "crypto";
import { isSupabaseMode } from "@/lib/storage/config";

/** Markerar en aktiv demosession; värdet är "utgångstid.sessionstoken". */
export const DEMO_SESSION_COOKIE = "driva_demo";
/** Demo-only aktörsbyte: "accountant" = redovisningsytan som Anna Svensson. */
export const DEMO_ACTOR_COOKIE = "driva_demo_actor";

const DEFAULT_SESSION_HOURS = 24;

export function demoUserEmail(): string | undefined {
  const v = process.env.DEMO_USER_EMAIL?.trim();
  return v || undefined;
}

/** Endast serversidan – används uteslutande i server actions. */
export function demoUserPassword(): string | undefined {
  const v = process.env.DEMO_USER_PASSWORD?.trim();
  return v || undefined;
}

/** Demoinloggning är på när Supabase-läget kör och båda variablerna finns. */
export function isDemoLoginConfigured(): boolean {
  return isSupabaseMode() && Boolean(demoUserEmail()) && Boolean(demoUserPassword());
}

export function isDemoUserEmail(email: string | null | undefined): boolean {
  const demo = demoUserEmail();
  if (!demo || !email) return false;
  return email.trim().toLowerCase() === demo.toLowerCase();
}

/** Begränsad livslängd (spec: ett dygn). Klampas till 1–72 h. */
export function demoSessionMaxAgeSeconds(): number {
  const raw = Number(process.env.DEMO_SESSION_HOURS?.trim());
  const hours = Number.isFinite(raw) && raw > 0 ? Math.min(Math.max(raw, 1), 72) : DEFAULT_SESSION_HOURS;
  return Math.round(hours * 3600);
}

/** Kryptografiskt slumpad sessionstoken – aldrig gissbar, lagras aldrig i klartext. */
export function newDemoSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Serversidans mappningsnyckel: businesses.demo_token_hash = SHA-256(token). */
export function demoTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Cookievärdet är "utgångstid.sessionstoken": proxyn läser utgångstiden
 * (litar aldrig enbart på maxAge) och tokendelen är sessionens hemliga nyckel
 * till det egna demoföretaget. AI-budgetens per-sessionsfönster nycklar på
 * hela värdet.
 */
export function demoCookieValueFor(token: string): string {
  const expires = Date.now() + demoSessionMaxAgeSeconds() * 1000;
  return `${expires}.${token}`;
}

export function demoCookieValueNow(): string {
  return demoCookieValueFor(newDemoSessionToken());
}

export function isDemoCookieValueActive(value: string | undefined): boolean {
  if (!value) return false;
  const expires = Number(value.split(".")[0]);
  return Number.isFinite(expires) && expires > Date.now();
}

/** Sessionstoken ur cookievärdet ("utgångstid.token"). null för trasiga/gamla värden. */
export function demoTokenFromCookieValue(value: string | undefined): string | null {
  if (!isDemoCookieValueActive(value)) return null;
  const dot = value!.indexOf(".");
  if (dot < 0) return null;
  const token = value!.slice(dot + 1);
  // Gamla kakformatets korta slumpdel är ingen giltig token – kräver
  // base64url-längden från newDemoSessionToken (32 byte ≈ 43 tecken).
  return token.length >= 40 ? token : null;
}

/* ------------------------------------------------------------------------ *
 * Rate limit för den publika demostarten.
 *
 * Ingen delad rate-limit-infrastruktur finns i kodbasen, så gränsen hålls
 * i minnet per serverless-instans: skydd mot enkel skriptad massinloggning
 * från samma instans, INTE en distribuerad garanti. I botten gäller dessutom
 * Supabases egna auth-rate-limits (token-endpointen), som är per projekt.
 * Ingen tenant skapas per session (delat demoföretag) – missbruksytan är
 * inloggningsförsök, inte massprovisionering.
 * ------------------------------------------------------------------------ */

const WINDOW_MS = 10 * 60_000;
const MAX_STARTS_PER_IP = 10;
const MAX_STARTS_GLOBAL = 120;
const RESET_MIN_INTERVAL_MS = 20_000;

const startsByIp = new Map<string, number[]>();
const startsGlobal: number[] = [];
let lastResetAt = 0;

function prune(list: number[], now: number, windowMs = WINDOW_MS): void {
  while (list.length > 0 && now - list[0] > windowMs) list.shift();
}

export function rateLimitDemoStart(ip: string, now = Date.now()): boolean {
  prune(startsGlobal, now);
  if (startsGlobal.length >= MAX_STARTS_GLOBAL) return false;
  const key = ip || "okänd";
  const perIp = startsByIp.get(key) ?? [];
  prune(perIp, now);
  if (perIp.length >= MAX_STARTS_PER_IP) return false;
  perIp.push(now);
  startsByIp.set(key, perIp);
  startsGlobal.push(now);
  // Städa bort gamla nycklar så kartan inte växer obegränsat.
  if (startsByIp.size > 5_000) {
    for (const [k, v] of startsByIp) {
      prune(v, now);
      if (v.length === 0) startsByIp.delete(k);
    }
  }
  return true;
}

/** Återställningen är dyr (tömning + återimport) – max en per instans per 20 s. */
export function rateLimitDemoReset(now = Date.now()): boolean {
  if (now - lastResetAt < RESET_MIN_INTERVAL_MS) return false;
  lastResetAt = now;
  return true;
}

/* ------------------------------------------------------------------------ *
 * Skrivbudget per demosession: ETT centralt tak i withBusiness täcker alla
 * skapande/kostsamma åtgärder (kunder, offerter, fakturor, uppdrag,
 * uppladdningar, bokföring) utan att någon enskild action kan glömmas.
 * Gränsen är medvetet generös – en människa märker den aldrig, ett skript
 * som massprovisionerar data stoppas. Hålls i minnet per instans; i botten
 * skyddar dessutom demostartens IP-gräns och 24-timmarsstädningen.
 * ------------------------------------------------------------------------ */

const WRITE_WINDOW_MS = 10 * 60_000;
const MAX_WRITES_PER_WINDOW = 300;

const writesByBusiness = new Map<string, number[]>();

export function rateLimitDemoWrite(businessId: string, now = Date.now()): boolean {
  const list = writesByBusiness.get(businessId) ?? [];
  prune(list, now, WRITE_WINDOW_MS);
  if (list.length >= MAX_WRITES_PER_WINDOW) return false;
  list.push(now);
  writesByBusiness.set(businessId, list);
  if (writesByBusiness.size > 2_000) {
    for (const [k, v] of writesByBusiness) {
      prune(v, now, WRITE_WINDOW_MS);
      if (v.length === 0) writesByBusiness.delete(k);
    }
  }
  return true;
}

export const DEMO_WRITE_LIMIT_MESSAGE =
  "Demon har en gräns för hur många ändringar som kan göras på kort tid. Vänta en liten stund och försök igen.";

export function __resetDemoRateLimitForTests(): void {
  startsByIp.clear();
  startsGlobal.length = 0;
  writesByBusiness.clear();
  lastResetAt = 0;
}

/** Klient-IP ur proxy-/CDN-headers (Vercel sätter x-forwarded-for). */
export function clientIpFrom(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "okänd";
}
