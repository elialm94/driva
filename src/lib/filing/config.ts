/**
 * Inlämningsmiljö (server-only). Deklarationer lämnas in via en
 * inlämningstjänst som bolaget har avtal med – Skatteverkets och
 * Bolagsverkets maskinvägar kräver både avtal och certifikat, och det är
 * avtalet som avgör om Driva får skicka något alls.
 *
 *   FILING_API_BASE_URL  Tjänstens bas-URL, t.ex. https://inlamning.example.se
 *   FILING_API_TOKEN     Bearer-token för bolagets konto hos tjänsten
 *   FILING_ENV           test | production (standard test – aldrig produktion
 *                        av misstag, en riktig deklaration ska inte kunna
 *                        lämnas in genom en felkonfigurerad miljö)
 *
 * Saknas någon av de två obligatoriska variablerna är inlämningen inte
 * konfigurerad. Ett riktigt företag får då ett ärligt svar om att filen finns
 * att hämta och lämna in själv – aldrig en låtsasinlämning med kvittens.
 */

export type FilingEnvironment = "test" | "production";

export interface FilingConfig {
  baseUrl: string;
  token: string;
  env: FilingEnvironment;
  /** Tidsgräns per anrop i millisekunder. */
  timeoutMs: number;
}

type EnvSource = Record<string, string | undefined>;

function trimmed(env: EnvSource, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

/** Är avtalsuppgifterna satta? Ren funktion – testbar med egen env. */
export function readFilingConfig(env: EnvSource = process.env): FilingConfig | null {
  const baseUrl = trimmed(env, "FILING_API_BASE_URL");
  const token = trimmed(env, "FILING_API_TOKEN");
  if (!baseUrl || !token) return null;
  const raw = (trimmed(env, "FILING_ENV") ?? "test").toLowerCase();
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    env: raw === "production" ? "production" : "test",
    timeoutMs: 20_000,
  };
}

export function isFilingConfigured(env: EnvSource = process.env): boolean {
  return readFilingConfig(env) !== null;
}
