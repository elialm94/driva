import type { DocLine, HusRotWorkCategory, HusRutWorkCategory, HusWorkCategory } from "./types";
import { lineTotal, lineVat } from "./calc";
import { lineTypeOf } from "./economic-line-type";
import { digitsOnly } from "./invoices/formats";

/**
 * Skatteverkets HUS-fil: "Begäran om utbetalning" för rot- och rutarbete,
 * XML-schema version 6 (namespace …/ht/begaran/6.0 + …/ht/komponent/begaran/6.0).
 *
 * Filen importeras av användaren själv i e-tjänsten "Rot och rut – företag".
 * Driva skickar ingenting till Skatteverket – modulen bygger bara filen.
 *
 * Schemat ligger vendorat under docs/skatteverket/hus/ (Begaran.xsd +
 * BegaranCOMPONENT.xsd). Reglerna nedan speglar schemat plus de kontroller
 * e-tjänsten gör vid inskick, så att en fil som lämnar Driva också går att
 * skicka in. Ren modul: inget lager, inga sidoeffekter.
 *
 * Skatteverkets definitioner (bolagets begäran, hela kronor):
 *   PrisForArbete  = arbetskostnad inkl. moms (bara arbetad tid)
 *   BetaltBelopp   = det kunden betalat för arbetet, inkl. moms, efter avdrag
 *   BegartBelopp   = avdraget inkl. moms som begärs från Skatteverket
 *   Ovrigkostnad   = resor, maskiner, administration m.m. inkl. moms
 *   Materialkostnad = material inkl. moms, per arbetsområde
 * Utföraren anges inte i filen – det är det inloggade företaget i e-tjänsten.
 */

export const HUS_BEGARAN_NS = "http://xmls.skatteverket.se/se/skatteverket/ht/begaran/6.0";
export const HUS_KOMPONENT_NS = "http://xmls.skatteverket.se/se/skatteverket/ht/komponent/begaran/6.0";

/** Ordningen är schemats sekvens – filen måste följa den. */
export const HUS_ROT_CATEGORIES: readonly HusRotWorkCategory[] = [
  "Bygg",
  "El",
  "GlasPlatarbete",
  "MarkDraneringarbete",
  "Murning",
  "MalningTapetsering",
  "Vvs",
];

/** Ordningen är schemats sekvens. Schablontjänsterna (transport, tvätt) stöds inte. */
export const HUS_RUT_CATEGORIES: readonly HusRutWorkCategory[] = [
  "Stadning",
  "KladOchTextilvard",
  "Snoskottning",
  "Tradgardsarbete",
  "Barnpassning",
  "Personligomsorg",
  "Flyttjanster",
  "ItTjanster",
  "ReparationAvVitvaror",
  "Moblering",
  "TillsynAvBostad",
];

export const HUS_CATEGORY_LABELS: Record<HusWorkCategory, string> = {
  Bygg: "Bygg",
  El: "El",
  GlasPlatarbete: "Glas- och plåtarbete",
  MarkDraneringarbete: "Mark- och dräneringsarbete",
  Murning: "Murning",
  MalningTapetsering: "Målning och tapetsering",
  Vvs: "VVS",
  Stadning: "Städning",
  KladOchTextilvard: "Kläd- och textilvård",
  Snoskottning: "Snöskottning",
  Tradgardsarbete: "Trädgårdsarbete",
  Barnpassning: "Barnpassning",
  Personligomsorg: "Personlig omsorg",
  Flyttjanster: "Flyttjänster",
  ItTjanster: "IT-tjänster",
  ReparationAvVitvaror: "Reparation av vitvaror",
  Moblering: "Möblering",
  TillsynAvBostad: "Tillsyn av bostad",
};

/** Snickarens standard: ROT utan uttryckligt val exporteras som Bygg. */
export const HUS_ROT_DEFAULT_CATEGORY: HusRotWorkCategory = "Bygg";

export function husCategoriesFor(type: "rot" | "rut"): readonly HusWorkCategory[] {
  return type === "rot" ? HUS_ROT_CATEGORIES : HUS_RUT_CATEGORIES;
}

export function isHusCategoryFor(type: "rot" | "rut", category: string): category is HusWorkCategory {
  return (husCategoriesFor(type) as readonly string[]).includes(category);
}

