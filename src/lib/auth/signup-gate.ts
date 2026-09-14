/**
 * Registreringsspärr när den juridiska avtalsparten inte är konfigurerad.
 *
 * Landningssidan utlovar 199 kr/mån efter provperioden och Stripe Checkout
 * vägrar redan teckna abonnemang utan LEGAL_ENTITY_* (se
 * `src/lib/billing/checkout.ts`). Utan den här spärren kunde en ny kund starta
 * en 14 dagars provperiod som hen sedan inte kan betala för: konto skapat,
 * företag skapat, ingen väg till abonnemang. Hellre ett ärligt nej i
 * registreringen än ett löfte vi inte kan hålla.
 *
 * Gäller ENBART skarp drift (VERCEL_ENV=production). Lokalt, i preview och i
 * JSON-läget ändras ingenting - där finns inga riktiga kunder att skydda.
 *
 * Inget bolagsnamn står i koden: allt läses ur servermiljön via
 * `legalEntityStatus`.
 */
import { legalEntityStatus, type EnvSource } from "../legal/entity";
import { isProductionRuntime } from "../deployment";

export const SIGNUP_CLOSED_HEADING = "Registreringen är tillfälligt stängd";

export const SIGNUP_CLOSED_MESSAGE =
  "Vi kan inte skapa nya konton just nu: Fervas avtalsuppgifter är inte färdigkonfigurerade, " +
  "och då finns ingen avtalspart som kan ta betalt när provperioden går ut. " +
  "Vi öppnar registreringen igen så snart det är på plats.";

export const SIGNUP_CLOSED_EXISTING_USERS = "Har du redan ett konto fungerar inloggningen som vanligt.";

/**
 * Ska registreringen vägras? Anropas både av server actionen (innan någon
 * auth-användare skapas) och av /signup (så formuläret inte ens visas).
 */
export function signupClosedForLegalEntity(env: EnvSource = process.env): boolean {
  if (!isProductionRuntime(env)) return false;
  return !legalEntityStatus(env).complete;
}
