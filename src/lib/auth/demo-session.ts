/**
 * Publik demosession: en RIKTIG, begränsad identitet – aldrig en auth-bypass.
 *
 * Modellen (Supabase-läget):
 *   * /demo skapar en ANONYM Supabase-session (signInAnonymously) och
 *     provisionerar ett EGET demoföretag åt besökaren: businesses.is_demo
 *     (fryst vid insert) + demo_expires_at, ägt via ett vanligt
 *     ägarmedlemskap. All auktorisering går den vanliga vägen: proxy →
 *     requireBusiness → medlemskap → RLS. Den anonyma användaren är bara
 *     medlem i SITT demoföretag och kan därför aldrig nå andra demon eller
 *     riktiga företag – exakt samma isolering som mellan riktiga tenants.
 *   * Sessionens identifierare är Supabase-sessionens egna tokens
 *     (kryptografiskt slumpade, httpOnly-cookies). Demo-cookien nedan bär
 *     bara utgångstiden + en slumpdel för AI-budgetens sessionsfönster –
 *     den ger ALDRIG åtkomst i sig.
 *   * Livslängd: demo_expires_at i databasen (kan aldrig förlängas –
 *     frystrigger) och demo-cookien håller samma tid. Proxyn loggar ut
 *     demo-sessioner vars cookie saknas eller gått ut; cleanup-vägen
 *     (app.delete_demo_business) tar utgångna demoföretag.
 *
 * Bakåtkompatibilitet: den äldre delade demo-användaren (DEMO_USER_EMAIL)
 * känns fortfarande igen som demo av e-postgrinden, men /demo skapar aldrig
 * fler sådana sessioner.
 *
 * JSON-läget (lokal utveckling) ÄR redan demon – där behövs ingen session.
 */
import { isSupabaseMode } from "@/lib/storage/config";

/** Markerar en aktiv demosession; värdet är utgångstiden (epoch ms). */
export const DEMO_SESSION_COOKIE = "driva_demo";
/** Demo-only aktörsbyte: "accountant" = redovisningsytan som Anna Svensson. */
export const DEMO_ACTOR_COOKIE = "driva_demo_actor";

/** Spec: en demosession lever 24 h; därefter städas datat och nästa besök får färsk seed. */
const DEFAULT_SESSION_HOURS = 24;

/** Minimala JWT-claims som demogrindarna behöver. */
export interface SessionClaimsLike {
  email?: unknown;
  is_anonymous?: unknown;
}

/** Är claims-uppsättningen en demosession? (Anonym användare eller legacy-demo-mejl.) */
export function isDemoClaims(claims: SessionClaimsLike | null | undefined): boolean {
  if (!claims) return false;
  if (claims.is_anonymous === true) return true;
  return isDemoUserEmail(typeof claims.email === "string" ? claims.email : undefined);
}

/** Legacy: det äldre delade demokontots e-post (om miljön fortfarande har det). */
export function demoUserEmail(): string | undefined {
  const v = process.env.DEMO_USER_EMAIL?.trim();
  return v || undefined;
}

export function isDemoUserEmail(email: string | null | undefined): boolean {
  const demo = demoUserEmail();
  if (!demo || !email) return false;
  return email.trim().toLowerCase() === demo.toLowerCase();
}

/** Demon är tillgänglig i Supabase-läget (anonyma sessioner provisioneras vid behov). */
export function isDemoLoginConfigured(): boolean {
  return isSupabaseMode();
}

/** Begränsad livslängd (spec: 24 h). Klampas till 1–72 h. */
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
  const nonce = Math.random().toString(36).slice(2, 12);
  return `${expires}.${nonce}`;
}

export function isDemoCookieValueActive(value: string | undefined): boolean {
  if (!value) return false;
  const expires = Number(value.split(".")[0]);
  return Number.isFinite(expires) && expires > Date.now();
}

/* ------------------------------------------------------------------------ *
 * Rate limit för den publika demostarten.
 *
 * Varje start provisionerar en tenant (anonym användare + företag + seed),
 * så gränsen är stramare än gamla inloggningsgränsen. Fönstren hålls i
 * minnet per serverless-instans: skydd mot enkel skriptad massprovisionering
 * från samma instans, INTE en distribuerad garanti. I botten gäller dessutom
 * Supabases egna rate limits för anonyma inloggningar (per IP, per projekt)
 * och cleanup-vägen som tar utgångna demoföretag efter 24 h.
 * ------------------------------------------------------------------------ */

const WINDOW_MS = 10 * 60_000;
const MAX_STARTS_PER_IP = 6;
const MAX_STARTS_GLOBAL = 60;
const RESET_MIN_INTERVAL_MS = 20_000;

/** Skrivtak per demoföretag: långt över mänsklig takt, stopp för skript. */
const WRITE_WINDOW_MS = 60_000;
const MAX_WRITES_PER_WINDOW = 60;

const startsByIp = new Map<string, number[]>();
const startsGlobal: number[] = [];
const writesByBusiness = new Map<string, number[]>();
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

/**
 * Skrivtak per demoföretag och instans: withBusiness frågar före varje
 * skrivande flöde i en demosession. 60/min märks aldrig av en människa
 * (autosparningar inräknade) men stoppar skriptad massgenerering. Riktiga
 * företag passerar aldrig genom kontrollen.
 */
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
