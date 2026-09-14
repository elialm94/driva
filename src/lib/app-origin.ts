/**
 * Appens publika ursprung. Ligger för sig själv (inte i mail.ts) så att
 * e-postmallarna kan läsa det utan att dra in Resend-klienten.
 */

/**
 * Ursprunget när det faktiskt är konfigurerat, annars undefined.
 *
 * På Vercel injiceras domänen automatiskt (utan protokoll). Localhost räknas
 * inte: i ett mejl är den lika trasig som ingen adress alls, och då vill vi
 * hellre utelämna det som behöver en absolut URL.
 */
export function configuredAppOrigin(): string | undefined {
  const raw = process.env.DRIVA_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return undefined;
}

/** Ursprunget med utvecklingsfallback. Länkar mår bra av en adress även lokalt. */
export function appOrigin(): string {
  return configuredAppOrigin() ?? "http://localhost:3123";
}

export function absoluteAppUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${appOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}
