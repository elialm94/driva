/**
 * Klientsäker del av uppdragslistan: filtertyper + avstämningslogik.
 * Ligger i egen modul (utan store-/fs-beroenden) eftersom klientkomponenten
 * uppdrag-list.tsx behöver funktionen – resten av job-list är serverkod.
 */
export type JobLifecycleFilter = "aktiva" | "klart" | "alla" | "arkiverade";
export type JobEconomyFilter = "alla" | "kvar" | "vantar" | "betalt";
export type JobSort = "standard" | "datum" | "kund" | "belopp";

/**
 * Pengafilter (kvar / väntar / betalt) tillämpas inom den valda
 * statusmängden. Pågår + Betalt ger pågående som är betalda – inte Alla.
 */
export function reconcileJobListFilters(input: {
  lifecycle: JobLifecycleFilter;
  economy: JobEconomyFilter;
  patch: Partial<{ lifecycle: JobLifecycleFilter; economy: JobEconomyFilter }>;
}): { lifecycle: JobLifecycleFilter; economy: JobEconomyFilter } {
  return {
    lifecycle: input.patch.lifecycle ?? input.lifecycle,
    economy: input.patch.economy ?? input.economy,
  };
}
