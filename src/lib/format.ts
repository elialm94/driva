/** Svensk formattering av belopp, datum och relativ tid. */

const krFmt = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  maximumFractionDigits: 0,
});

export function kr(n: number): string {
  return krFmt.format(Math.round(n));
}

const DAG_MS = 86_400_000;

export function isoNow(): string {
  return new Date().toISOString();
}

export function isoDaysFromNow(days: number, hour = 10, minute = 0): string {
  const d = new Date(Date.now() + days * DAG_MS);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export function datumKort(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" }).format(new Date(iso));
}

export function datumLang(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

export function datumTid(iso: string): string {
  const d = new Date(iso);
  const datum = datumLang(iso);
  const tid = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(d);
  return `${datum}, ${tid}`;
}

export function datumNumeriskt(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE").format(new Date(iso));
}

function startOfDay(d: Date): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

/** Hela dagar mellan idag och datumet. Positivt = framtid, negativt = passerat. */
export function dagarTill(iso: string): number {
  return Math.round((startOfDay(new Date(iso)) - startOfDay(new Date())) / DAG_MS);
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

export function halsning(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "God natt";
  if (h < 10) return "God morgon";
  if (h < 12) return "God förmiddag";
  if (h < 18) return "God eftermiddag";
  return "God kväll";
}

/** "27 augusti" utan år – för rubriker. */
export function datumUtanAr(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long" }).format(new Date(iso));
}

export function veckodag(iso: string): string {
  const s = new Intl.DateTimeFormat("sv-SE", { weekday: "long" }).format(new Date(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
