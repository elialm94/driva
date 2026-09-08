/**
 * ROT/RUT ska begäras senast 31 januari året efter arbetet utfördes
 * och kunden betalade. Driva skickar inte ansökan – den här ytan
 * påminner så pengarna inte glöms.
 */
export const ROT_APPLICATION_DEADLINE_MONTH = 1;
export const ROT_APPLICATION_DEADLINE_DAY = 31;

export function rotApplicationDeadlineYear(workYear: number): number {
  return workYear + 1;
}

export function rotApplicationDeadlineDate(workYear: number): string {
  const y = rotApplicationDeadlineYear(workYear);
  return `${y}-01-31`;
}

export function isRotDeadlineWindow(today: string): boolean {
  const month = Number(today.slice(5, 7));
  return month === 1;
}

export type RotDeadlineStatus = NonNullable<ReturnType<typeof rotDeadlineStatus>>;

export function rotDeadlineStatus(input: {
  today: string;
  workEndDate?: string;
  paidAt?: string;
  applied: boolean;
}): { due: boolean; deadline: string; workYear: number; daysLeft: number } | null {
  const end = (input.paidAt || input.workEndDate || "").slice(0, 10);
  if (!end) return null;
  const workYear = Number(end.slice(0, 4));
  if (!Number.isFinite(workYear)) return null;
  const deadline = rotApplicationDeadlineDate(workYear);
  if (input.applied) return null;
  if (input.today > deadline) {
    return { due: true, deadline, workYear, daysLeft: 0 };
  }
  if (!isRotDeadlineWindow(input.today) && input.today.slice(0, 4) !== String(workYear + 1)) {
    // Visa i januari, eller om deadlinen redan passerat (hanterat ovan).
    if (input.today < `${workYear}-12-01`) return null;
  }
  const daysLeft = Math.max(
    0,
    Math.round((Date.parse(`${deadline}T12:00:00Z`) - Date.parse(`${input.today}T12:00:00Z`)) / 86_400_000)
  );
  if (input.today >= `${workYear}-12-01` || isRotDeadlineWindow(input.today)) {
    return { due: input.today >= deadline, deadline, workYear, daysLeft };
  }
  return null;
}