export type HusBostad =
  | { kind: "fastighet"; fastighetsbeteckning: string }
  | { kind: "bostadsratt"; lagenhetsNr: string; brfOrgNr: string };

export interface HusUtfortArbete {
  kategori: HusWorkCategory;
  antalTimmar: number;
  materialkostnad: number;
}

/** Ett ärende = en köpare och en betalning (i praktiken en betald faktura). */
export interface HusArende {
  /** Köparens personnummer, exakt 12 siffror. */
  kopare: string;
  /** YYYY-MM-DD, dagen kunden betalade sin del. */
  betalningsDatum: string;
  prisForArbete: number;
  betaltBelopp: number;
  begartBelopp: number;
  fakturaNr?: string;
  ovrigKostnad: number;
  /** Bara ROT. Fastighet eller bostadsrätt. */
  bostad?: HusBostad;
  utfortArbete: HusUtfortArbete[];
}

export interface HusBegaranInput {
  type: "rot" | "rut";
  /** Ditt namn på begäran i e-tjänsten, 1–16 tecken. */
  namn: string;
  arenden: HusArende[];
  /** Dagens datum (YYYY-MM-DD) för regeln "betalningsdatum ≤ ansökningsdatum". */
  today: string;
}

export const HUS_MAX_ARENDEN = 100;
const HUS_MIN_BETALNINGSDATUM = "2009-07-01";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class HusBegaranError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "HusBegaranError";
    this.issues = issues;
  }
}

function isWhole(n: number): boolean {
  return Number.isInteger(n);
}

function inRange(n: number, min: number, max: number): boolean {
  return isWhole(n) && n >= min && n <= max;
}

/**
 * Regler ur schemat (typer, intervall, längder) och ur e-tjänstens kontroll
 * vid inskick. Returnerar alla fel på svenska – tom lista = giltigt ärende.
 */
export function validateHusArende(type: "rot" | "rut", a: HusArende, today: string, label = "Ärendet"): string[] {
  const issues: string[] = [];
  if (!/^\d{12}$/.test(a.kopare)) issues.push(`${label}: köparens personnummer måste vara 12 siffror.`);
  if (!ISO_DATE.test(a.betalningsDatum)) issues.push(`${label}: betalningsdatum måste anges som ÅÅÅÅ-MM-DD.`);
  else {
    if (a.betalningsDatum < HUS_MIN_BETALNINGSDATUM) issues.push(`${label}: betalningsdatum måste vara efter 2009-06-30.`);
    if (a.betalningsDatum > today) issues.push(`${label}: betalningsdatum får inte vara senare än idag.`);
  }
  if (!inRange(a.prisForArbete, 2, 99_999_999_999)) issues.push(`${label}: arbetskostnaden måste vara minst 2 kr i hela kronor.`);
  if (!inRange(a.betaltBelopp, 0, 99_999_999_999)) issues.push(`${label}: betalt belopp måste vara hela kronor (0 eller mer).`);
  if (!inRange(a.begartBelopp, 0, 99_999_999_999)) issues.push(`${label}: begärt belopp måste vara hela kronor (0 eller mer).`);
  if (isWhole(a.begartBelopp) && isWhole(a.betaltBelopp) && a.begartBelopp > a.betaltBelopp) {
    issues.push(`${label}: begärt belopp får inte vara större än betalt belopp.`);
  }
  if (isWhole(a.begartBelopp) && isWhole(a.betaltBelopp) && isWhole(a.prisForArbete) && a.begartBelopp + a.betaltBelopp > a.prisForArbete) {
    issues.push(`${label}: begärt + betalt belopp får inte överstiga arbetskostnaden.`);
  }
  if (a.fakturaNr != null && a.fakturaNr.length > 20) issues.push(`${label}: fakturanumret får vara högst 20 tecken.`);
  if (!inRange(a.ovrigKostnad, 0, 9_999_999)) issues.push(`${label}: övrig kostnad måste vara hela kronor mellan 0 och 9 999 999.`);

  if (type === "rot") {
    if (!a.bostad) issues.push(`${label}: bostad (fastighet eller bostadsrätt) saknas.`);
    else if (a.bostad.kind === "fastighet") {
      const fb = a.bostad.fastighetsbeteckning.trim();
      if (fb.length < 1 || fb.length > 40) issues.push(`${label}: fastighetsbeteckningen måste vara 1–40 tecken.`);
    } else {
      const lgh = a.bostad.lagenhetsNr.trim();
      if (lgh.length < 1 || lgh.length > 25) issues.push(`${label}: lägenhetsnumret måste vara 1–25 tecken.`);
      if (!/^[\d-]{1,12}$/.test(a.bostad.brfOrgNr)) issues.push(`${label}: BRF:ens organisationsnummer får bara innehålla siffror och bindestreck (max 12 tecken).`);
    }
  } else if (a.bostad) {
    issues.push(`${label}: bostadsuppgifter hör bara till ROT.`);
  }

  if (a.utfortArbete.length === 0) {
    issues.push(`${label}: minst ett arbetsområde med arbetade timmar och materialkostnad krävs.`);
  }
  const seen = new Set<string>();
  for (const w of a.utfortArbete) {
    if (!isHusCategoryFor(type, w.kategori)) {
      issues.push(`${label}: arbetsområdet ${w.kategori} hör inte till ${type.toUpperCase()}.`);
    }
    if (seen.has(w.kategori)) issues.push(`${label}: arbetsområdet ${w.kategori} förekommer flera gånger.`);
    seen.add(w.kategori);
    if (!inRange(w.antalTimmar, 0, 999)) issues.push(`${label}: arbetade timmar måste vara ett heltal mellan 0 och 999.`);
    if (!inRange(w.materialkostnad, 0, 9_999_999)) issues.push(`${label}: materialkostnaden måste vara hela kronor mellan 0 och 9 999 999.`);
  }
  return issues;
}

