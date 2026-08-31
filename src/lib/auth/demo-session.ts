/**
 * Publik demosession: JSON + cookie – aldrig databasen.
 *
 * Modellen:
 *   * "Se demo" (GET /demo) sätter en httpOnly-cookie (driva_demo) vars
 *     värde bär ett KRYPTOGRAFISKT slumpat session-id och sessionens
 *     utgångstid. Vid första träffen klonas det kanoniska exempeldatat
 *     (Södermalms Snickeri AB) till sessionens EGEN JSON-fil,
 *     .data/demo-sessions/<id>.json (se storage/demo-session-store.ts).
 *   * db()/save() i en demorequest läser/skriver BARA den filen – samma
 *     JSON-lager som den lokala utvecklingen använder, request-skopat.
 *     Supabase (riktiga företag) berörs aldrig av demon: inga rader skapas,
 *     läses eller raderas där.
 *   * Reload inom livslängden → samma fil. Annan cookie/incognito → egen
 *     färsk klon. Återställ → filen skrivs över med färskt seed. Utgångna
 *     filer städas bort med enkel katalogstädning (aldrig SQL).
 *   * Isoleringen är per session-id: utan cookien (ogissbart id) finns ingen
 *     väg till en annan besökares fil, och en demosession kan aldrig nå
 *     riktiga företag eftersom demorequests aldrig rör Supabase-lagret.
 *
 * Den här modulen är de RENA hjälparna (cookievärde, livslängd, rate limits)
 * – importeras även av proxyn och måste därför vara fri från Node-API:er
 * (Web Crypto i stället för node:crypto).
 */

/** Markerar en aktiv demosession; värdet är "utgångstid.session-id". */
export const DEMO_SESSION_COOKIE = "driva_demo";
/** Demo-only aktörsbyte: "accountant" = redovisningsytan som Anna Svensson. */
export const DEMO_ACTOR_COOKIE = "driva_demo_actor";

/** Spec: en demosession lever 24 h; därefter städas filen och nästa besök får färsk seed. */
const DEFAULT_SESSION_HOURS = 24;

/** Begränsad livslängd (spec: 24 h). Klampas till 1–72 h. */
export function demoSessionMaxAgeSeconds(): number {
  const raw = Number(process.env.DEMO_SESSION_HOURS?.trim());
  const hours = Number.isFinite(raw) && raw > 0 ? Math.min(Math.max(raw, 1), 72) : DEFAULT_SESSION_HOURS;
  return Math.round(hours * 3600);
}

/** Session-id:n är filnamn – strikt alfabet, ingen väg ut ur katalogen. */
const SESSION_ID_PATTERN = /^[a-z0-9]{20,64}$/;

export function isValidDemoSessionId(id: string | undefined | null): id is string {
  return typeof id === "string" && SESSION_ID_PATTERN.test(id);
}

/** Kryptografiskt slumpat session-id (Web Crypto – fungerar även i proxyn). */
export function newDemoSessionId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(26);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  // 26 tecken à 36 möjligheter ≈ 134 bitar – ogissbart.
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/**
 * Cookievärdet är "utgångstid.session-id": utgångstiden läses av proxyn
 * (litar aldrig enbart på maxAge) och session-id:t pekar ut sessionens
 * JSON-fil. Id:t ger bara åtkomst till den EGNA demofilen – aldrig till
 * någon annan session eller till riktiga data.
 */
export function demoCookieValueNow(sessionId = newDemoSessionId()): string {
  const expires = Date.now() + demoSessionMaxAgeSeconds() * 1000;
  return `${expires}.${sessionId}`;
}

export function isDemoCookieValueActive(value: string | undefined): boolean {
  if (!value) return false;
  const expires = Number(value.split(".")[0]);
  return Number.isFinite(expires) && expires > Date.now();
}

/** Session-id:t ur ett AKTIVT cookievärde – annars null. */
export function demoSessionIdFromCookie(value: string | undefined): string | null {
  if (!isDemoCookieValueActive(value)) return null;
  const id = value?.split(".")[1];
  return isValidDemoSessionId(id) ? id : null;
}

/* ------------------------------------------------------------------------ *
 * Rate limit för den publika demostarten.
 *
 * Varje start klonar seedet till en ny JSON-fil, så gränsen skyddar mot
 * skriptad massgenerering av filer. Fönstren hålls i minnet per
 * serverless-instans: skydd mot enkel skriptning från samma instans, INTE
 * en distribuerad garanti. I botten gäller katalogstädningen som tar
 * utgångna sessionsfiler.
 * ------------------------------------------------------------------------ */

function limitOverride(name: string, fallback: number): number {
  // Endast för lokal utveckling/E2E (skript slår i taket snabbare än en
  // människa). Ingen override i produktion – standardvärdena gäller.
  if (process.env.NODE_ENV === "production") return fallback;
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const WINDOW_MS = 10 * 60_000;
const MAX_STARTS_PER_IP = limitOverride("DRIVA_DEMO_MAX_STARTS_PER_IP", 6);
const MAX_STARTS_GLOBAL = limitOverride("DRIVA_DEMO_MAX_STARTS_GLOBAL", 60);
const RESET_MIN_INTERVAL_MS = 20_000;

/** Skrivtak per demosession: långt över mänsklig takt, stopp för skript. */
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

/** Återställningen skriver om hela filen – max en per instans per 20 s. */
export function rateLimitDemoReset(now = Date.now()): boolean {
  if (now - lastResetAt < RESET_MIN_INTERVAL_MS) return false;
  lastResetAt = now;
  return true;
}

/**
 * Skrivtak per demosession och instans: withBusiness frågar före varje
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
