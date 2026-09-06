import type { FiscalYear } from "../types";

/**
 * Myndigheternas datum för bokslutsåret.
 *
 * De två deadlines som gäller ett avslutat räkenskapsår ligger långt efter att
 * bokföringen känns färdig, och de är olika: Bolagsverket räknar sju månader
 * från årets slut, Skatteverket har en tabell som hänger på vilken månad året
 * slutar. Utan dem blir bokslutet en uppgift utan förfallodag, och en uppgift
 * utan förfallodag är den som blir liggande.
 */

/**
 * Årsredovisningen ska ha kommit in till Bolagsverket senast sju månader efter
 * räkenskapsårets slut (ÅRL 8 kap. 3 §). Samma dag i månaden sju månader senare
 * – och sista dagen i månaden om den dagen inte finns, som 31 juli → 28 februari.
 */
export function annualReportDueDate(fy: Pick<FiscalYear, "endDate">): string {
  return addMonthsClamped(fy.endDate, 7);
}

/**
 * Inkomstdeklarationens sista dag för en juridisk person, enligt Skatteverkets
 * tabell över deklarationstidpunkter. Driva räknar med digital inlämning, som är
 * den enda vägen produkten stödjer – SRU-filerna går till Filöverföring.
 *
 * Kalenderår är V1:s enda räkenskapsår, men tabellen står här hel: en halv
 * tabell hade gett ett tyst fel den dag brutna år kommer, och den är fyra rader.
 */
export function ink2DueDate(fy: Pick<FiscalYear, "endDate">): string {
  const [year, month] = [Number(fy.endDate.slice(0, 4)), Number(fy.endDate.slice(5, 7))];
  // Månaden året slutar → deklarationsdag vid digital inlämning.
  if (month >= 1 && month <= 4) return `${year}-12-01`;
  if (month >= 5 && month <= 6) return `${year + 1}-01-15`;
  if (month >= 7 && month <= 8) return `${year + 1}-04-01`;
  return `${year + 1}-08-01`;
}

function addMonthsClamped(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const target = month - 1 + months;
  const targetYear = year + Math.floor(target / 12);
  const targetMonth = (target % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const clamped = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}
