/**
 * Konfiguration för central felövervakning (Sentry). Ren modul utan
 * SDK-import så att admin/health kan visa status utan att ladda Sentry.
 *
 *   SENTRY_DSN                 server/edge (hemlig nog att hållas server-side)
 *   NEXT_PUBLIC_SENTRY_DSN     klient (DSN:er är publika per design men vi
 *                              sätter den bara när klientrapportering önskas)
 *   SENTRY_ENVIRONMENT         valfritt; annars VERCEL_ENV/NODE_ENV
 *   SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN   endast för source maps i build
 *   SENTRY_TENANT_SALT         valfritt; utan salt skickas ingen tenant-hash alls
 *
 * Filen laddas även i Edge-runtime (sentry.edge.config.ts) – inga Node-importer.
 */
export type Env = Record<string, string | undefined>;

export function sentryServerDsn(env: Env = process.env): string | null {
  return env.SENTRY_DSN?.trim() || null;
}

export function sentryClientDsn(env: Env = process.env): string | null {
  return env.NEXT_PUBLIC_SENTRY_DSN?.trim() || null;
}

export function isSentryConfigured(env: Env = process.env): boolean {
  return Boolean(sentryServerDsn(env) || sentryClientDsn(env));
}

export function sentryEnvironment(env: Env = process.env): string {
  return env.SENTRY_ENVIRONMENT?.trim() || env.VERCEL_ENV?.trim() || env.NODE_ENV || "development";
}

/** Release = git-commit på Vercel, annars paketversion. Aldrig hemligt. */
export function appRelease(env: Env = process.env): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim() || env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.trim();
  if (sha) return `ferva@${sha.slice(0, 12)}`;
  return `ferva@${env.npm_package_version?.trim() || "dev"}`;
}

/** Source maps laddas bara upp när alla tre finns – annars vanlig build. */
export function sentrySourceMapsEnabled(env: Env = process.env): boolean {
  return Boolean(env.SENTRY_ORG?.trim() && env.SENTRY_PROJECT?.trim() && env.SENTRY_AUTH_TOKEN?.trim());
}

/** Korrelations-id som visas för användaren och sätts som tagg på felet. */
export function newCorrelationId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
