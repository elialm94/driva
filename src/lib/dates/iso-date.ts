/** Lokala kalenderdatum (YYYY-MM-DD) utan tidszon – för datumfält och väljare. */

export function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (date.getFullYear() !== Number(m[1]) || date.getMonth() !== Number(m[2]) - 1 || date.getDate() !== Number(m[3])) {
    return null;
  }
  return date;
}

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatDateDisplay(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

export function formatMonthTitle(year: number, month: number): string {
  return new Intl.DateTimeFormat("sv-SE", { month: "long", year: "numeric" }).format(new Date(year, month, 1));
}

export const WEEKDAYS_SHORT_SV = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"] as const;

export type CalendarCell = { date: Date; iso: string; outside: boolean };

export function monthCells(year: number, month: number): CalendarCell[] {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { date, iso: toISODate(date), outside: date.getMonth() !== month };
  });
}

export function parseClock(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(time.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function formatClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
