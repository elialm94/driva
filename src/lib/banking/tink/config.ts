/**
 * Tink-miljö (server-only). Läses ENBART på servern – det finns inga
 * NEXT_PUBLIC_TINK_*-variabler och får aldrig finnas: client secret och
 * redirect-URI hör hemma i serverns process.env.
 *
 *   TINK_CLIENT_ID      Console → appen "Driva"
 *   TINK_CLIENT_SECRET  Console → appen "Driva"
 *   TINK_REDIRECT_URI   Måste vara byte-för-byte identisk med den som är
 *                       registrerad i Console (och det vi skickar i Link-URL:en).
 *   TINK_MARKET         SE (standard)
 *   TINK_ENV            sandbox | production (standard sandbox – aldrig
 *                       produktion av misstag). Tink har ingen separat
 *                       sandbox-host: sandbox = samma API + `test=true` i
 *                       Tink Link så att Demo Bank visas.
 *
 * Saknas någon av de tre obligatoriska variablerna är kopplingen inte
 * konfigurerad – ett riktigt företag får då ett ärligt "Bankkoppling är inte
 * konfigurerad", aldrig en låtsaskoppling.
 */

export type TinkEnvironment = "sandbox" | "production";

export interface TinkConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  market: string;
  locale: string;
  env: TinkEnvironment;
  apiBase: string;
  linkBase: string;
}

export const TINK_API_BASE = "https://api.tink.com";
export const TINK_LINK_BASE = "https://link.tink.com";

/** Tink Links egna klient-id – konstant för alla kunder (delegering av permanent user). */
export const TINK_LINK_ACTOR_CLIENT_ID = "df05e4b379934cd09963197cc855bfe9";

type EnvSource = Record<string, string | undefined>;

function trimmed(env: EnvSource, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

/** Är alla obligatoriska TINK_*-variabler satta? Ren funktion – testbar med egen env. */
export function readTinkConfig(env: EnvSource = process.env): TinkConfig | null {
  const clientId = trimmed(env, "TINK_CLIENT_ID");
  const clientSecret = trimmed(env, "TINK_CLIENT_SECRET");
  const redirectUri = trimmed(env, "TINK_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) return null;
  const rawEnv = (trimmed(env, "TINK_ENV") ?? "sandbox").toLowerCase();
  const tinkEnv: TinkEnvironment = rawEnv === "production" ? "production" : "sandbox";
  const market = (trimmed(env, "TINK_MARKET") ?? "SE").toUpperCase();
  return {
    clientId,
    clientSecret,
    redirectUri,
    market,
    locale: market === "SE" ? "sv_SE" : "en_US",
    env: tinkEnv,
    apiBase: TINK_API_BASE,
    linkBase: TINK_LINK_BASE,
  };
}

export function isTinkConfigured(env: EnvSource = process.env): boolean {
  return readTinkConfig(env) !== null;
}
