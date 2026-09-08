import { db } from "../store";
import { kr } from "../format";
import { calendarFiscalYear, todayDate, vatDueDate, vatPeriodsOf } from "./dates";
import { vatPeriodicity, fiscalYears } from "./fiscal";
import { computeVatPosition } from "./vat";
import { agiDueDate, monthLabel, nextMonthKey } from "./payroll-model";
import { employees, employerDeclarations } from "./payroll";
import { annualReportDueDate, ink2DueDate } from "./deadlines";
import { annualReportFor } from "./annual-report";

/**
 * Kommande datum till Skatteverket (och Bolagsverket) – samma förfallodagar
 * som åtgärdskön, samlade till en kalender så företagaren ser året i ett svep
 * och kan lägga in det i sin egen kalender (ICS).
 */

export type AuthorityEventKind = "moms" | "agi" | "f_skatt" | "ink2" | "arsredovisning";

export type AuthorityEventStatus = "forfallen" | "snart" | "kommande" | "klar";

export interface AuthorityEvent {
  id: string;
  kind: AuthorityEventKind;
  title: string;
  subtitle: string;
  dueDate: string;
  /** Hela kronor, alltid positivt när det går att räkna ut. */
  amount?: number;
  href: string;
  status: AuthorityEventStatus;
  /** ICS UID – stabil över körningar så kalendern inte duplicerar. */
  uid: string;
}

