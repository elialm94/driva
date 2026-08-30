/**
 * Hel-yttrande-skanning: intent, kandidater och rättelsemarkörer.
 *
 * Första giltiga träff vinner INTE. Hela meningen skannas så att
 * korrektionslagret (corrections.ts) kan välja den SENASTE tydliga
 * rättelsen. Röst och text går samma väg – ett färdigt transkript
 * är bara en sträng.
 */

import { WEEKDAYS_SV, type WeekdaySv } from "../reminders/when";

export type UtteranceIntent =
  | "create_reminder"
  | "create_invoice"
  | "create_quote"
  | "create_customer"
  | "unknown";

export type ArgKind = "time" | "weekday" | "date" | "amount" | "quantity" | "name" | "phone";

export interface Span {
  start: number;
  end: number;
  raw: string;
}

export interface ArgCandidate extends Span {
  kind: ArgKind;
  /** Kanoniskt värde: "10:00", "onsdag", 12000, 7, "Sara", "073…". */
  value: string | number;
  /** Sant för "nästa onsdag". */
  nextWeek?: boolean;
}

export type MarkerKind = "correction" | "negation" | "alternative";

export interface UtteranceMarker extends Span {
  kind: MarkerKind;
}

/** Hopfäll whitespace så index i kandidater/markörer är jämförbara. */
export function collapseUtterance(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isPaymentReminderUtterance(text: string): boolean {
  return /^\s*skicka\s+(?:en\s+)?påminnelse/i.test(text.trim());
}

/**
 * Explicit intern påminnelse – var som helst i meningen, inte bara
 * "påminn mig …" som prefix. Betalningspåminnelse och faktura/offert vinner.
 */
const REMINDER_SIGNAL_RE =
  /\b(?:påminn(?:a|else|d)?|bli\s+påmind|kom\s+ihåg(?:\s+att)?|lägg\s+(?:in|till)\s+(?:en\s+)?påminnelse)\b/i;

const INVOICE_SIGNAL_RE = /\b(?:fakturera|skapa(?:\s+en)?\s+(?:ny\s+)?faktura|ny faktura)\b/i;
const QUOTE_SIGNAL_RE = /\b(?:offerera|skapa(?:\s+en)?\s+(?:ny\s+)?offert|ny offert)\b/i;

export function isInternalReminderIntent(text: string): boolean {
  const t = collapseUtterance(text);
  if (!t || isPaymentReminderUtterance(t)) return false;
  if (INVOICE_SIGNAL_RE.test(t) || QUOTE_SIGNAL_RE.test(t)) return false;
  return REMINDER_SIGNAL_RE.test(t);
}

export function identifyUtteranceIntent(text: string): UtteranceIntent {
  const t = collapseUtterance(text);
  if (!t) return "unknown";
  if (isPaymentReminderUtterance(t)) return "unknown";
  if (INVOICE_SIGNAL_RE.test(t)) return "create_invoice";
  if (QUOTE_SIGNAL_RE.test(t)) return "create_quote";
  if (/\b(?:ny kund|skapa kund|lägg till kund)\b/i.test(t)) return "create_customer";
  if (/\btelefon\b/i.test(t) && extractPhoneCandidates(t).length > 0) return "create_customer";
  if (isInternalReminderIntent(t)) return "create_reminder";
  return "unknown";
}

/* -------------------------------- Markörer -------------------------------- */

/** JS `\b` räknar inte å/ä/ö som ordtecken – "ändra" skulle annars missas. */
const WB = "(?:(?<=^|[^A-Za-zÅÄÖåäö])(?=[A-Za-zÅÄÖåäö])|(?<=[A-Za-zÅÄÖåäö])(?=$|[^A-Za-zÅÄÖåäö]))";

const MARKER_SPECS: { re: RegExp; kind: MarkerKind }[] = [
  { re: new RegExp(`${WB}nej\\s+förresten${WB}`, "gi"), kind: "correction" },
  { re: new RegExp(`${WB}eller\\s+vänta${WB}`, "gi"), kind: "correction" },
  { re: new RegExp(`${WB}jag\\s+menar${WB}`, "gi"), kind: "correction" },
  { re: new RegExp(`${WB}ändra\\s+till${WB}`, "gi"), kind: "correction" },
  { re: new RegExp(`${WB}gör\\s+det${WB}`, "gi"), kind: "correction" },
  { re: new RegExp(`${WB}eller\\s+kanske${WB}`, "gi"), kind: "alternative" },
  { re: new RegExp(`${WB}i\\s+stället${WB}`, "gi"), kind: "correction" },
  { re: new RegExp(`${WB}istället${WB}`, "gi"), kind: "correction" },
  { re: new RegExp(`${WB}förresten${WB}`, "gi"), kind: "correction" },
  { re: new RegExp(`${WB}snarare${WB}`, "gi"), kind: "correction" },
  { re: new RegExp(`${WB}använd(?:a)?${WB}`, "gi"), kind: "correction" },
  { re: new RegExp(`${WB}eller${WB}`, "gi"), kind: "alternative" },
  { re: new RegExp(`${WB}kanske${WB}`, "gi"), kind: "alternative" },
  { re: new RegExp(`${WB}nej${WB}`, "gi"), kind: "correction" },
  { re: new RegExp(`${WB}inte${WB}`, "gi"), kind: "negation" },
  { re: new RegExp(`${WB}utan${WB}`, "gi"), kind: "correction" },
];

function collectMatches(text: string, re: RegExp): Span[] {
  const out: Span[] = [];
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const copy = new RegExp(re.source, flags);
  let m: RegExpExecArray | null;
  while ((m = copy.exec(text))) {
    out.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
    if (m[0].length === 0) copy.lastIndex += 1;
  }
  return out;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Längsta markör vinner vid överlapp ("nej förresten" före "nej"). */
export function findCorrectionMarkers(text: string): UtteranceMarker[] {
  const found: UtteranceMarker[] = [];
  for (const spec of MARKER_SPECS) {
    for (const span of collectMatches(text, spec.re)) {
      if (found.some((f) => overlaps(f, span))) continue;
      found.push({ ...span, kind: spec.kind });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

export function hasCorrectionLanguage(text: string): boolean {
  return findCorrectionMarkers(text).some((m) => m.kind === "correction" || m.kind === "negation");
}

/* ------------------------------- Kandidater ------------------------------- */

const WEEKDAY_RE = new RegExp(`\\b(?:(nästa)\\s+)?(?:på\\s+)?(${WEEKDAYS_SV.join("|")})\\b`, "gi");

const CLOCK_RE = /\bkl(?:ockan)?\.?\s*(\d{1,2})(?:[:.](\d{2}))?\b/gi;
const BARE_CLOCK_RE = /\b(\d{1,2})[:.](\d{2})\b/g;
const PHONE_RE = /\b(0\d{1,3}[\s-]?\d{2,3}[\s-]?\d{2}[\s-]?\d{2,3})\b/g;
const AMOUNT_RE = /(\d{1,3}(?:[ .\u00a0]\d{3})+|\d{4,})\s*(?:kr|:-|kronor)?/gi;
const QUANTITY_RE = /\b(\d+(?:[.,]\d+)?)\s*timm(?:e|ar)\b/gi;
const DATE_RE = /\b(i\s+övermorgon|i\s?morgon|idag)\b/gi;
const NAME_RE = /\b([A-ZÅÄÖ][a-zåäöé]+)(?:\s+[A-ZÅÄÖ][a-zåäöé]+)?\b/g;

const NAME_STOP = new Set([
  "nej",
  "förresten",
  "ändra",
  "menar",
  "vänta",
  "snarare",
  "istället",
  "utan",
  "kanske",
  "eller",
  "ring",
  "ringa",
  "skapa",
  "faktura",
  "offert",
  "påminnelse",
  "påminn",
  "telefon",
  "använd",
  "arbete",
  "timmar",
  "timme",
  "klockan",
  "måndag",
  "tisdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lördag",
  "söndag",
]);

export function padClock(hour: number, minute: number): string {
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

function parseClockParts(h: string, m?: string): { hour: number; minute: number } | null {
  const hour = Number(h);
  const minute = m != null ? Number(m) : 0;
  if (!Number.isFinite(hour) || hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function extractTimeCandidates(text: string): ArgCandidate[] {
  const out: ArgCandidate[] = [];
  for (const span of collectMatches(text, CLOCK_RE)) {
    const m = /\bkl(?:ockan)?\.?\s*(\d{1,2})(?:[:.](\d{2}))?\b/i.exec(span.raw);
    if (!m) continue;
    const clock = parseClockParts(m[1], m[2]);
    if (!clock) continue;
    out.push({ kind: "time", value: padClock(clock.hour, clock.minute), ...span });
  }
  for (const span of collectMatches(text, BARE_CLOCK_RE)) {
    if (out.some((c) => overlaps(c, span))) continue;
    const m = /(\d{1,2})[:.](\d{2})/.exec(span.raw);
    if (!m) continue;
    const clock = parseClockParts(m[1], m[2]);
    if (!clock) continue;
    out.push({ kind: "time", value: padClock(clock.hour, clock.minute), ...span });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Nakna timtal (0–23) som kandidater – bara när de sitter i en
 * rättelse/alternativ-kontext ("12 eller 10", "inte 12 utan 10").
 */
export function extractBareHourCandidates(text: string, markers: UtteranceMarker[]): ArgCandidate[] {
  const out: ArgCandidate[] = [];
  const re = /\b(\d{1,2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const hour = Number(m[1]);
    if (!Number.isFinite(hour) || hour > 23) continue;
    const span: Span = { start: m.index, end: m.index + m[0].length, raw: m[0] };
    const nearby = markers.some((mk) => Math.abs(mk.end - span.start) <= 16 || Math.abs(span.end - mk.start) <= 16);
    if (!nearby) continue;
    out.push({ kind: "time", value: padClock(hour, 0), ...span });
  }
  return out;
}

export function extractWeekdayCandidates(text: string): ArgCandidate[] {
  const out: ArgCandidate[] = [];
  for (const span of collectMatches(text, WEEKDAY_RE)) {
    const m = /(?:(nästa)\s+)?(?:på\s+)?([a-zåäö]+)/i.exec(span.raw);
    if (!m) continue;
    const day = m[2].toLowerCase() as WeekdaySv;
    if (!(WEEKDAYS_SV as readonly string[]).includes(day)) continue;
    out.push({
      kind: "weekday",
      value: day,
      nextWeek: m[1]?.toLowerCase() === "nästa",
      ...span,
    });
  }
  return out;
}

export function extractDateCandidates(text: string): ArgCandidate[] {
  const out: ArgCandidate[] = [];
  for (const span of collectMatches(text, DATE_RE)) {
    const raw = span.raw.toLowerCase().replace(/\s+/g, " ");
    const value = raw.includes("övermorgon") ? "övermorgon" : raw.includes("morgon") ? "imorgon" : "idag";
    out.push({ kind: "date", value, ...span });
  }
  return out;
}

export function extractAmountCandidates(text: string): ArgCandidate[] {
  const out: ArgCandidate[] = [];
  for (const span of collectMatches(text, AMOUNT_RE)) {
    const digits = span.raw.replace(/[^\d]/g, "");
    const n = parseInt(digits, 10);
    if (!Number.isFinite(n) || n < 100) continue;
    out.push({ kind: "amount", value: n, ...span });
  }
  return out;
}

export function extractQuantityCandidates(text: string): ArgCandidate[] {
  const out: ArgCandidate[] = [];
  for (const span of collectMatches(text, QUANTITY_RE)) {
    const m = /(\d+(?:[.,]\d+)?)/.exec(span.raw);
    if (!m) continue;
    const n = parseFloat(m[1].replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) continue;
    out.push({ kind: "quantity", value: n, ...span });
  }
  return out;
}

export function extractPhoneCandidates(text: string): ArgCandidate[] {
  const out: ArgCandidate[] = [];
  for (const span of collectMatches(text, PHONE_RE)) {
    const digits = span.raw.replace(/\D/g, "");
    if (digits.length < 8) continue;
    out.push({ kind: "phone", value: span.raw.trim(), ...span });
  }
  return out;
}

export function extractNameCandidates(text: string): ArgCandidate[] {
  const out: ArgCandidate[] = [];
  const copy = new RegExp(NAME_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = copy.exec(text))) {
    const raw = m[1];
    if (NAME_STOP.has(raw.toLowerCase())) continue;
    out.push({
      kind: "name",
      value: raw,
      start: m.index,
      end: m.index + raw.length,
      raw,
    });
  }
  return out;
}

const PRIORITY: Record<ArgKind, number> = {
  phone: 6,
  amount: 5,
  quantity: 4,
  time: 3,
  weekday: 2,
  date: 1,
  name: 0,
};

function dropOverlaps(candidates: ArgCandidate[]): ArgCandidate[] {
  const sorted = [...candidates].sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind] || a.start - b.start);
  const kept: ArgCandidate[] = [];
  for (const c of sorted) {
    if (kept.some((k) => overlaps(k, c) && PRIORITY[k.kind] >= PRIORITY[c.kind])) continue;
    kept.push(c);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** "ändra till 7" efter en timantal-kandidat – 7 är ersättningsantal. */
export function extractBareQuantityAfterCorrection(text: string, markers: UtteranceMarker[]): ArgCandidate[] {
  if (extractQuantityCandidates(text).length === 0) return [];
  const out: ArgCandidate[] = [];
  for (const mk of markers) {
    if (mk.kind !== "correction") continue;
    const tail = text.slice(mk.end);
    const m = /^\s*(\d+(?:[.,]\d+)?)\b/.exec(tail);
    if (!m) continue;
    const n = parseFloat(m[1].replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) continue;
    const start = mk.end + (m[0].length - m[1].length);
    const span = { start, end: start + m[1].length, raw: m[1] };
    out.push({ kind: "quantity", value: n, ...span });
  }
  return out;
}

export function extractAllCandidates(text: string, markers?: UtteranceMarker[]): ArgCandidate[] {
  const mk = markers ?? findCorrectionMarkers(text);
  const clock = extractTimeCandidates(text);
  const bare = extractBareHourCandidates(text, mk).filter((b) => !clock.some((c) => overlaps(c, b)));
  const quantities = [
    ...extractQuantityCandidates(text),
    ...extractBareQuantityAfterCorrection(text, mk),
  ];
  return dropOverlaps([
    ...extractPhoneCandidates(text),
    ...extractAmountCandidates(text),
    ...quantities,
    ...clock,
    ...bare,
    ...extractWeekdayCandidates(text),
    ...extractDateCandidates(text),
    ...extractNameCandidates(text),
  ]);
}
