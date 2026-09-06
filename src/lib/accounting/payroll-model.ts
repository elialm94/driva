import { ageAtStartOfYear, birthDateFromPersonnummer } from "../personnummer";
import type { EmployeeRole, TaxBasis } from "../types";
import { ARBETSGIVARAVGIFT, PERSONALSKATT } from "./tax-account-model";

/**
 * Lönemodellen – rena beräkningar utan databas, så både serverlogiken och
 * klientvyerna kan använda dem.
 *
 * Kontering av en lönekörning:
 *
 *   7220/7210 debet   bruttolön
 *   7510      debet   arbetsgivaravgifter
 *   2710      kredit  avdragen personalskatt
 *   2731      kredit  arbetsgivaravgifter
 *   1930      kredit  nettolön
 *
 * Bruttolön = personalskatt + nettolön, och avgiften står på båda sidor, så
 * verifikationen balanserar. Skulderna på 2710 och 2731 nollställs när
 * arbetsgivardeklarationen förs till skattekontot (se tax-account.ts).
 */

export const LON_FORETAGSLEDARE = 7220;
export const LON_TJANSTEMAN = 7210;
export const SOCIALA_AVGIFTER = 7510;
export const FORETAGSKONTO = 1930;
export { ARBETSGIVARAVGIFT, PERSONALSKATT };

export const EMPLOYEE_ROLE_LABEL: Record<EmployeeRole, string> = {
  foretagsledare: "Företagsledare",
  tjansteman: "Tjänsteman",
};

/** Lönekontot styrs av rollen: ägarens lön hör till 7220, övriga till 7210. */
export function salaryAccountFor(role: EmployeeRole): number {
  return role === "foretagsledare" ? LON_FORETAGSLEDARE : LON_TJANSTEMAN;
}

/* ---------------------------- Preliminärskatt ----------------------------- */

/**
 * Skatteavdraget vilar på företagets `TaxBasis` (se types.ts).
 *
 * `tabell` – Skatteverkets skattetabell. Beloppet skrivs in från tabellen, det
 * räknas inte fram här. Tabellerna är publicerade uppslagstabeller med ett
 * tiotal kolumner och hundratals inkomstintervall som ändras varje år;
 * arbetsgivarens skyldighet är att dra enligt tabellen, och ett eget påhittat
 * tal vore fel skatt även om det låg nära. Driva sparar beloppet, varnar när
 * lönen ändras så att uppslaget inte längre gäller, och redovisar exakt det
 * avdrag som gjorts i arbetsgivardeklarationen.
 *
 * `procent` – fast procentsats, det som gäller vid beslut om särskild
 * beräkningsgrund (jämkning) och vid sidoinkomst.
 *
 * Skatteverkets tabeller är numrerade efter kommunal skattesats.
 */
export const TAX_TABLE_MIN = 29;
export const TAX_TABLE_MAX = 43;

export function preliminaryTax(gross: number, basis: TaxBasis): number {
  if (gross <= 0) return 0;
  const raw = basis.kind === "tabell" ? basis.monthlyDeduction : Math.round((gross * basis.percent) / 100);
  // Avdraget kan aldrig överstiga lönen: nettot får inte bli negativt.
  return Math.max(0, Math.min(raw, gross));
}

export function taxBasisLabel(basis: TaxBasis): string {
  return basis.kind === "tabell" ? `Tabell ${basis.table}` : `${basis.percent} %`;
}

/**
 * Tabelluppslaget gäller en viss lön. Ändras lönen är beloppet inte längre
 * hämtat ur rätt rad, och användaren måste slå upp det igen.
 */
export function taxLookupStale(basis: TaxBasis, gross: number): boolean {
  return basis.kind === "tabell" && basis.salaryAtLookup !== gross;
}

export function skatteverketTableUrl(): string {
  return "https://www.skatteverket.se/foretag/arbetsgivare/lamnaarbetsgivardeklaration/skattetabeller.4.html";
}

/* -------------------------- Arbetsgivaravgifter --------------------------- */

/**
 * Arbetsgivaravgifter enligt socialavgiftslagen. Satserna är lagstadgade och
 * ändras genom lagändring, inte per företag, så de ligger i koden med sin
 * regel intill – inte som en inställning användaren kan gissa fel på.
 *
 * Åldern räknas vid inkomstårets ingång, precis som lagen gör.
 */
export const FULL_CONTRIBUTION_PERCENT = 31.42;
export const PENSIONER_CONTRIBUTION_PERCENT = 10.21;
/** Nedsatt avgift från det år den anställde har fyllt 66 vid årets ingång. */
export const PENSIONER_AGE = 66;
/** Födda detta år eller tidigare betalar inga avgifter alls. */
export const NO_CONTRIBUTION_BORN_BEFORE = 1938;
/** Åldersgräns för att omfattas av lönemodellen alls. */
export const MIN_EMPLOYEE_AGE = 18;

export interface ContributionRate {
  percent: number;
  /** Kort etikett för lönespecifikation och verifikationstext. */
  label: string;
  /** Regeln som avgjorde satsen, i klartext. */
  reason: string;
}

export function contributionRateFor(birthDate: string, incomeYear: number): ContributionRate {
  const age = ageAtStartOfYear(birthDate, incomeYear);
  const birthYear = Number(birthDate.slice(0, 4));
  if (birthYear < NO_CONTRIBUTION_BORN_BEFORE) {
    return {
      percent: 0,
      label: "Inga avgifter",
      reason: `Född ${birthYear}: inga arbetsgivaravgifter betalas för den som är född före ${NO_CONTRIBUTION_BORN_BEFORE}.`,
    };
  }
  if (age >= PENSIONER_AGE) {
    return {
      percent: PENSIONER_CONTRIBUTION_PERCENT,
      label: `Ålderspensionsavgift ${fmtPercent(PENSIONER_CONTRIBUTION_PERCENT)} %`,
      reason: `${age} år vid ingången av ${incomeYear}: bara ålderspensionsavgift från det år den anställde fyllt ${PENSIONER_AGE} vid årets ingång.`,
    };
  }
  return {
    percent: FULL_CONTRIBUTION_PERCENT,
    label: `Arbetsgivaravgifter ${fmtPercent(FULL_CONTRIBUTION_PERCENT)} %`,
    reason: `${age} år vid ingången av ${incomeYear}: full avgift.`,
  };
}

