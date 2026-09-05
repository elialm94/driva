import { db } from "../store";

/**
 * Verifikationsserier. Varje serie har en egen obruten nummerföljd, vilket är
 * kravet i bokföringslagen: numren inom en serie får inte ha hål. Därför kan
 * serierna aldrig dela räknare.
 *
 * Serierna är fasta i koden, inte inställningar. Poängen är att en granskare
 * ska kunna läsa numret och veta varifrån bokningen kom: A-verifikationer har
 * ett underlag i systemet (faktura, kvitto, banktransaktion), M-verifikationer
 * är skrivna för hand och behöver därför alltid en bilaga eller en förklaring.
 */
export const VERIFICATION_SERIES = {
  /** Löpande bokföring ur produktens egna underlag och automatik. */
  A: "Löpande",
  /** Manuella verifikat, bokförda av ägaren eller redovisningskonsulten. */
  M: "Manuella verifikat",
} as const;

export type VerificationSeries = keyof typeof VERIFICATION_SERIES;

export const MAIN_SERIES: VerificationSeries = "A";
export const MANUAL_SERIES: VerificationSeries = "M";

export function isVerificationSeries(value: string): value is VerificationSeries {
  return Object.prototype.hasOwnProperty.call(VERIFICATION_SERIES, value);
}

export function seriesLabel(series: string): string {
  return isVerificationSeries(series) ? VERIFICATION_SERIES[series] : series;
}

/**
 * Nästa lediga nummer i serien, utan att ta det. Serie A läser den räknare som
 * fanns innan serier infördes, så gammal bokföring fortsätter på sitt nummer.
 */
export function nextNumberInSeries(series: string): number {
  const data = db();
  const counters = data.sequences.verificationSeries;
  const stored = counters?.[series];
  if (typeof stored === "number" && stored >= 1) return stored;
  return series === MAIN_SERIES ? data.sequences.verification : 1;
}

/**
 * Ta nästa nummer i serien. En enda synkron read-modify-write; numret kommer
 * aldrig från klienten. I Supabase-läge validerar app.post_verification samma
 * nummer med CAS mot databasens räknare, så två samtidiga bokföringar kan inte
 * få samma nummer.
 */
export function allocateNumberInSeries(series: string): number {
  const data = db();
  const number = nextNumberInSeries(series);
  const counters = (data.sequences.verificationSeries ??= {});
  counters[series] = number + 1;
  // Serie A speglas i den ursprungliga räknaren: den läses av äldre kod och av
  // business_sequences.verification i databasen.
  if (series === MAIN_SERIES) data.sequences.verification = number + 1;
  return number;
}
