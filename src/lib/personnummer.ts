import { digitsOnly } from "./invoices/formats";

/**
 * Svenskt personnummer: 10 eller 12 siffror, visat med bindestreck.
 * Känsligt – använd maskPersonnummer i vanliga vyer och i modellkontext.
 */

function looksLikeCentury(digits: string): boolean {
  return digits.length >= 2 && /^(18|19|20)/.test(digits);
}

/** Progressiv visning: YYYYMMDD-NNNN eller YYMMDD-NNNN. */
export function formatPersonnummer(value: string): string {
  const d = digitsOnly(value).slice(0, 12);
  if (looksLikeCentury(d)) {
    if (d.length <= 8) return d;
    return `${d.slice(0, 8)}-${d.slice(8)}`;
  }
  if (d.length <= 6) return d;
  return `${d.slice(0, 6)}-${d.slice(6, 10)}`;
}

export function normalizePersonnummer(value: string): string {
  const d = digitsOnly(value);
  if (d.length === 12) return `${d.slice(0, 8)}-${d.slice(8)}`;
  if (d.length === 10) return `${d.slice(0, 6)}-${d.slice(6)}`;
  return value.trim();
}

export function isPersonnummerFormat(value: string): boolean {
  const d = digitsOnly(value);
  return d.length === 10 || d.length === 12;
}

/** Vanliga vyer: `1985••••-1234`. */
export function maskPersonnummer(value: string): string {
  const d = digitsOnly(value);
  if (d.length === 12) return `${d.slice(0, 4)}••••-${d.slice(8)}`;
  if (d.length === 10) return `${d.slice(0, 2)}••••-${d.slice(6)}`;
  return value.trim() ? "••••" : "";
}

/**
 * Födelsedatumet ur personnummret, YYYY-MM-DD. Personnummret är den enda
 * källan – ett separat födelsedatum vid sidan om skulle kunna säga något annat.
 *
 * Tio siffror saknar sekel. Det avgörs mot dagens datum: den tolkning som ger
 * en levande person (0–99 år) väljs. Samordningsnummer (dag + 60) hanteras,
 * eftersom en anställd kan ha ett sådant.
 */
export function birthDateFromPersonnummer(value: string, today: string = new Date().toISOString().slice(0, 10)): string | null {
  const d = digitsOnly(value);
  const currentYear = Number(today.slice(0, 4));
  let year: number;
  let rest: string;
  if (d.length === 12) {
    year = Number(d.slice(0, 4));
    rest = d.slice(4, 8);
  } else if (d.length === 10) {
    const yy = Number(d.slice(0, 2));
    year = 2000 + yy;
    if (year > currentYear) year -= 100;
    rest = d.slice(2, 6);
  } else {
    return null;
  }
  const month = Number(rest.slice(0, 2));
  // Samordningsnummer räknar dagen +60.
  const rawDay = Number(rest.slice(2, 4));
  const day = rawDay > 60 ? rawDay - 60 : rawDay;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1880 || year > currentYear) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Åldern vid ingången av ett år. Arbetsgivaravgiften avgörs av just detta mått
 * ("vid årets ingång fyllt N år"), inte av åldern på löneutbetalningsdagen.
 */
export function ageAtStartOfYear(birthDate: string, year: number): number {
  const startOfYear = `${year}-01-01`;
  let age = year - Number(birthDate.slice(0, 4));
  if (birthDate.slice(5) > startOfYear.slice(5)) age -= 1;
  return age;
}