const KIND_TITLE: Record<AuthorityEventKind, string> = {
  moms: "Moms",
  agi: "Arbetsgivardeklaration",
  f_skatt: "F-skatt",
  ink2: "Inkomstdeklaration",
  arsredovisning: "Årsredovisning",
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

function statusOf(dueDate: string, today: string, done: boolean): AuthorityEventStatus {
  if (done) return "klar";
  const days = daysBetween(today, dueDate);
  if (days < 0) return "forfallen";
  if (days <= 7) return "snart";
  return "kommande";
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function addMonths(month: string, n: number): string {
  let m = month;
  for (let i = 0; i < n; i++) m = nextMonthKey(m);
  return m;
}

/** Samma dagregel som AGI/moms: 12:e, 17:e i januari och augusti. */
export function fSkattDueDate(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const day = m === 1 || m === 8 ? 17 : 12;
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function vatEvents(today: string, until: string): AuthorityEvent[] {
  const data = db();
  const periodicity = vatPeriodicity(data);
  const year = Number(today.slice(0, 4));
  const out: AuthorityEvent[] = [];
  for (const y of [year - 1, year, year + 1]) {
    for (const period of vatPeriodsOf(calendarFiscalYear(y), periodicity)) {
      const due = vatDueDate(period);
      const report = data.vatReports.find((r) => r.periodStart === period.start && r.periodEnd === period.end);
      const declared = report?.status === "deklarerad";
      if (declared && (due < addDays(today, -45) || due > until)) continue;
      if (!declared && due > until) continue;
      const pos = declared && report ? { attBetala: report.attBetala } : computeVatPosition(period);
      const amount = Math.abs(pos.attBetala);
      const refund = pos.attBetala < 0;
      if (!declared && amount === 0 && period.end < today) continue;
      out.push({
        id: `moms-${period.key}`,
        kind: "moms",
        title: `Moms ${period.label}`,
        subtitle: declared
          ? refund
            ? `${kr(amount)} tillgodofördes skattekontot`
            : amount
              ? `${kr(amount)} deklarerad`
              : "Deklarerad · ingen moms"
          : refund
            ? `${kr(amount)} att få tillbaka · deklareras senast ${due}`
            : amount
              ? `${kr(amount)} ska finnas på skattekontot senast ${due}`
              : `Deklareras senast ${due}`,
        dueDate: due,
        amount,
        href: `/bokforing/moms?fokus=${period.key}`,
        status: statusOf(due, today, declared),
        uid: `moms-${period.key}@driva`,
      });
    }
  }
  return out;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function agiEvents(today: string, until: string): AuthorityEvent[] {
  if (!employees().length && !employerDeclarations().length) return [];
  const known = new Map(employerDeclarations().map((d) => [d.month, d]));
  const start = addMonths(monthKey(today), -2);
  const out: AuthorityEvent[] = [];
  let month = start;
  for (let i = 0; i < 8; i++) {
    const due = agiDueDate(month);
    if (due <= until) {
      const decl = known.get(month);
      const declared = decl?.status === "deklarerad";
      const amount = decl?.attBetala;
      const empty = decl && decl.rows.length === 0 && decl.status === "utkast";
      if (!empty) {
        out.push({
          id: `agi-${month}`,
          kind: "agi",
          title: `Arbetsgivardeklaration ${monthLabel(month)}`,
          subtitle: declared
            ? `${amount != null ? `${kr(amount)} · ` : ""}lämnad`
            : `Lämnas senast ${due}${amount != null ? ` · ${kr(amount)}` : ""}`,
          dueDate: due,
          amount,
          href: "/bokforing/lon",
          status: statusOf(due, today, declared),
          uid: `agi-${month}@driva`,
        });
      }
    }
    month = nextMonthKey(month);
  }
  return out;
}

function fSkattEvents(today: string, until: string): AuthorityEvent[] {
  const amount = db().settings.fSkattPerMonth;
  if (!amount) return [];
  const out: AuthorityEvent[] = [];
  let month = monthKey(today);
  for (let i = 0; i < 6; i++) {
    const due = fSkattDueDate(month);
    if (due >= today && due <= until) {
      out.push({
        id: `fskatt-${month}`,
        kind: "f_skatt",
        title: `F-skatt ${monthLabel(month)}`,
        subtitle: `${kr(amount)} dras från skattekontot ${due}`,
        dueDate: due,
        amount,
        href: "/bokforing/skattekonto",
        status: statusOf(due, today, false),
        uid: `fskatt-${month}@driva`,
      });
    }
    month = nextMonthKey(month);
  }
  return out;
}

function yearEndEvents(today: string, until: string): AuthorityEvent[] {
  const isAb = (db().settings.companyForm ?? "ab") === "ab";
  const out: AuthorityEvent[] = [];
  for (const fy of fiscalYears()) {
    if (!isAb) continue;
    const ink2 = ink2DueDate(fy);
    if (fy.endDate < today || ink2 <= until) {
      const closed = fy.status === "stangt";
      out.push({
        id: `ink2-${fy.id}`,
        kind: "ink2",
        title: `Inkomstdeklaration ${fy.label}`,
        subtitle: closed ? `Deklareras senast ${ink2}` : `Bokslut ${fy.label} · deklareras senast ${ink2}`,
        dueDate: ink2,
        href: "/bokforing/bokslut",
        status: statusOf(ink2, today, false),
        uid: `ink2-${fy.id}@driva`,
      });
    }
    const ars = annualReportDueDate(fy);
    if (fy.endDate < today || ars <= until) {
      const report = annualReportFor(fy.id);
      const done = report?.status === "inlamnad_markerad";
      out.push({
        id: `ars-${fy.id}`,
        kind: "arsredovisning",
        title: `Årsredovisning ${fy.label}`,
        subtitle: done
          ? `Inlämnad till Bolagsverket`
          : `Bolagsverket senast ${ars}`,
        dueDate: ars,
        href: `/bokforing/bokslut/arsredovisning/${fy.id}`,
        status: statusOf(ars, today, Boolean(done)),
        uid: `ars-${fy.id}@driva`,
      });
    }
  }
  return out;
}

/**
 * Alla myndighetsdatum från 45 dagar bakåt till `horizonDays` framåt.
 * Klara poster (deklarerad moms, lämnad AGI, inlämnad årsredovisning) följer
 * med så kalendern visar vad som redan är gjort.
 */
export function authorityCalendar(today: string = todayDate(), horizonDays = 180): AuthorityEvent[] {
  const until = addDays(today, horizonDays);
  const events = [
    ...vatEvents(today, until),
    ...agiEvents(today, until),
    ...fSkattEvents(today, until),
    ...yearEndEvents(today, until),
  ];
  return events.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
}

/** Det som syns på Bokföring → Kommande: inte klara, inom horisonten. */
export function upcomingAuthorityEvents(today: string = todayDate(), horizonDays = 180): AuthorityEvent[] {
  return authorityCalendar(today, horizonDays).filter((e) => e.status !== "klar");
}

export function authorityKindLabel(kind: AuthorityEventKind): string {
  return KIND_TITLE[kind];
}

function icsEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function icsDate(date: string): string {
  return date.replace(/-/g, "");
}

function foldLine(line: string): string {
  if (line.length <= 74) return line;
  const parts = [line.slice(0, 74)];
  let rest = line.slice(74);
  while (rest.length > 73) {
    parts.push(` ${rest.slice(0, 73)}`);
    rest = rest.slice(73);
  }
  if (rest) parts.push(` ${rest}`);
  return parts.join("\r\n");
}

/** iCalendar för de öppna posterna – en heldag per förfallodag. */
export function authorityCalendarIcs(opts: {
  today?: string;
  companyName?: string;
  origin?: string;
} = {}): string {
  const today = opts.today ?? todayDate();
  const events = upcomingAuthorityEvents(today);
  const stamp = `${today.replace(/-/g, "")}T090000Z`;
  const name = opts.companyName?.trim() || db().settings.name;
  const origin = (opts.origin ?? "").replace(/\/$/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Driva//Skatteverket//SV",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(`Skatteverket · ${name}`)}`,
  ];
  for (const e of events) {
    const url = origin ? `${origin}${e.href}` : e.href;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.dueDate)}`,
      `SUMMARY:${icsEscape(e.title)}`,
      `DESCRIPTION:${icsEscape(e.subtitle)}`,
      `URL:${icsEscape(url)}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

