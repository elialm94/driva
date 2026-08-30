import type { EkonomiTab } from "./nav";

/**
 * Delad sortering för Ekonomi-registren (offerter, fakturor, utgifter, bank).
 * URL: ?sort=amount&direction=desc – samma mönster som flik/q/status/sida.
 * Utan parametrar: varje fliks befintliga standardordning (nyast först).
 */

export const ECONOMY_SORT_KEYS = ["document", "customer", "date", "amount"] as const;
export type EconomySortKey = (typeof ECONOMY_SORT_KEYS)[number];

export const ECONOMY_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type EconomySortDirection = (typeof ECONOMY_SORT_DIRECTIONS)[number];

export interface EconomySortState {
  key: EconomySortKey;
  direction: EconomySortDirection;
}

export interface EconomySortable {
  /** Dokumentnummer om det finns, annars null (t.ex. fakturautkast). */
  documentNumber: number | null;
  /** Titel / "#1042" / "Utkast" – fallback när nummer saknas. */
  documentLabel: string;
  customerName: string;
  /** ISO-datum eller -tid, inte formaterad visningstext. */
  date: string;
  /** Numeriskt belopp, inte "23 000 kr". */
  amount: number;
}

export interface EconomyRegisterQueryInput {
  q?: string;
  status?: string;
  page?: number;
  sort?: EconomySortState | null;
}

function isSortKey(value: string): value is EconomySortKey {
  return (ECONOMY_SORT_KEYS as readonly string[]).includes(value);
}

function isDirection(value: string): value is EconomySortDirection {
  return (ECONOMY_SORT_DIRECTIONS as readonly string[]).includes(value);
}

/** Ogiltiga / ofullständiga parametrar → null (standardordning). */
export function parseEconomySort(sort: unknown, direction: unknown): EconomySortState | null {
  const key = typeof sort === "string" && isSortKey(sort) ? sort : null;
  if (!key) return null;
  if (direction == null || direction === "") return { key, direction: "asc" };
  if (typeof direction === "string" && isDirection(direction)) return { key, direction };
  return null;
}

/** Första klicket på en kolumn = stigande, nästa = fallande. */
export function nextEconomySort(clicked: EconomySortKey, current: EconomySortState | null): EconomySortState {
  if (current?.key !== clicked) return { key: clicked, direction: "asc" };
  return { key: clicked, direction: current.direction === "asc" ? "desc" : "asc" };
}

function compareDocument(a: EconomySortable, b: EconomySortable): number {
  const aNum = a.documentNumber;
  const bNum = b.documentNumber;
  if (aNum != null && bNum != null && aNum !== bNum) return aNum - bNum;
  if (aNum != null && bNum == null) return 1;
  if (aNum == null && bNum != null) return -1;
  return a.documentLabel.localeCompare(b.documentLabel, "sv");
}

export function compareEconomyRows(a: EconomySortable, b: EconomySortable, sort: EconomySortState): number {
  const dir = sort.direction === "asc" ? 1 : -1;
  let cmp = 0;
  switch (sort.key) {
    case "document":
      cmp = compareDocument(a, b);
      break;
    case "customer":
      cmp = a.customerName.localeCompare(b.customerName, "sv");
      break;
    case "date":
      cmp = a.date.localeCompare(b.date);
      break;
    case "amount":
      cmp = a.amount - b.amount;
      break;
  }
  if (cmp !== 0) return cmp * dir;
  return compareDocument(a, b) || a.customerName.localeCompare(b.customerName, "sv");
}

export function economyMobileSortOptions(partyLabel: string): {
  value: string;
  label: string;
  sort: EconomySortState;
}[] {
  return [
    { value: "date:desc", label: "Senaste", sort: { key: "date", direction: "desc" } },
    { value: "date:asc", label: "Äldsta", sort: { key: "date", direction: "asc" } },
    { value: "customer:asc", label: `${partyLabel} A–Ö`, sort: { key: "customer", direction: "asc" } },
    { value: "customer:desc", label: `${partyLabel} Ö–A`, sort: { key: "customer", direction: "desc" } },
    { value: "amount:desc", label: "Högst belopp", sort: { key: "amount", direction: "desc" } },
    { value: "amount:asc", label: "Lägst belopp", sort: { key: "amount", direction: "asc" } },
  ];
}

export function economySortValue(sort: EconomySortState | null): string {
  if (!sort) return "date:desc";
  return `${sort.key}:${sort.direction}`;
}

export function parseEconomySortValue(value: string): EconomySortState | null {
  const [key, direction] = value.split(":");
  return parseEconomySort(key, direction);
}

export function ekonomiRegisterHref(tab: EkonomiTab, query: EconomyRegisterQueryInput): string {
  const sp = new URLSearchParams();
  sp.set("flik", tab);
  if (query.q) sp.set("q", query.q);
  if (query.status && query.status !== "alla") sp.set("status", query.status);
  if (query.sort) {
    sp.set("sort", query.sort.key);
    sp.set("direction", query.sort.direction);
  }
  if (query.page && query.page > 1) sp.set("sida", String(query.page));
  return `/ekonomi?${sp.toString()}`;
}
