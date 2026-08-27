import { findCustomersByName } from "../services/customers";
import type { Customer } from "../types";

export type CustomerMatch =
  | { kind: "one"; customer: Customer }
  | { kind: "many"; customers: Customer[]; query: string }
  | { kind: "none"; query: string };

export function resolveCustomerName(name: string): CustomerMatch {
  const query = name.trim();
  const customers = findCustomersByName(query);
  if (customers.length === 0) return { kind: "none", query };
  if (customers.length > 1) {
    const exact = customers.filter((c) => c.name.toLowerCase() === query.toLowerCase());
    if (exact.length === 1) return { kind: "one", customer: exact[0] };
    if (exact.length > 1) return { kind: "many", customers: exact, query };
    return { kind: "many", customers, query };
  }
  return { kind: "one", customer: customers[0] };
}

const WEEKDAYS: Record<string, number> = {
  sondag: 0,
  söndag: 0,
  mandag: 1,
  måndag: 1,
  tisdag: 2,
  onsdag: 3,
  torsdag: 4,
  fredag: 5,
  lordag: 6,
  lördag: 6,
};

const MONTHS = [
  "januari",
  "februari",
  "mars",
  "april",
  "maj",
  "juni",
  "juli",
  "augusti",
  "september",
  "oktober",
  "november",
  "december",
];

/** Relativa datum → ISO. LLM ska skicka ISO; detta används av regel-fallback. */
export function parseFlexibleDate(text: string, now = new Date()): string | null {
  const t = text.toLowerCase();
  const iso = t.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return new Date(`${iso[1]}T10:00:00`).toISOString();

  if (/\bidag\b/.test(t)) return at10(now).toISOString();
  if (/\bimorgon\b/.test(t)) return addDays(now, 1).toISOString();
  if (/\bövermorgon\b/.test(t)) return addDays(now, 2).toISOString();

  const nextWd = t.match(
    /nästa\s+(söndag|sondag|måndag|mandag|tisdag|onsdag|torsdag|fredag|lördag|lordag)/
  );
  if (nextWd) {
    const target = WEEKDAYS[nextWd[1].replace("ö", "o").replace("å", "a")] ?? WEEKDAYS[nextWd[1]];
    if (target != null) return nextWeekday(now, target).toISOString();
  }

  const monthRe = new RegExp(`(?:den\\s+)?(\\d{1,2})\\s+(${MONTHS.join("|")})(?:\\s+(20\\d{2}))?`);
  const m = t.match(monthRe);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = MONTHS.indexOf(m[2]);
    const year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
    const d = new Date(year, month, day, 10, 0, 0, 0);
    if (d < now && !m[3]) d.setFullYear(year + 1);
    return d.toISOString();
  }
  return null;
}

function at10(d: Date): Date {
  const x = new Date(d);
  x.setHours(10, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = at10(d);
  x.setDate(x.getDate() + n);
  return x;
}

function nextWeekday(now: Date, target: number): Date {
  const d = at10(now);
  const add = (target - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d;
}

export function parseAmountInclVat(text: string): number | null {
  const m = text.match(/(\d{1,3}(?:[ .\u00a0]\d{3})+|\d{3,})\s*(?:kr|:-|kronor)?/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[ .\u00a0]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

export function cap(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function isBankIdApprovalRequest(text: string): boolean {
  const t = text.toLowerCase();
  if (/påminn|följ upp|folj upp/.test(t) && !/(godkänn|godkann|signera)\s/.test(t)) return false;
  return (
    /(godkänn|godkann|signera).*(offert|avtal|bankid)/.test(t) ||
    /bankid.*(godkänn|godkann|signera)/.test(t)
  );
}
