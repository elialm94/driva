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

/** Tolkat standardtimpris. Tomt / 0 / ogiltigt = inte satt. */
export function resolvedHourlyRate(raw: unknown): number | undefined {
  const parsed = parseOptionalHourlyRate(raw);
  return parsed.ok ? parsed.value : undefined;
}

/** À-pris som användaren inte har fyllt i (noll eller saknas). */
export function isEmptyUnitPrice(price: number | undefined | null): boolean {
  return price == null || !Number.isFinite(price) || price === 0;
}

/**
 * Fyller tomma fält på en Arbete-rad. Skriver aldrig över ett ifyllt à-pris.
 * Material / Restid / Övrigt lämnas orörda. Används när en Arbete-rad skapas
 * eller när typen byts till Arbete med tomt pris – inte när ett dokument skapas.
 */
export function applyArbeteLineDefaults<
  T extends {
    kind?: string;
    type?: string;
    unit?: string;
    unitPrice?: number;
    vatRate?: VatRate;
  },
>(line: T, defaults: LinePriceDefaults): T {
  if (lineTypeOf(line) !== "LABOR") return line;
  const hourly = resolvedHourlyRate(defaults.defaultHourlyRate);
  const next = { ...line };
  if (!next.unit?.trim() || next.unit === "st") {
    next.unit = defaultUnitForLineType("LABOR");
  }
  if (isEmptyUnitPrice(next.unitPrice) && hourly != null) {
    next.unitPrice = hourly;
  }
  if (next.vatRate == null && defaults.defaultVatRate != null) {
    next.vatRate = defaults.defaultVatRate;
  }
  return next;
}

/** Ny dokumentrad. `applyHourlyRate` styr om standardtimpriset får fylla tomt à-pris. */
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
    unitPrice: 0,
    vatRate: defaults.defaultVatRate ?? 25,
  });
  if (options?.applyHourlyRate === false) return line;
  return applyArbeteLineDefaults(line, defaults);
}
