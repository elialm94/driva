/**
 * Skrubbning av felrapporter innan de lämnar servern/klienten (spec §6).
 *
 * Ferva skickar ALDRIG personnummer, auth-tokens, banktext, dokumentinnehåll,
 * e-postinnehåll eller filbilagor till Sentry. Den här modulen är ren
 * (ingen Sentry-import) så att reglerna kan testas i node:test, och används
 * som beforeSend/beforeBreadcrumb i sentry.*.config.ts och
 * instrumentation-client.ts.
 *
 * Princip: hellre för lite än för mycket. Request-body, cookies, headers,
 * query-strängar, lokala variabler och användarens e-post/IP tas alltid bort.
 * Fritext (felmeddelanden, breadcrumbs, extra) körs genom mönsterskrubben.
 */

/** Taggar som får följa med ett fel. Allt annat tas bort. */
export const ALLOWED_TAGS = new Set([
  "route",
  "integration",
  "correlationId",
  "release",
  "runtime",
  "environment",
  "tenant", // ENDAST irreversibel hash, se tenantHash()
  "transaction",
  "digest",
  "next.route",
  "next.span_type",
  "next.rsc",
  "http.method",
  "http.response.status_code",
]);

const PATTERNS: { re: RegExp; replacement: string }[] = [
  // JWT (tre base64url-segment) – Supabase-sessioner, Stripe-signaturer m.m.
  { re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replacement: "[token]" },
  // Bearer-headers och API-nycklar med kända prefix.
  { re: /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: "Bearer [token]" },
  { re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{6,}\b/g, replacement: "[stripe-nyckel]" },
  { re: /\bwhsec_[A-Za-z0-9]{6,}\b/g, replacement: "[webhook-secret]" },
  { re: /\bre_[A-Za-z0-9_]{10,}\b/g, replacement: "[resend-nyckel]" },
  { re: /\bsb[pa]_[A-Za-z0-9_]{10,}\b/g, replacement: "[supabase-nyckel]" },
  { re: /\bsk-or-v1-[A-Za-z0-9]{10,}\b/g, replacement: "[ai-nyckel]" },
  // Postgres-anslutningssträngar med lösenord.
  { re: /postgres(?:ql)?:\/\/[^\s'"]+/gi, replacement: "postgres://[dold]" },
  // Personnummer/samordningsnummer/organisationsnummer: 6–8 siffror, valfri
  // avgränsare, 4 siffror. Orgnummer offras medvetet – hellre för mycket.
  { re: /\b(?:19|20)?\d{6}[-+ ]?\d{4}\b/g, replacement: "[personnummer]" },
  // E-postadresser.
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: "[e-post]" },
  // IBAN.
  { re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, replacement: "[iban]" },
  // Långa siffersekvenser (konto-/OCR-/kortnummer): 10+ siffror med ev. mellanslag.
  { re: /\b\d(?:[ -]?\d){9,}\b/g, replacement: "[nummer]" },
  // Base64-blobbar (bilagor, PDF:er, bilder) – allt över 200 tecken.
  { re: /[A-Za-z0-9+/]{200,}={0,2}/g, replacement: "[blob]" },
];

const MAX_STRING = 2000;

/** Skrubba en fritextsträng. Idempotent. */
export function scrubText(input: string): string {
  let out = input.length > MAX_STRING ? `${input.slice(0, MAX_STRING)}… [avkortad]` : input;
  for (const { re, replacement } of PATTERNS) out = out.replace(re, replacement);
  return out;
}

/** Nycklar vars värden alltid ersätts oavsett innehåll. */
const SENSITIVE_KEYS =
  /(password|passwd|secret|token|authorization|cookie|api[-_]?key|personnummer|ssn|iban|bankgiro|plusgiro|ocr|kortnummer|card|cvc|body|payload|attachment|bilaga|content|html|text|message_body|raw)/i;

/** Rekursiv skrubb av godtycklig JSON-lik data (extra, contexts, breadcrumb data). */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[djup]";
  if (value == null) return value;
  if (typeof value === "string") return scrubText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "[dold]" : scrubValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/* --------------------------- Sentry-eventformer --------------------------- */

interface ScrubbableFrame {
  vars?: unknown;
  [key: string]: unknown;
}

interface ScrubbableException {
  value?: string;
  stacktrace?: { frames?: ScrubbableFrame[] };
  [key: string]: unknown;
}

/** Minsta gemensamma nämnare för Sentry:s ErrorEvent – undviker SDK-import här. */
export interface ScrubbableEvent {
  message?: string;
  logentry?: { message?: string; params?: unknown[] };
  exception?: { values?: ScrubbableException[] };
  request?: {
    url?: string;
    method?: string;
    headers?: unknown;
    cookies?: unknown;
    data?: unknown;
    query_string?: unknown;
    env?: unknown;
    [key: string]: unknown;
  };
  user?: { id?: string; [key: string]: unknown };
  tags?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: ScrubbableBreadcrumb[];
  [key: string]: unknown;
}

export interface ScrubbableBreadcrumb {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Ta bort query-sträng och fragment ur en URL; behåll bara sökvägen. */
export function scrubUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url, "http://ferva.local");
    // Publika tokenlänkar (/offert/<token>, /faktura/<token>, /inbjudan/<token>) maskas.
    const path = u.pathname.replace(
      /^(\/(?:offert|faktura|inbjudan|admin\/inbjudan|sajt)\/)[^/]+/,
      "$1[token]"
    );
    return url.startsWith("/") ? path : `${u.origin}${path}`;
  } catch {
    return "[url]";
  }
}

