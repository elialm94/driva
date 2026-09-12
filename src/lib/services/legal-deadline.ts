import { db } from "../store";
import { calendarFiscalYear, todayDate, vatDueDate, vatPeriodsOf } from "../accounting/dates";
import { getFiscalYear, vatPeriodicity } from "../accounting/fiscal";
import { annualReportDueDate, ink2DueDate } from "../accounting/deadlines";
import { agiDueDate } from "../accounting/payroll-model";
import { vatPeriodByKey, vatReportForPeriod } from "../accounting/vat";
import { dueDateFromLegalActionId } from "./legal-deadline-id";

export {
  dueDateFromLegalActionId,
  isLegalDeadlineAction,
  legalDeadlineSnoozeCap,
} from "./legal-deadline-id";

/**
 * Förfallodag för en lagkravsrad i kön (moms, AGI, INK2, årsredovisning).
 * Används av snooze-policyn: förfallen rad kan inte tystas, kommande rad
 * snoozas högst till dagen före förfall.
 */
export function legalDeadlineDueDate(actionId: string): string | undefined {
  if (actionId.startsWith("agi-")) {
    const month = actionId.slice("agi-".length);
    return /^\d{4}-\d{2}$/.test(month) ? agiDueDate(month) : undefined;
  }
  if (actionId.startsWith("vat-") && actionId !== "vat-multiple" && !actionId.startsWith("vat-suggest-")) {
    const period = vatPeriodByKey(actionId.slice("vat-".length));
    return period ? vatDueDate(period) : undefined;
  }
  if (actionId === "vat-multiple") return earliestOpenVatDue();
  if (actionId.startsWith("year-end-close-")) {
    const fy = getFiscalYear(actionId.slice("year-end-close-".length));
    return fy ? ink2DueDate(fy) : undefined;
  }
  if (actionId.startsWith("year-end-report-")) {
    const fy = getFiscalYear(actionId.slice("year-end-report-".length));
    return fy ? annualReportDueDate(fy) : undefined;
  }
  return undefined;
}

export function isLegalDeadlineOverdue(actionId: string, today: string = todayDate()): boolean {
  const due = legalDeadlineDueDate(actionId) ?? dueDateFromLegalActionId(actionId);
  return Boolean(due && due < today);
}

function earliestOpenVatDue(): string | undefined {
  const today = todayDate();
  const year = Number(today.slice(0, 4));
  const periodicity = vatPeriodicity(db());
  let earliest: string | undefined;
  for (const y of [year - 1, year]) {
    for (const period of vatPeriodsOf(calendarFiscalYear(y), periodicity)) {
      if (period.end >= today) continue;
      if (vatReportForPeriod(period.key)?.status === "deklarerad") continue;
      const due = vatDueDate(period);
      if (!earliest || due < earliest) earliest = due;
    }
  }
  return earliest;
}
