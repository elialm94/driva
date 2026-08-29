/**
 * Deterministisk tidstolkning för påminnelser. ALL policy bor här och är
 * enhetstestbar utan LLM: modellen (eller den deterministiska snabbvägen)
 * extraherar ett STRUKTURERAT tidsuttryck ur svenskan, den här modulen
 * räknar ut tidpunkten.
 *
 * Dokumenterad policy:
 *  - Veckodagsregeln: är den namngivna veckodagen fortfarande FRAMFÖR oss i
 *    innevarande vecka → denna vecka. Idag eller redan passerad → nästa
 *    vecka. ("på onsdag" sagt en onsdag → nästa onsdag.)
 *    nextWeek=true ("nästa onsdag") hoppar alltid till nästa vecka även om
 *    dagen är framför oss i denna.
 *  - Ingen tid angiven → 10:00 lokal tid (DEFAULT_REMINDER_TIME).
 *  - Dagsdelar är central konfiguration (DAYPART_TIMES): morgon 09:00,
 *    förmiddag 10:00, eftermiddag 14:00, kväll 18:00. Ett objekt, används
 *    överallt.
 *  - "om 2 timmar" → exakt nu + 2 h.
 *  - Enbart dagsdel ("ikväll") som redan passerat idag → i morgon.
 *  - Tidszon: användarens semantik är ALLTID lokal tid (aldrig rå UTC).
 *    Tidszonen lagras på påminnelsen; svensk standard är Europe/Stockholm
 *    (DEFAULT_TIMEZONE) – strängen sprids inte i komponenter.
 */

export const DEFAULT_TIMEZONE = "Europe/Stockholm";

/** Standardtid när bara en dag är känd. */
export const DEFAULT_REMINDER_TIME = "10:00";

export const DAYPART_TIMES = {
  morgon: "09:00",
  förmiddag: "10:00",
  eftermiddag: "14:00",
  kväll: "18:00",
} as const;

export type Daypart = keyof typeof DAYPART_TIMES;
export const DAYPARTS = Object.keys(DAYPART_TIMES) as Daypart[];

export const WEEKDAYS_SV = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"] as const;
export type WeekdaySv = (typeof WEEKDAYS_SV)[number];

export type WhenExpression =
  /** Lokal väggtid "YYYY-MM-DDTHH:MM" (eller bara datum) i angiven tidszon. */
  | { kind: "isoDateTime"; value: string }
  /** Ett datum, valfritt med klockslag eller dagsdel. */
  | { kind: "date"; date: string; time?: string; daypart?: Daypart }
  /** Veckodag enligt veckodagsregeln ovan. */
  | { kind: "weekday"; weekday: WeekdaySv; nextWeek?: boolean; time?: string; daypart?: Daypart }
  /** Relativt nu – exakt. */
  | { kind: "relative"; minutes?: number; hours?: number; days?: number }
  /** Enbart dagsdel: idag, eller i morgon om den passerat. */
  | { kind: "daypart"; daypart: Daypart };

export interface ResolvedWhen {
  /** Absolut tidpunkt (ISO, UTC-instant). */
  dueAt: string;
  timezone: string;
  /** Sant när användaren angav klockslag eller dagsdel – styr när påminnelsen dyker upp. */
  hasExplicitTime: boolean;
}

/* ------------------------- Tidszonssäker datumräkning ------------------------ */

interface LocalParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  /** 0 = måndag … 6 = söndag (svensk veckouppfattning). */
  weekday: number;
}

const WD_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Läser instantens lokala delar i en tidszon via Intl – inga bibliotek. */
export function localParts(instant: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24, // "24" förekommer vid midnatt
    minute: Number(parts.minute),
    weekday: WD_INDEX[parts.weekday] ?? 0,
  };
}

/**
 * Lokal väggtid → UTC-instant i en tidszon. Gissa via UTC och korrigera med
 * differensen (två varv täcker DST-övergångar).
 */
export function instantFromLocal(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string
): Date {
  let guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  for (let i = 0; i < 2; i++) {
    const seen = localParts(new Date(guess), timezone);
    const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    const wantUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    guess += wantUtc - seenUtc;
  }
  return new Date(guess);
}

