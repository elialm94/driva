/**
 * Prisbasbelopp per inkomstår (SCB/regeringen fastställer i höstas för nästa år).
 * Flera skatteregler hänger på det: gränsen för direktavdrag av inventarier
 * (ett halvt prisbasbelopp), det skattefria traktamentet (0,5 % avrundat till
 * tiotal kronor) och avgiftsfria nivåer i lönen. Ren data utan beroenden så
 * att både servern och klientens förhandsvisningar kan räkna på den.
 */
const PRISBASBELOPP_PER_AR: Record<number, number> = {
  2022: 48_300,
  2023: 52_500,
  2024: 57_300,
  2025: 58_800,
  2026: 59_200,
};

export function prisbasbeloppFor(year: number): number {
  const known = Object.keys(PRISBASBELOPP_PER_AR).map(Number);
  if (PRISBASBELOPP_PER_AR[year]) return PRISBASBELOPP_PER_AR[year];
  // Okänt år: närmaste kända (framtida år får senaste, äldre år får första).
  const clamped = Math.min(Math.max(year, Math.min(...known)), Math.max(...known));
  return PRISBASBELOPP_PER_AR[clamped];
}

/** Året ur ett ISO-datum, med innevarande år som reserv för skräp. */
export function yearOf(date: string | Date | undefined): number {
  const year = typeof date === "string" ? Number(date.slice(0, 4)) : date ? date.getFullYear() : NaN;
  return Number.isFinite(year) && year > 0 ? year : new Date().getFullYear();
}