/**
 * beforeSend: skrubba ett fel-event. Returnerar alltid ett event (vi
 * tappar inte fel – vi tar bort innehåll).
 */
export function scrubEvent<T extends object>(input: T): T {
  // Sentry:s ErrorEvent har fler fält än vi rör – vi arbetar strukturellt.
  const event = input as unknown as ScrubbableEvent;
  if (event.message) event.message = scrubText(event.message);
  if (event.logentry?.message) {
    event.logentry = { message: scrubText(event.logentry.message) };
  }
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
    for (const frame of ex.stacktrace?.frames ?? []) delete frame.vars;
  }
  if (event.request) {
    event.request = {
      url: scrubUrl(event.request.url),
      method: event.request.method,
    };
  }
  if (event.user) {
    // Bara det pseudonyma user-id:t (UUID) – aldrig e-post, IP, namn.
    event.user = event.user.id ? { id: String(event.user.id) } : undefined;
  }
  if (event.tags) {
    const kept: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(event.tags)) {
      if (ALLOWED_TAGS.has(k)) kept[k] = typeof v === "string" ? scrubText(v) : v;
    }
    event.tags = kept;
  }
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.contexts) {
    const ctx = { ...event.contexts };
    // Rå request/response-data och egna kontexter kan bära kunddata.
    delete ctx.response;
    for (const key of Object.keys(ctx)) ctx[key] = scrubValue(ctx[key]);
    event.contexts = ctx;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map((b) => scrubBreadcrumb(b))
      .filter((b): b is ScrubbableBreadcrumb => b !== null);
  }
  return input;
}

/**
 * beforeBreadcrumb: console-/fetch-/xhr-brödsmulor kan innehålla kunddata i
 * klartext; vi behåller kategori + skrubbat meddelande, tar bort data.
 */
export function scrubBreadcrumb<T extends object>(input: T): T | null {
  const crumb = input as unknown as ScrubbableBreadcrumb;
  const category = crumb.category ?? "";
  if (category === "console" || category.startsWith("ui.") || category === "sentry.event") {
    return null;
  }
  const out: ScrubbableBreadcrumb = { ...crumb };
  if (out.message) out.message = scrubText(out.message);
  if (out.data) {
    const data: Record<string, unknown> = {};
    if (typeof out.data.url === "string") data.url = scrubUrl(out.data.url);
    if (typeof out.data.method === "string") data.method = out.data.method;
    if (typeof out.data.status_code === "number") data.status_code = out.data.status_code;
    out.data = data;
  }
  return out as unknown as T;
}
