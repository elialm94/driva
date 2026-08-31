import {
  defaultUnitForLineType,
  lineTypeOf,
  syncDocLineClassification,
  type LineKind,
} from "./economic-line-type";
import { parseOptionalHourlyRate } from "./settings-validation";
import type { DocLine, VatRate } from "./types";

export interface LinePriceDefaults {
  defaultHourlyRate?: number | null;
  defaultVatRate?: VatRate;
}

/**
 * Tolkat standardtimpris från inställningen. Tomt / null / undefined / 0 =
 * inte satt. 0 på inställningen är alltså "ingen default" – inte "0 kr/tim".
 */
export function resolvedHourlyRate(raw: unknown): number | undefined {
  const parsed = parseOptionalHourlyRate(raw);
  return parsed.ok ? parsed.value : undefined;
}

/**
 * À-pris som användaren inte har angett. 0 är ett giltigt, explicit pris
 * och räknas INTE som tomt. Använd null/undefined/"" för "inte satt".
 */
export function isUnsetUnitPrice(price: number | string | null | undefined): boolean {
  return price == null || price === "" || (typeof price === "number" && !Number.isFinite(price));
}

/** @deprecated Använd isUnsetUnitPrice – 0 är inte tomt. */
export function isEmptyUnitPrice(price: number | undefined | null): boolean {
  return isUnsetUnitPrice(price);
}

/** Tomt/ogiltigt → 0. 0 förblir 0. Negativa rabattrader behålls. */
export function canonicalizeUnitPrice(raw: number | string | null | undefined): number {
  if (isUnsetUnitPrice(raw)) return 0;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Välj ifyllt à-pris eller default. Nullish (??), aldrig || – 0 är ifyllt.
 */
export function pickUnitPrice(
  unitPrice: number | null | undefined,
  defaultUnitPrice: number | undefined
): number {
  return canonicalizeUnitPrice(unitPrice ?? defaultUnitPrice);
}

/**
 * Fyller tomma fält på en Arbete-rad. Skriver aldrig över ett explicit à-pris,
 * inte ens 0 kr. Material / Restid / Övrigt lämnas orörda. Används när en
 * Arbete-rad skapas eller när typen byts till Arbete med osatt pris – inte
 * när ett dokument skapas.
 */
export function applyArbeteLineDefaults<
  T extends {
    kind?: string;
    type?: string;
    unit?: string;
    unitPrice?: number | null;
    vatRate?: VatRate;
  },
>(line: T, defaults: LinePriceDefaults): T {
  if (lineTypeOf(line) !== "LABOR") {
    return { ...line, unitPrice: canonicalizeUnitPrice(line.unitPrice) };
  }
  const hourly = resolvedHourlyRate(defaults.defaultHourlyRate);
  const next = { ...line };
  if (!next.unit?.trim() || next.unit === "st") {
    next.unit = defaultUnitForLineType("LABOR");
  }
  if (isUnsetUnitPrice(next.unitPrice) && hourly != null) {
    next.unitPrice = hourly;
  }
  next.unitPrice = canonicalizeUnitPrice(next.unitPrice);
  if (next.vatRate == null && defaults.defaultVatRate != null) {
    next.vatRate = defaults.defaultVatRate;
  }
  return next;
}

/** Ny dokumentrad. `applyHourlyRate` styr om standardtimpriset får fylla osatt à-pris. */
export function createDocLine(
  kind: LineKind,
  defaults: LinePriceDefaults = {},
  options?: { id?: string; applyHourlyRate?: boolean }
): DocLine {
  const type = lineTypeOf({ kind });
  const line = syncDocLineClassification({
    id: options?.id ?? crypto.randomUUID(),
    kind,
    type,
    description: "",
    qty: 1,
    unit: defaultUnitForLineType(type),
    unitPrice: undefined as unknown as number,
    vatRate: defaults.defaultVatRate ?? 25,
  });
  if (options?.applyHourlyRate === false) {
    return { ...line, unitPrice: 0 };
  }
  return applyArbeteLineDefaults(line, defaults);
}
