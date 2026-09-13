/**
 * Företagets standardvillkor för offerter. Ligger här så att inställnings-UI
 * (klient) kan visa texten utan att importera servertjänster.
 *
 * Systemtexten påstår ingenting om F-skatt eller försäkring. Sådana meningar
 * läggs bara till av `resolveQuoteTerms` när företaget har en aktuell
 * verifiering i Inställningar (spec §8). Ändra inte copy utan juridisk review.
 */

import { claimSentences, todayIso } from "./company-claims";
import type { CompanySettings } from "./types";

export const STANDARD_TERMS =
  "Offerten omfattar arbete och material enligt specifikationen ovan. Eventuella tillkommande arbeten offereras separat innan de påbörjas. Garanti lämnas enligt konsumenttjänstlagen.";

/**
 * Den tidigare systemtexten, som påstod F-skatt och "full ansvarsförsäkring"
 * åt alla företag. Behandlas som orörd systemdefault: migration 54 nollar den
 * i databasen och sparformuläret lagrar den aldrig igen. Ett företag som
 * medvetet vill ha texten kan skriva den själv – då skiljer den sig i regel
 * ändå (eget bolag, egna belopp).
 */
export const LEGACY_STANDARD_TERMS =
  "Offerten omfattar arbete och material enligt specifikationen ovan. Eventuella tillkommande arbeten offereras separat innan de påbörjas. Vi innehar F-skattsedel och full ansvarsförsäkring. Garanti lämnas enligt konsumenttjänstlagen.";

/** Rimligt tak för inställningsfältet och offertens villkorstext. */
export const DEFAULT_QUOTE_TERMS_MAX = 4000;

/**
 * Systemets standardvillkor för det här företaget just nu: neutral text plus
 * de påståenden som faktiskt är verifierade. Ingen verifiering = bara texten.
 */
export function systemQuoteTerms(
  settings: Pick<CompanySettings, "claims"> | undefined,
  today: string = todayIso()
): string {
  const extra = claimSentences(settings, today);
  return extra.length > 0 ? `${STANDARD_TERMS} ${extra.join(" ")}` : STANDARD_TERMS;
}

/**
 * Sant när texten är en systemdefault (nuvarande, med eller utan verifierade
 * påståenden, eller den gamla) – alltså inget företaget själv formulerat.
 * Whitespace normaliseras så att en kopierad rad inte räknas som egen text.
 */
export function isSystemQuoteTerms(
  text: string | undefined | null,
  settings: Pick<CompanySettings, "claims"> | undefined,
  today: string = todayIso()
): boolean {
  const norm = (value: string) => value.replace(/\s+/g, " ").trim();
  const candidate = norm(text ?? "");
  if (!candidate) return true;
  return (
    candidate === norm(STANDARD_TERMS) ||
    candidate === norm(LEGACY_STANDARD_TERMS) ||
    candidate === norm(systemQuoteTerms(settings, today))
  );
}

/**
 * Villkoren en NY offert får: företagets egen text om den finns (skrivs aldrig
 * över), annars systemets text för dagens verifieringsläge.
 */
export function resolveQuoteTerms(
  settings: Pick<CompanySettings, "claims" | "defaultQuoteTerms">,
  today: string = todayIso()
): string {
  const custom = settings.defaultQuoteTerms?.trim();
  if (custom && !isSystemQuoteTerms(custom, settings, today)) return custom;
  return systemQuoteTerms(settings, today);
}
