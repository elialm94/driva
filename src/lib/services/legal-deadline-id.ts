import { previousDay, todayDate, vatDueDate, type Period } from "../accounting/dates";
import { agiDueDate } from "../accounting/payroll-model";

/**
 * Förfallodag ur åtgärds-id, utan att läsa lagret. Används av
 * `controlsForAction` i klienten. Server-snooze använder den fulla
 * uppslagningen i legal-deadline.ts när id:t inte räcker (year-end, flera
 * momsperioder).
 */
export function dueDateFromLegalActionId(actionId: string): string | undefined {
  if (actionId.startsWith("agi-")) {
    const month = actionId.slice("agi-".length);
    return /^\d{4}-\d{2}$/.test(month) ? agiDueDate(month) : undefined;
  }
  if (actionId.startsWith("vat-") && actionId !== "vat-multiple" && !actionId.startsWith("vat-suggest-")) {
    const period = periodFromVatActionKey(actionId.slice("vat-".length));
    return period ? vatDueDate(period) : undefined;
  }
  return undefined;
}

export function isLegalDeadlineAction(actionId: string): boolean {
  return (
    (actionId.startsWith("vat-") && !actionId.startsWith("vat-suggest-")) ||
    actionId.startsWith("agi-") ||
    actionId.startsWith("year-end-")
  );
}

export function isLegalDeadlineOverdueFromId(actionId: string, today: string = todayDate()): boolean {
  const due = dueDateFromLegalActionId(actionId);
  return Boolean(due && due < today);
}

/** Dagen före förfallodagen kl 08:00 lokal tid – yttersta snooze för ett kommande lagkrav. */
export function legalDeadlineSnoozeCap(
  dueDate: string,
  _tz?: string
): { year: number; month: number; day: number; hour: number; minute: number } {
  const cap = previousDay(dueDate);
  return {
    year: Number(cap.slice(0, 4)),
    month: Number(cap.slice(5, 7)),
    day: Number(cap.slice(8, 10)),
    hour: 8,
    minute: 0,
  };
}

function periodFromVatActionKey(key: string): Period | undefined {
  const quarter = key.match(/^(\d{4})-K([1-4])$/);
  if (quarter) {
    const year = quarter[1];
    const n = Number(quarter[2]);
    const startMonth = (n - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return {
      key,
      label: key,
      start: `${year}-${pad2(startMonth)}-01`,
      end: `${year}-${pad2(endMonth)}-${lastDayOfMonth(Number(year), endMonth)}`,
    };
  }
  const month = key.match(/^(\d{4})-(\d{2})$/);
  if (month) {
    const year = Number(month[1]);
    const m = Number(month[2]);
    if (m < 1 || m > 12) return undefined;
    return {
      key,
      label: key,
      start: `${month[1]}-${month[2]}-01`,
      end: `${month[1]}-${month[2]}-${lastDayOfMonth(year, m)}`,
    };
  }
  const year = key.match(/^(\d{4})-H$/);
  if (year) {
    return { key, label: key, start: `${year[1]}-01-01`, end: `${year[1]}-12-31` };
  }
  return undefined;
}

function lastDayOfMonth(year: number, month: number): string {
  return String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
