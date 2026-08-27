/**
 * Domän- och hostingkonfiguration. Server-side only – aldrig till frontend.
 *
 * Production that counts: Vercel-projektet `driva` som servar
 * https://driva-alpha.vercel.app/ (GitHub: elialm94/driva).
 * Projektet `noxfort` / noxfort.vercel.app är en leftover-dublett och ska inte användas.
 *
 * Mock är standard lokalt. Riktig Openprovider-sandbox kräver:
 *   DOMAIN_REGISTRAR_PROVIDER=openprovider
 *   DOMAIN_REGISTRAR_API_URL=https://api.sandbox.openprovider.eu
 *   DOMAIN_REGISTRAR_USERNAME=...
 *   DOMAIN_REGISTRAR_PASSWORD=...
 *   DOMAIN_REGISTRAR_MODE=sandbox
 *   DOMAIN_PROVIDER_MODE=live
 *   VERCEL_TOKEN=...
 *   VERCEL_PROJECT_ID=<id för projektet driva>  (eller VERCEL_PROJECT_NAME=driva)
 */

export type DomainRuntimeMode = "mock" | "live";
export type RegistrarMode = "sandbox" | "production";

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function domainRuntimeMode(): DomainRuntimeMode {
  const forced = env("DOMAIN_PROVIDER_MODE").toLowerCase();
  if (forced === "mock") return "mock";
  if (forced === "live") return "live";
  // Utan sandbox-uppgifter: mock så att lokal/dev fungerar hela vägen.
  if (!env("DOMAIN_REGISTRAR_USERNAME") || !env("DOMAIN_REGISTRAR_PASSWORD")) return "mock";
  return "live";
}

export function isMockDomainMode(): boolean {
  return domainRuntimeMode() === "mock";
}

export function registrarConfig() {
  const provider = (env("DOMAIN_REGISTRAR_PROVIDER") || "openprovider").toLowerCase();
  const mode: RegistrarMode = env("DOMAIN_REGISTRAR_MODE") === "production" ? "production" : "sandbox";
  const apiUrl =
    env("DOMAIN_REGISTRAR_API_URL") ||
    (mode === "production" ? "https://api.openprovider.eu" : "https://api.sandbox.openprovider.eu");
  return {
    provider,
    mode,
    apiUrl: apiUrl.replace(/\/$/, ""),
    username: env("DOMAIN_REGISTRAR_USERNAME"),
    password: env("DOMAIN_REGISTRAR_PASSWORD"),
  };
}

/**
 * Vercel-projektet som kunders .se-adresser ska kopplas till.
 * Default: `driva` (driva-alpha.vercel.app) – inte noxfort.
 */
export function vercelHostingConfig() {
  return {
    token: env("VERCEL_TOKEN"),
    /** Projekt-id eller namn. Namnet `driva` fungerar mot Vercel API. */
    project: env("VERCEL_PROJECT_ID") || env("VERCEL_PROJECT_NAME") || "driva",
    teamId: env("VERCEL_TEAM_ID"),
  };
}

export function isDrivaAppHost(host: string): boolean {
  const h = host.toLowerCase().split(":")[0];
  if (!h) return true;
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (h.endsWith(".localhost")) return true;
  if (h.endsWith(".vercel.app")) return true;
  const extra = env("DRIVA_APP_HOST").toLowerCase();
  if (extra && h === extra) return true;
  return false;
}

export const CURRENT_BUSINESS_ID = "biz-current";

export const SE_CUSTOMER_PRICE = 99;
export const SE_PURCHASE_PRICE = 79;
