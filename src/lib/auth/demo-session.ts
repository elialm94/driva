/**
 * Publik demosession – inget konto, ingen Supabase-auth för besökaren.
 *
 *   * JSON-läget (lokal utveckling) ÄR redan demon – /demo skickar rakt in.
 *   * I produktion (Supabase-läge) får varje besökare en egen isolerad
 *     kopia av Södermalms-exempeldatat, nycklad på demokakan. Muteringar
 *     stannar i den sessionen; nästa besökare startar från seed.
 *   * Inga DEMO_USER_EMAIL/PASSWORD krävs. Den äldre delade demo-användaren
 *     används inte längre som primär väg (alla skulle skriva på samma rader).
 *
 * Sessionens livslängd begränsas av demo-cookien (DEMO_SESSION_HOURS).
 */
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
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

/**
 * Äldre delad demo-användare (signInWithPassword). Behålls för bakåt-
 * kompatibilitet mot utgångna sessioner i proxyn – styr INTE tillgänglighet.
 */
export function isDemoLoginConfigured(): boolean {
  return isSupabaseMode() && Boolean(demoUserEmail()) && Boolean(demoUserPassword());
}

/** Publik demo är alltid tillgänglig – den är inte env-griad. */
export function isPublicDemoAvailable(): boolean {
  return true;
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

/**
 * Cookievärdet är "utgångstid.slumpdel": proxyn läser utgångstiden (litar
 * aldrig enbart på maxAge) och slumpdelen gör värdet unikt per besökare –
 * AI-budgetens per-sessionsfönster nycklar på det.
 */
export function demoCookieValueNow(): string {
  const expires = Date.now() + demoSessionMaxAgeSeconds() * 1000;
  const nonce = randomBytes(24).toString("hex");
  return `${expires}.${nonce}`;
}

/** Sessionens id (ogissbar) ur kakvärdet, eller null om kakan är ogiltig. */
export function demoSessionIdFromCookie(value: string | undefined): string | null {
  if (!value || !isDemoCookieValueActive(value)) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const id = value.slice(dot + 1).trim();
  return id.length >= 16 ? id : null;
}

/** Aktiv publik demosession i den här requesten? Läser bara kakan. */
export async function readActiveDemoSessionId(): Promise<string | null> {
  try {
    const jar = await cookies();
    return demoSessionIdFromCookie(jar.get(DEMO_SESSION_COOKIE)?.value);
  } catch {
    return null;
  }
}

export function isDemoCookieValueActive(value: string | undefined): boolean {
  if (!value) return false;
  const expires = Number(value.split(".")[0]);
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