export function validateHusBegaran(input: HusBegaranInput): string[] {
  const issues: string[] = [];
  const namn = input.namn.trim();
  if (namn.length < 1 || namn.length > 16) issues.push("Namnet på begäran måste vara 1–16 tecken.");
  if (input.arenden.length === 0) issues.push("Filen måste innehålla minst en köpare.");
  if (input.arenden.length > HUS_MAX_ARENDEN) issues.push(`Filen får innehålla högst ${HUS_MAX_ARENDEN} köpare.`);
  if (!ISO_DATE.test(input.today)) issues.push("Dagens datum saknas.");
  input.arenden.forEach((a, i) => {
    const label = a.fakturaNr ? `Faktura #${a.fakturaNr}` : `Ärende ${i + 1}`;
    issues.push(...validateHusArende(input.type, a, input.today, label));
  });
  const years = new Set(input.arenden.map((a) => a.betalningsDatum.slice(0, 4)));
  if (years.size > 1) issues.push("Alla betalningsdatum i samma fil måste gälla samma betalningsår.");
  return issues;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function el(name: string, value: string | number, indent: string): string {
  return `${indent}<${name}>${esc(String(value))}</${name}>`;
}

/**
 * Bygger filen. Kastar HusBegaranError om innehållet inte skulle klara schemat
 * eller e-tjänstens kontroller – en ogiltig fil lämnar aldrig Driva.
 * Layouten följer Skatteverkets exempelfiler (default-namespace på roten,
 * komponent-namespace på barnen).
 */
export function buildHusBegaranXml(input: HusBegaranInput): string {
  const issues = validateHusBegaran(input);
  if (issues.length) throw new HusBegaranError(issues);

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<Begaran xmlns="${HUS_BEGARAN_NS}">`);
  lines.push(`  <NamnPaBegaran xmlns="${HUS_KOMPONENT_NS}">${esc(input.namn.trim())}</NamnPaBegaran>`);
  const wrapper = input.type === "rot" ? "RotBegaran" : "HushallBegaran";
  lines.push(`  <${wrapper} xmlns="${HUS_KOMPONENT_NS}">`);
  for (const a of input.arenden) {
    lines.push("    <Arenden>");
    lines.push(el("Kopare", a.kopare, "      "));
    lines.push(el("BetalningsDatum", a.betalningsDatum, "      "));
    lines.push(el("PrisForArbete", a.prisForArbete, "      "));
    lines.push(el("BetaltBelopp", a.betaltBelopp, "      "));
    lines.push(el("BegartBelopp", a.begartBelopp, "      "));
    if (a.fakturaNr) lines.push(el("FakturaNr", a.fakturaNr, "      "));
    lines.push(el("Ovrigkostnad", a.ovrigKostnad, "      "));
    if (input.type === "rot" && a.bostad) {
      if (a.bostad.kind === "fastighet") {
        lines.push(el("Fastighetsbeteckning", a.bostad.fastighetsbeteckning.trim(), "      "));
      } else {
        lines.push(el("LagenhetsNr", a.bostad.lagenhetsNr.trim(), "      "));
        lines.push(el("BrfOrgNr", a.bostad.brfOrgNr, "      "));
      }
    }
    lines.push("      <UtfortArbete>");
    // Schemats sekvensordning, inte användarens.
    const ordered = [...husCategoriesFor(input.type)]
      .map((k) => a.utfortArbete.find((w) => w.kategori === k))
      .filter((w): w is HusUtfortArbete => Boolean(w));
    for (const w of ordered) {
      lines.push(`        <${w.kategori}>`);
      lines.push(el("AntalTimmar", w.antalTimmar, "          "));
      lines.push(el("Materialkostnad", w.materialkostnad, "          "));
      lines.push(`        </${w.kategori}>`);
    }
    lines.push("      </UtfortArbete>");
    lines.push("    </Arenden>");
  }
  lines.push(`  </${wrapper}>`);
  lines.push("</Begaran>");
  return lines.join("\n") + "\n";
}

/* ------------------------------ hjälpare för data ------------------------------ */

const HOUR_UNITS = new Set(["tim", "tim.", "timmar", "timme", "h", "hr", "hrs", "timma"]);

export function isHourUnit(unit: string): boolean {
  return HOUR_UNITS.has(unit.trim().toLowerCase());
}

/**
 * Arbetade timmar ur fakturaraderna: summan av antal på timprisade arbetsrader.
 * Är någon arbetsrad inte timprisad (fast pris, "st") går timmarna inte att
 * läsa av – då returneras null och användaren måste ange dem. Timmar räknas
 * aldrig fram ur beloppet.
 */
export function laborHoursFromLines(lines: readonly DocLine[]): number | null {
  const labor = lines.filter((l) => lineTypeOf(l) === "LABOR");
  if (labor.length === 0) return null;
  if (!labor.every((l) => isHourUnit(l.unit))) return null;
  const sum = labor.reduce((s, l) => s + (Number.isFinite(l.qty) ? l.qty : 0), 0);
  return Math.round(sum);
}

/** Material inkl. moms – går in under arbetsområdet i filen. */
export function materialCostFromLines(lines: readonly DocLine[]): number {
  return lines
    .filter((l) => lineTypeOf(l) === "MATERIAL")
    .reduce((s, l) => s + lineTotal(l) + lineVat(l), 0);
}

/** Övrig kostnad inkl. moms: resor och övrigt (aldrig arbete eller material). */
export function otherCostFromLines(lines: readonly DocLine[]): number {
  return lines
    .filter((l) => {
      const t = lineTypeOf(l);
      return t === "TRAVEL" || t === "OTHER";
    })
    .reduce((s, l) => s + lineTotal(l) + lineVat(l), 0);
}

/**
 * Personnummer som 12 siffror (schemats PeOrgNrTYPE). Tio siffror kompletteras
 * med sekel: 20xx om det datumet inte ligger i framtiden, annars 19xx. Andra
 * längder returnerar null – filen får inte gissa.
 */
export function personnummerTo12Digits(value: string, today: string): string | null {
  const d = digitsOnly(value);
  if (d.length === 12) return d;
  if (d.length !== 10) return null;
  const candidate = `20${d}`;
  const asDate = `${candidate.slice(0, 4)}-${candidate.slice(4, 6)}-${candidate.slice(6, 8)}`;
  return asDate <= today ? candidate : `19${d}`;
}

/** Ditt namn på begäran i e-tjänsten – max 16 tecken. */
export function husBegaranName(type: "rot" | "rut", today: string): string {
  return `${type.toUpperCase()} ${today}`.slice(0, 16);
}