/** Start på den lokala dag som instanten faller på (som UTC-instant). */
export function startOfLocalDay(instant: Date, timezone: string): Date {
  const p = localParts(instant, timezone);
  return instantFromLocal({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0 }, timezone);
}

function parseClock(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(time.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2] ?? "0");
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function addDays(base: LocalParts, days: number): { year: number; month: number; day: number } {
  // Räkna i UTC-kalendern (ren datumaritmetik, tidszonen appliceras senare).
  const d = new Date(Date.UTC(base.year, base.month - 1, base.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/* --------------------------------- Upplösning -------------------------------- */

export type ResolveResult = { ok: true; value: ResolvedWhen } | { ok: false; error: string };

export function resolveWhen(expr: WhenExpression, now: Date, timezone: string): ResolveResult {
  const nowLocal = localParts(now, timezone);

  const finish = (
    date: { year: number; month: number; day: number },
    time: string | undefined,
    daypart: Daypart | undefined
  ): ResolveResult => {
    const clockStr = time ?? (daypart ? DAYPART_TIMES[daypart] : DEFAULT_REMINDER_TIME);
    const clock = parseClock(clockStr);
    if (!clock) return { ok: false, error: `Ogiltigt klockslag: ${clockStr}` };
    const instant = instantFromLocal({ ...date, ...clock }, timezone);
    return {
      ok: true,
      value: {
        dueAt: instant.toISOString(),
        timezone,
        hasExplicitTime: Boolean(time || daypart),
      },
    };
  };

  switch (expr.kind) {
    case "isoDateTime": {
      const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2})[:.](\d{2}))?$/.exec(expr.value.trim());
      if (!m) return { ok: false, error: `Ogiltigt datum: ${expr.value}` };
      const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
      return finish(date, m[4] != null ? `${m[4]}:${m[5]}` : undefined, undefined);
    }
    case "date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expr.date.trim());
      if (!m) return { ok: false, error: `Ogiltigt datum: ${expr.date}` };
      return finish({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }, expr.time, expr.daypart);
    }
    case "weekday": {
      const target = WEEKDAYS_SV.indexOf(expr.weekday);
      if (target < 0) return { ok: false, error: `Okänd veckodag: ${expr.weekday}` };
      // Veckodagsregeln: framför oss i veckan → denna vecka; idag/passerad → nästa.
      let daysAhead = (target - nowLocal.weekday + 7) % 7;
      if (daysAhead === 0) daysAhead = 7;
      // "nästa onsdag": hoppa en vecka till om dagen annars vore i denna vecka.
      if (expr.nextWeek && target > nowLocal.weekday) daysAhead += 7;
      return finish(addDays(nowLocal, daysAhead), expr.time, expr.daypart);
    }
    case "relative": {
      const ms =
        (expr.minutes ?? 0) * 60_000 + (expr.hours ?? 0) * 3_600_000 + (expr.days ?? 0) * 86_400_000;
      if (ms <= 0) return { ok: false, error: "Relativ tid måste vara framåt." };
      return {
        ok: true,
        value: { dueAt: new Date(now.getTime() + ms).toISOString(), timezone, hasExplicitTime: true },
      };
    }
    case "daypart": {
      const today = { year: nowLocal.year, month: nowLocal.month, day: nowLocal.day };
      const first = finish(today, undefined, expr.daypart);
      if (!first.ok) return first;
      // Dagsdelen har redan passerat idag → i morgon.
      if (Date.parse(first.value.dueAt) <= now.getTime()) {
        return finish(addDays(nowLocal, 1), undefined, expr.daypart);
      }
      return first;
    }
  }
}

/* ------------------------- Formatering för svar/kort ------------------------- */

/** "onsdag 2 september kl 10:00" – alltid i påminnelsens tidszon. */
export function formatDueAt(dueAtIso: string, timezone: string): string {
  const instant = new Date(dueAtIso);
  const day = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(instant);
  const time = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
  return `${day} kl ${time}`;
}
