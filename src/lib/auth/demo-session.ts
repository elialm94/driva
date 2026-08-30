/**
 * Publik demosession: en RIKTIG, begränsad identitet – aldrig en auth-bypass.
 *
 * Modellen (Supabase-läget):
 *   * En dedikerad, seedad demo-auth-användare (npm run db:seed -- --demo)
 *     äger ETT demoföretag (businesses.is_demo, fryst vid insert).
 *   * /demo startar sessionen på servern med signInWithPassword mot
 *     inloggningsuppgifter som ENDAST finns i servermiljön
 *     (DEMO_USER_EMAIL / DEMO_USER_PASSWORD) – aldrig i klientbundeln.
 *   * Varje besökare får en EGEN Supabase-session (egna tokens) för samma
 *     demo-användare. All auktorisering går den vanliga vägen: proxy →
 *     requireBusiness → medlemskap → RLS. Demo-användaren är bara medlem i
 *     demoföretaget och kan därför aldrig nå riktiga företag.
 *   * Sessionens livslängd begränsas av demo-cookien (DEMO_SESSION_HOURS,
 *     standard 8 h). Proxyn loggar ut demo-sessioner vars cookie saknas
 *     eller gått ut.
 *
 * JSON-läget (lokal utveckling) ÄR redan demon – där behövs ingen session.
 */
import { isSupabaseMode } from "@/lib/storage/config";

/** Markerar en aktiv demosession; värdet är utgångstiden (epoch ms). */
export const DEMO_SESSION_COOKIE = "driva_demo";
/** Demo-only aktörsbyte: "accountant" = redovisningsytan som Anna Svensson. */
export const DEMO_ACTOR_COOKIE = "driva_demo_actor";

const DEFAULT_SESSION_HOURS = 8;

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

/** Begränsad livslängd (spec: timmar–ett dygn). Klampas till 1–72 h. */
export function demoSessionMaxAgeSeconds(): number {
  const raw = Number(process.env.DEMO_SESSION_HOURS?.trim());
  const hours = Number.isFinite(raw) && raw > 0 ? Math.min(Math.max(raw, 1), 72) : DEFAULT_SESSION_HOURS;
  return Math.round(hours * 3600);
}

/** Cookievärdet är sessionens utgångstid – proxyn litar aldrig enbart på maxAge. */
export function demoCookieValueNow(): string {
  return String(Date.now() + demoSessionMaxAgeSeconds() * 1000);
}

export function isDemoCookieValueActive(value: string | undefined): boolean {
  if (!value) return false;
  const expires = Number(value);
  return Number.isFinite(expires) && expires > Date.now();
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

function prune(list: number[], now: number): void {
  while (list.length > 0 && now - list[0] > WINDOW_MS) list.shift();
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

export function __resetDemoRateLimitForTests(): void {
  startsByIp.clear();
  startsGlobal.length = 0;
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
