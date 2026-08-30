/**
 * Klientsäker del av uppdragslistan: filtertyper + avstämningslogik.
 * Ligger i egen modul (utan store-/fs-beroenden) eftersom klientkomponenten
 * uppdrag-list.tsx behöver funktionen – resten av job-list är serverkod.
 */
export type JobLifecycleFilter = "aktiva" | "planerade" | "klart" | "alla" | "arkiverade";
export type JobEconomyFilter = "alla" | "kvar" | "vantar" | "betalt";
export type JobSort = "standard" | "datum" | "kund" | "belopp";

/**
 * Betalt uppdrag är i praktiken klara. "Aktiva"/"Planerade" + "Betalt"
 * ger en tom lista – när användaren väljer den ena släpper vi den andra.
 */
export function reconcileJobListFilters(input: {
  lifecycle: JobLifecycleFilter;
  economy: JobEconomyFilter;
  patch: Partial<{ lifecycle: JobLifecycleFilter; economy: JobEconomyFilter }>;
}): { lifecycle: JobLifecycleFilter; economy: JobEconomyFilter } {
  const next = {
    lifecycle: input.patch.lifecycle ?? input.lifecycle,
    economy: input.patch.economy ?? input.economy,
  };
  if (next.economy !== "betalt") return next;
  if (next.lifecycle !== "aktiva" && next.lifecycle !== "planerade") return next;
  if ("economy" in input.patch) return { ...next, lifecycle: "alla" };
  if ("lifecycle" in input.patch) return { ...next, economy: "alla" };
  return next;
}
