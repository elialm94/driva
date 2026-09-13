import type { CustomerActivityKind, CustomerActivityRow } from "./customer-activity-model";

/**
 * Klientsortering av kundens aktivitetslista. Feedet kommer nyast först;
 * rubrikklick ändrar bara den filtrerade vyn.
 */

export const ACTIVITY_SORT_KEYS = ["datum", "handelse", "belopp", "status"] as const;
export type ActivitySortKey = (typeof ACTIVITY_SORT_KEYS)[number];
export type ActivitySortDirection = "asc" | "desc";

export interface ActivitySortState {
  key: ActivitySortKey;
  direction: ActivitySortDirection;
}

/** Standard: samma ordning som feedet (nyast först). */
export const DEFAULT_ACTIVITY_SORT: ActivitySortState = { key: "datum", direction: "desc" };

export type ActivityFilterKey = "alla" | CustomerActivityKind;

/** Första klicket: Belopp och Datum fallande, textkolumner stigande. */
export function defaultActivitySortDirection(key: ActivitySortKey): ActivitySortDirection {
  return key === "datum" || key === "belopp" ? "desc" : "asc";
}

export function nextActivitySort(clicked: ActivitySortKey, current: ActivitySortState): ActivitySortState {
  if (current.key !== clicked) {
    return { key: clicked, direction: defaultActivitySortDirection(clicked) };
  }
  return { key: clicked, direction: current.direction === "asc" ? "desc" : "asc" };
}

export function filterCustomerActivity(
  rows: CustomerActivityRow[],
  filter: ActivityFilterKey
): CustomerActivityRow[] {
  if (filter === "alla") return rows;
  return rows.filter((row) => (row.kinds ?? [row.kind]).includes(filter));
}

export function compareActivityRows(
  a: CustomerActivityRow,
  b: CustomerActivityRow,
  sort: ActivitySortState
): number {
  const dir = sort.direction === "asc" ? 1 : -1;
  let cmp = 0;
  switch (sort.key) {
    case "datum":
      cmp = a.at.localeCompare(b.at);
      break;
    case "handelse":
      cmp = a.title.localeCompare(b.title, "sv");
      break;
    case "belopp": {
      const aAmt = a.amount;
      const bAmt = b.amount;
      if (aAmt == null && bAmt == null) cmp = 0;
      else if (aAmt == null) return 1;
      else if (bAmt == null) return -1;
      else cmp = aAmt - bAmt;
      break;
    }
    case "status":
      cmp = a.statusLabel.localeCompare(b.statusLabel, "sv");
      break;
  }
  if (cmp !== 0) return cmp * dir;
  return b.at.localeCompare(a.at) || a.title.localeCompare(b.title, "sv");
}

export function sortCustomerActivity(
  rows: CustomerActivityRow[],
  sort: ActivitySortState
): CustomerActivityRow[] {
  return [...rows].sort((a, b) => compareActivityRows(a, b, sort));
}

export function visibleCustomerActivity(
  rows: CustomerActivityRow[],
  filter: ActivityFilterKey,
  sort: ActivitySortState
): CustomerActivityRow[] {
  return sortCustomerActivity(filterCustomerActivity(rows, filter), sort);
}

/** Första sidan i aktivitetslistan - resten bakom Visa fler. */
export const ACTIVITY_LIST_PAGE_SIZE = 20;

/**
 * Tomt filter (t.ex. Betalningar utan rader) får ett lågt golv, ungefär
 * 4-6 rader. En full lista ska bara vara så hög som sina rader - den
 * gamla reservationen mot ofiltrerad Alla-höjd lämnade ett stort hål.
 * Flikraden hålls stilla med scroll-lås i UI:t, inte med extra min-höjd.
 */
export const ACTIVITY_LIST_EMPTY_MIN_ROWS = 5;
export const ACTIVITY_LIST_HEAD_PX = 42;
export const ACTIVITY_LIST_ROW_PX = 64;
export const ACTIVITY_LIST_EMPTY_MIN_PX =
  ACTIVITY_LIST_HEAD_PX + ACTIVITY_LIST_EMPTY_MIN_ROWS * ACTIVITY_LIST_ROW_PX;

export function pageCustomerActivity<T>(rows: readonly T[], shown: number): T[] {
  return rows.slice(0, Math.max(0, shown));
}

/** Min-höjd bara när den synliga (filtrerade) listan är tom. */
export function activityListMinHeightPx(visibleCount: number): number {
  if (visibleCount > 0) return 0;
  return ACTIVITY_LIST_EMPTY_MIN_PX;
}
