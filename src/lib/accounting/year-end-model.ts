import type { YearEndScheduleKind } from "../types";

/**
 * Bokslutsbilagornas begrepp: konton, etiketter och de rena beräkningarna.
 *
 * Utan lagringsberoende, så både serverkoden och klientwidgeten som visar
 * förhandsberäkningen kan läsa dem. Bokföringen ligger i year-end.ts.
 */

/* ------------------------------- Kontoplan -------------------------------- */

/** Upplupna semesterlöner. */
export const SEMESTERLONESKULD = 2920;
/** Förändring av semesterlöneskuld. */
export const SEMESTERLONESKULD_KOSTNAD = 7290;
/** Beräknade upplupna lagstadgade sociala avgifter. */
export const UPPLUPNA_SOCIALA_AVGIFTER = 2941;
/** Sociala avgifter för semester- och löneskulder. */
export const SOCIALA_AVGIFTER_SKULD_KOSTNAD = 7519;
/** Nedskrivning av kundfordringar. */
export const NEDSKRIVNING_KUNDFORDRINGAR = 1519;
/** Befarade förluster på kundfordringar. */
export const BEFARADE_KUNDFORLUSTER = 6352;
/** Periodiseringsfonder. */
export const PERIODISERINGSFOND = 2110;
/** Avsättning till periodiseringsfond. */
export const AVSATTNING_PERIODISERINGSFOND = 8811;
/** Återföring från periodiseringsfond. */
export const ATERFORING_PERIODISERINGSFOND = 8819;

export const SCHEDULE_LABEL: Record<YearEndScheduleKind, string> = {
  semesterloneskuld: "Semesterlöneskuld",
  kundfordringar_nedskrivning: "Nedskrivning av kundfordringar",
  periodiseringsfond: "Periodiseringsfond",
};

/** Vad bilagan svarar på, i en mening. */
export const SCHEDULE_PURPOSE: Record<YearEndScheduleKind, string> = {
  semesterloneskuld:
    "Semester som är intjänad men inte uttagen är en skuld till den anställde. Den hör till året den tjänades in, inte till året den betalas.",
  kundfordringar_nedskrivning:
    "En fordran som troligen inte blir betald ska inte stå kvar till fullt värde. Nedskrivningen är en bedömning – fordran finns kvar och kan betalas.",
  periodiseringsfond:
    "Ett aktiebolag får skjuta upp skatt på en del av vinsten. Skatten försvinner inte: den betalas det år fonden återförs, senast sjätte året efter avsättningen.",
};

/* --------------------------- Semesterlöneskuld ---------------------------- */

/**
 * Semesterlön för månadsavlönade enligt sammalöneregeln i semesterlagen:
 * den anställde behåller månadslönen under semestern och får dessutom ett
 * semestertillägg. Skulden för en intjänad men inte uttagen dag är därför
 * båda delarna.
 *
 * 4,6 % är dagens andel av månadslönen (en månad räknas som 21,75 arbetsdagar),
 * 0,43 % är semestertillägget per betald dag. Satserna är semesterlagens, inte
 * företagets, så de ligger i koden med regeln intill.
 */
export const SEMESTERLON_PER_DAG_PROCENT = 4.6;
export const SEMESTERTILLAGG_PER_DAG_PROCENT = 0.43;

/** Antal betalda semesterdagar semesterlagen ger som minimum. */
export const SEMESTERDAGAR_PER_AR = 25;

export interface VacationDayValue {
  /** Semesterlön för dagen. */
  semesterlon: number;
  /** Semestertillägg för dagen. */
  tillagg: number;
  /** Summan – vad en sparad dag är värd. */
  perDay: number;
}

export function vacationDayValue(monthlySalary: number): VacationDayValue {
  const semesterlon = Math.round((monthlySalary * SEMESTERLON_PER_DAG_PROCENT) / 100);
  const tillagg = Math.round((monthlySalary * SEMESTERTILLAGG_PER_DAG_PROCENT) / 100);
  return { semesterlon, tillagg, perDay: semesterlon + tillagg };
}

/* --------------------------- Periodiseringsfond --------------------------- */

/** Ett aktiebolag får sätta av högst 25 % av det skattemässiga resultatet. */
export const PERIODISERINGSFOND_MAX_ANDEL = 0.25;
/** Avsättningen ska vara återförd senast sjätte året efter avsättningsåret. */
export const PERIODISERINGSFOND_MAX_AR = 6;

/* ------------------------- Nedskrivning av fordran ------------------------- */

/** Dagar en förfallen fordran ska ha legat innan Driva föreslår nedskrivning. */
export const DOUBTFUL_AFTER_DAYS = 90;