function fmtPercent(p: number): string {
  return String(p).replace(".", ",");
}

export function employerContribution(gross: number, rate: ContributionRate): number {
  if (gross <= 0 || rate.percent === 0) return 0;
  return Math.round((gross * rate.percent) / 100);
}

/**
 * Ålder som lönemodellen kräver. Nedsatt avgift för ungdomar under 18 finns i
 * lagen men är inte implementerad – Driva stöder en anställd, ägaren, och en
 * styrelseledamot i ett aktiebolag är alltid myndig. Att räkna full avgift på en
 * sextonåring vore fel belopp, så fallet avvisas i stället för att gissas.
 */
export function contributionAgeError(birthDate: string, incomeYear: number): string | null {
  const age = ageAtStartOfYear(birthDate, incomeYear);
  if (age < MIN_EMPLOYEE_AGE) {
    return `Den anställde är ${age} år vid ingången av ${incomeYear}. Nedsatt arbetsgivaravgift för ungdomar under ${MIN_EMPLOYEE_AGE} år är inte implementerad i Driva.`;
  }
  return null;
}

/* ------------------------------ Lönekörning ------------------------------- */

export interface PayrollComputation {
  gross: number;
  tax: number;
  net: number;
  contribution: number;
  rate: ContributionRate;
  taxLabel: string;
}

/**
 * Hela lönekörningen ur bruttolön, skattegrund och födelsedatum. En enda källa
 * för siffrorna, så lönespecifikationen, verifikationen och AGI aldrig kan
 * räkna olika.
 */
export function computePayroll(args: {
  gross: number;
  taxBasis: TaxBasis;
  birthDate: string;
  incomeYear: number;
}): PayrollComputation {
  const gross = Math.round(args.gross);
  const rate = contributionRateFor(args.birthDate, args.incomeYear);
  const tax = preliminaryTax(gross, args.taxBasis);
  return {
    gross,
    tax,
    net: gross - tax,
    contribution: employerContribution(gross, rate),
    rate,
    taxLabel: taxBasisLabel(args.taxBasis),
  };
}

/* ------------------------ Arbetsgivardeklaration -------------------------- */

/**
 * Arbetsgivardeklarationen lämnas månaden efter utbetalningen, den 12:e.
 * Januari och augusti har den 17:e, samma undantag som momsen.
 */
export function agiDueDate(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const nextYear = m === 12 ? y + 1 : y;
  const nextMonth = m === 12 ? 1 : m + 1;
  const day = nextMonth === 1 || nextMonth === 8 ? 17 : 12;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTH_NAMES = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
];

export function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  const name = MONTH_NAMES[m - 1] ?? month.slice(5, 7);
  return `${name} ${month.slice(0, 4)}`;
}

export function isMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Sista dagen i månaden, YYYY-MM-DD. */
export function monthEnd(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(days).padStart(2, "0")}`;
}

export function nextMonthKey(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/* -------------------------------- Validering ------------------------------ */

export interface EmployeeInput {
  name: string;
  personnummer: string;
  email?: string;
  role: EmployeeRole;
  monthlySalary: number;
  taxBasis: TaxBasis;
  /** Anställningens första dag, YYYY-MM-DD. */
  startDate: string;
}

/**
 * Fel användaren kan rätta, som text. Kastas inte här – anropar kan välja att
 * visa dem i formuläret i stället för att fela.
 */
export function employeeInputErrors(input: EmployeeInput, today: string): string[] {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push("Namn saknas.");
  const birthDate = birthDateFromPersonnummer(input.personnummer, today);
  if (!birthDate) {
    errors.push("Personnummret går inte att tolka – skriv det som YYYYMMDD-NNNN.");
  }
  if (!Number.isFinite(input.monthlySalary) || input.monthlySalary <= 0) {
    errors.push("Månadslönen måste vara större än noll.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) {
    errors.push("Anställningsdatum anges som YYYY-MM-DD.");
  }
  if (input.taxBasis.kind === "procent") {
    const p = input.taxBasis.percent;
    if (!Number.isFinite(p) || p < 0 || p > 100) errors.push("Skattesatsen anges i procent mellan 0 och 100.");
  } else {
    const t = input.taxBasis.table;
    if (!Number.isInteger(t) || t < TAX_TABLE_MIN || t > TAX_TABLE_MAX) {
      errors.push(`Skattetabellen är ett tal mellan ${TAX_TABLE_MIN} och ${TAX_TABLE_MAX}.`);
    }
    const d = input.taxBasis.monthlyDeduction;
    if (!Number.isFinite(d) || d < 0) errors.push("Skatteavdraget enligt tabellen måste vara noll eller mer.");
    else if (Number.isFinite(input.monthlySalary) && d > input.monthlySalary) {
      errors.push("Skatteavdraget kan inte vara större än månadslönen – kontrollera raden i tabellen.");
    }
  }
  if (input.email && !input.email.includes("@")) errors.push("E-postadressen ser inte ut som en adress.");
  if (birthDate) {
    const ageError = contributionAgeError(birthDate, Number((input.startDate || today).slice(0, 4)));
    if (ageError) errors.push(ageError);
  }
  return errors;
}
