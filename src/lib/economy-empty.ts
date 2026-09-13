/**
 * Utgifter har två sorters tomt, och de får inte se likadana ut.
 *
 * Utan en enda utgift är kvittorutan hela tomtillståndet: EN ruta som både
 * säger att det inte finns något än och tar emot det första kvittot. Så fort
 * det finns utgifter krymper rutan till en rad ovanför listan - fortfarande en
 * riktig släppyta, bara inte en tom skiva.
 *
 * Noll träffar efter sök eller statusfilter är något helt annat: utgifterna
 * finns, filtret döljer dem. Då står listans "Inget matchar" med Rensa kvar och
 * kvittorutan förblir en rad.
 */
export type ExpenseDropzoneMode = "empty-state" | "row";

/** Sök eller statusfilter aktivt: tomma listan beror på filtret, inte på tomt register. */
export function economyFilterActive(query: { q: string; status: string }): boolean {
  return Boolean(query.q) || query.status !== "alla";
}

export function expenseDropzoneMode(list: { total: number; q: string; status: string }): ExpenseDropzoneMode {
  return list.total === 0 && !economyFilterActive(list) ? "empty-state" : "row";
}
