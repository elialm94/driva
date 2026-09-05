/** Svensk formattering av belopp, datum och relativ tid. */

import { DEFAULT_TIMEZONE, instantFromLocal, localParts } from "./reminders/when";

const krFmt = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  maximumFractionDigits: 0,
});

export function kr(n: number): string {
  return krFmt.format(Math.round(n));
}

const procentFmt = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 });

/** Procentsats med svenskt decimaltecken: 2,55 %. */
export function procent(n: number): string {
  return `${procentFmt.format(n)} %`;
}

const DAG_MS = 86_400_000;

// Formatterare återanvänds per options-uppsättning – konstruktorn är dyr och
// listor/attention-motorn formaterar tusentals datum per request.
const svFormatters = new Map<string, Intl.DateTimeFormat>();

const sv = (options: Intl.DateTimeFormatOptions) => {
  const key = JSON.stringify(options);
  let fmt = svFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: DEFAULT_TIMEZONE, ...options });
    svFormatters.set(key, fmt);
  }
  return fmt;
};

export function isoNow(): string {
  return new Date().toISOString();
}

/** Tidpunkt om `days` hela kalenderdagar, kl `hour`:`minute` svensk tid. */
export function isoDaysFromNow(days: number, hour = 10, minute = 0): string {
  const now = localParts(new Date(), DEFAULT_TIMEZONE);
  const d = new Date(Date.UTC(now.year, now.month - 1, now.day + days));
  return instantFromLocal(
    {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour,
      minute,
    },
    DEFAULT_TIMEZONE
  ).toISOString();
}

export function datumKort(iso: string): string {
  return sv({ day: "numeric", month: "short" }).format(new Date(iso));
}

export function datumLang(iso: string): string {
  return sv({
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

export function datumTid(iso: string): string {
  const d = new Date(iso);
  const datum = datumLang(iso);
  const tid = sv({ hour: "2-digit", minute: "2-digit" }).format(d);
  return `${datum}, ${tid}`;
}

export function datumNumeriskt(iso: string): string {
  return sv({ day: "numeric", month: "numeric", year: "numeric" }).format(new Date(iso));
}

function stockholmDayUtcNoon(d: Date): number {
  const p = localParts(d, DEFAULT_TIMEZONE);
  return Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0);
}

// "Idag" beräknas en gång per instant: samma `now` skickas in för varje rad i
// en lista, och default-fallet (ny Date per anrop) byter ms men sällan dygn.
let todayMemo: { ms: number; noon: number } | undefined;

function stockholmTodayUtcNoon(now: Date): number {
  const ms = now.getTime();
  if (todayMemo && todayMemo.ms === ms) return todayMemo.noon;
  const noon = stockholmDayUtcNoon(now);
  todayMemo = { ms, noon };
  return noon;
}

/** Hela kalenderdagar (svensk tid) mellan idag och datumet. Positivt = framtid. */
export function dagarTill(iso: string, now: Date = new Date()): number {
  return Math.round((stockholmDayUtcNoon(new Date(iso)) - stockholmTodayUtcNoon(now)) / DAG_MS);
}

export function dagarSedan(iso: string): number {
  return -dagarTill(iso);
}

export function relativ(iso: string): string {
  const diff = dagarTill(iso);
  if (diff === 0) return "idag";
  if (diff === 1) return "imorgon";
  if (diff === -1) return "igår";
  if (diff > 1) return `om ${diff} dagar`;
  return `för ${-diff} dagar sedan`;
}

/**
 * Hälsning efter klockan i Europe/Stockholm – inte serverns UTC
 * (Vercel visar annars "God natt" vid svensk morgon).
 */
export function halsning(date = new Date()): string {
  const h = localParts(date, DEFAULT_TIMEZONE).hour;
  if (h < 5) return "God natt";
  if (h < 10) return "God morgon";
  if (h < 12) return "God förmiddag";
  if (h < 18) return "God eftermiddag";
  return "God kväll";
}

/** "27 augusti" utan år – för rubriker. */
export function datumUtanAr(iso: string): string {
  return sv({ day: "numeric", month: "long" }).format(new Date(iso));
}

export function veckodag(iso: string): string {
  const s = sv({ weekday: "long" }).format(new Date(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
