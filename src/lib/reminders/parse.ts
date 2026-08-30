/**
 * Deterministisk snabbväg för de vanligaste påminnelsefraserna – noll LLM,
 * noll kostnad. Fångar bara mönster som kan tolkas säkert:
 *
 *   "påminn mig [imorgon|på onsdag|om 2 timmar|på fredag eftermiddag|imorgon kl 14] att X"
 *
 * Allt annat (eller tvetydiga fraser) returnerar null och går LLM-vägen.
 * Resultatet är SAMMA platta verktygsargument som create_reminder tar –
 * policyn bor kvar i resolvern och verktygshanteraren (en källa till sanning
 * för länkning, veckodagsregel och standardtider).
 */
import {
  collapseCorrectedUtterance,
  resolveUtteranceCorrections,
} from "../ai/corrections";
import { isInternalReminderIntent, isPaymentReminderUtterance } from "../ai/utterance";
import {
  DAYPARTS,
  WEEKDAYS_SV,
  formatDueAt,
  localParts,
  resolveWhen,
  type Daypart,
  type WeekdaySv,
  type WhenExpression,
} from "./when";

export interface ParsedReminder {
  title: string;
  args: Record<string, string | number | boolean>;
}

const NUMBER_WORDS: Record<string, number> = {
  en: 1, ett: 1, två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, åtta: 8, nio: 9, tio: 10,
};

const DAYPART_WORDS: Record<string, Daypart> = {
  "på morgonen": "morgon",
  "på förmiddagen": "förmiddag",
  "på eftermiddagen": "eftermiddag",
  "på kvällen": "kväll",
  morgonen: "morgon",
  förmiddagen: "förmiddag",
  eftermiddagen: "eftermiddag",
  kvällen: "kväll",
  morgon: "morgon",
  förmiddag: "förmiddag",
  eftermiddag: "eftermiddag",
  kväll: "kväll",
  ikväll: "kväll",
};

function localDatePlusDays(now: Date, timezone: string, days: number): string {
  const p = localParts(now, timezone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/** Första sammanhängande följden av versalinledda ord ("Göran Svensson") → kundfråga. */
export function relatedFromTitle(title: string): { relatedType: string; relatedQuery: string } | undefined {
  const quote = /\boffert(?:en)?\s*(?:nr\s*)?#?(\d+)/i.exec(title);
  if (quote) return { relatedType: "quote", relatedQuery: quote[1] };
  const invoice = /\bfaktura(?:n)?\s*(?:nr\s*)?#?(\d+)/i.exec(title);
  if (invoice) return { relatedType: "invoice", relatedQuery: invoice[1] };
  // Guidat flöde: "Ring Göran" – hoppa över inledande verb så inte "Ring" blir namnet.
  const forName = title.replace(
    /^(ringa?|kolla|skicka|beställa|fakturera|kontakta|maila|mejla|boka|följa|prata(?:\s+med)?)\s+/i,
    ""
  );
  const capRun = /(?:^|\s)((?:[A-ZÅÄÖ][a-zåäöé]+)(?:\s+[A-ZÅÄÖ][a-zåäöé]+)*)/.exec(forName);
  if (capRun) return { relatedType: "customer", relatedQuery: capRun[1].trim() };
  return undefined;
}

/**
 * Inledningar som markerar intern påminnelse (äldre prefixform).
 * Semantisk intent bor i isInternalReminderIntent – wrappers kan sitta
 * var som helst i meningen.
 */
const REMINDER_LEAD_RE =
  /^\s*(?:skapa(?:\s+en)?\s+påminnelse|påminn(?:a)?(?:\s+mig)?)(?:\s+gärna)?(?:\s+om(?=\s+att\b))?(?:\s+|$)/i;

/** Längsta wrapper först så "kan du påminna mig om att" äts i ett svep. */
const REMINDER_WRAPPER_RE =
  /\b(?:kan\s+du\s+påminna\s+mig(?:\s+om(?=\s+att\b))?(?:\s+att)?|jag\s+behöver\s+bli\s+påmind(?:\s+om(?=\s+att\b))?(?:\s+att)?|bli\s+påmind(?:\s+om(?=\s+att\b))?(?:\s+att)?|(?:gör|skapa|lägg\s+in|lägg\s+till)\s+(?:en\s+)?påminnelse(?:\s*[:–—-])?(?:\s+om(?=\s+att\b))?(?:\s+att)?|påminnelse\s*[:–—-]|påminnelse\b|påminn(?:a)?(?:\s+mig)?(?:\s+gärna)?(?:\s+om(?=\s+att\b))?(?:\s+att)?|kom\s+ihåg(?:\s+att)?)\b/gi;

const PAYMENT_REMINDER_RE = /^\s*skicka\s+(?:en\s+)?påminnelse/i;

/**
 * Tidsspråk parsern inte kan låsa – "vid lunch", "när det passar".
 * Då ska hela originalfrasen gå till OpenRouter, inte one-shot eller slot-fill.
 */
const UNRESOLVED_WHEN_RE =
  /\b(?:vid\s+lunch|till\s+lunch|efter\s+lunch|före\s+lunch|kring\s+lunch|lunchtid|när\s+(?:det|lunchen|jag)|n[åa]n\s+g[åa]ng|någon\s+gång)\b/i;

export function hasUnresolvedWhenLanguage(text: string): boolean {
  return UNRESOLVED_WHEN_RE.test(text);
}

export function isPaymentReminderQuery(text: string): boolean {
  return PAYMENT_REMINDER_RE.test(text.trim()) || isPaymentReminderUtterance(text);
}

/** Deterministisk intern påminnelse-intent – synonym/ordföljd, inte exakt fras. */
export function isReminderIntentQuery(text: string): boolean {
  const t = text.trim();
  if (!t || isPaymentReminderQuery(t)) return false;
  return isInternalReminderIntent(t) || REMINDER_LEAD_RE.test(t + " ") || REMINDER_LEAD_RE.test(t);
}

function stripReminderLeadPrefix(text: string): string {
  return text
    .replace(REMINDER_LEAD_RE, "")
    .replace(/^\s*att\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,.!?…]+$/g, "")
    .trim();
}

/** Tar bort påminnelse-omslag var de än sitter; tid och uppgift lämnas kvar. */
export function stripReminderWrappers(text: string): string {
  let rest = text.replace(/\s+/g, " ").trim();
  REMINDER_WRAPPER_RE.lastIndex = 0;
  rest = rest.replace(REMINDER_WRAPPER_RE, " ");
  REMINDER_WRAPPER_RE.lastIndex = 0;
  rest = rest
    .replace(/^\s*att\s+/i, "")
    .replace(/\s+att\s*$/i, "")
    .replace(/^[\s,.;!?…–—-]+|[\s,.;!?…–—-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return rest;
}

function prepareReminderBody(body: string): { rest: string; prettyTitle: boolean } | null {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  const resolution = resolveUtteranceCorrections(collapsed);
  if (resolution.confidence === "ambiguous" || resolution.needsStructuredExtraction) return null;
  if (resolution.hasCorrectionLanguage && resolution.confidence === "high") {
    return { rest: collapseCorrectedUtterance(collapsed, resolution), prettyTitle: true };
  }
  return { rest: collapsed, prettyTitle: false };
}

const HALF_HOUR_WORDS: Record<string, number> = {
  ett: 12,
  två: 1,
  tre: 2,
  fyra: 3,
  fem: 4,
  sex: 5,
  sju: 6,
  åtta: 7,
  nio: 8,
  tio: 9,
  elva: 10,
  tolv: 11,
};

export function parseReminderText(text: string, now: Date, timezone: string): ParsedReminder | null {
  const trimmed = text.trim();
  if (!trimmed || isPaymentReminderUtterance(trimmed)) return null;
  // Semantisk intent – inte bara "påminn mig" som prefix. Nakna meningar
  // utan påminnelseord går via parseReminderCommandInput som sätter prefixet.
  if (!isReminderIntentQuery(trimmed)) return null;
  const body = stripReminderWrappers(trimmed) || stripReminderLeadPrefix(trimmed);
  if (!body) return null;
  const prepared = prepareReminderBody(body);
  if (!prepared) return null;
  let rest = ` ${prepared.rest} `;

  const args: Record<string, string | number | boolean> = {};
  let matched = false;

  // "om 2 timmar" / "om en timme" / "om 30 minuter" / "om tre dagar"
  const rel = /\bom\s+(\d+|en|ett|två|tre|fyra|fem|sex|sju|åtta|nio|tio)\s+(minut(?:er)?|timm(?:e|ar)|dag(?:ar)?)\b/i.exec(rest);
  if (rel) {
    const n = NUMBER_WORDS[rel[1].toLowerCase()] ?? Number(rel[1]);
    if (Number.isFinite(n) && n > 0) {
      if (rel[2].startsWith("minut")) args.relativeMinutes = n;
      else if (rel[2].startsWith("timm")) args.relativeHours = n;
      else args.relativeDays = n;
      rest = rest.replace(rel[0], " ");
      matched = true;
    }
  }

  // "på onsdag" / "nästa onsdag" / "fredag eftermiddag" / "på onsdag nästa vecka"
  if (!matched) {
    const wd = new RegExp(`\\b(?:(på|nästa)\\s+)?(${WEEKDAYS_SV.join("|")})(\\s+nästa\\s+vecka)?\\b`, "i").exec(rest);
    if (wd) {
      args.weekday = wd[2].toLowerCase() as WeekdaySv;
      if (wd[1]?.toLowerCase() === "nästa" || wd[3]) args.nextWeek = true;
      rest = rest.replace(wd[0], " ");
      matched = true;
    }
  }

  // "imorgon" / "i morgon"
  if (!matched) {
    const tm = /\bi\s?morgon\b/i.exec(rest);
    if (tm) {
      args.whenDate = localDatePlusDays(now, timezone, 1);
      rest = rest.replace(tm[0], " ");
      matched = true;
    }
  }

  // "idag" som dag – oberoende av ordföljd. Klockslag fylls i nedan.
  if (!matched) {
    const today = /\bidag\b/i.exec(rest);
    if (today) {
      args.whenDate = localDatePlusDays(now, timezone, 0);
      rest = rest.replace(today[0], " ");
      matched = true;
    }
  }

  // Klockslag: "kl 14" / "klockan 14:30" / "kl. 12" / "12:30" / "halv två"
  const clock = /\bkl(?:ockan)?\.?\s*(\d{1,2})(?:[:.](\d{2}))?\b/i.exec(rest);
  const bareClock = !clock ? /\b(\d{1,2})[:.](\d{2})\b/.exec(rest) : null;
  const half =
    !clock && !bareClock
      ? /\bhalv\s+(ett|två|tre|fyra|fem|sex|sju|åtta|nio|tio|elva|tolv)(?=$|[^A-Za-zÅÄÖåäö])/i.exec(rest)
      : null;
  if (clock) {
    args.time = `${clock[1]}:${clock[2] ?? "00"}`;
    rest = rest.replace(clock[0], " ");
    if (!matched) {
      rest = rest.replace(/\bidag\b/i, " ");
      args.whenDate = localDatePlusDays(now, timezone, 0);
      matched = true;
    }
  } else if (bareClock) {
    args.time = `${bareClock[1]}:${bareClock[2]}`;
    rest = rest.replace(bareClock[0], " ");
    if (!matched) {
      rest = rest.replace(/\bidag\b/i, " ");
      args.whenDate = localDatePlusDays(now, timezone, 0);
      matched = true;
    }
  } else if (half) {
    const hour = HALF_HOUR_WORDS[half[1].toLowerCase()];
    args.time = `${hour}:30`;
    rest = rest.replace(half[0], " ");
    if (!matched) {
      rest = rest.replace(/\bidag\b/i, " ");
      args.whenDate = localDatePlusDays(now, timezone, 0);
      matched = true;
    }
  }

  // Dagsdel: "på eftermiddagen" / "eftermiddag" / "ikväll"
  if (!args.time) {
    for (const [word, daypart] of Object.entries(DAYPART_WORDS)) {
      const re = new RegExp(`\\b${word}\\b`, "i");
      if (re.test(rest)) {
        args.daypart = daypart;
        rest = rest.replace(re, " ");
        if (!matched) matched = DAYPARTS.includes(daypart); // enbart dagsdel → idag/imorgon-policy i resolvern
        break;
      }
    }
  }

  if (!matched) return null;

  // Titeln: det som blir kvar, utan inledande "att" och skiljetecken.
  let title = rest
    .replace(/^\s*att\s+/i, "")
    .replace(/\s+att\s*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:!?…–—-]+|[\s,.;:!?…–—-]+$/g, "")
    .trim();
  if (!title) return null;
  // Klockslag/datum vi inte förstår får inte fastna i titeln ("vid lunch").
  if (hasUnresolvedWhenLanguage(title)) return null;
  if (prepared.prettyTitle) {
    title = prettyReminderTitle(title);
    const resolution = resolveUtteranceCorrections(body);
    if (typeof resolution.final.time === "string") args.time = resolution.final.time;
    if (typeof resolution.final.weekday === "string") {
      args.weekday = resolution.final.weekday;
      delete args.whenDate;
      if (resolution.finalNextWeek) args.nextWeek = true;
      else delete args.nextWeek;
    }
    if (typeof resolution.final.date === "string" && !args.weekday) {
      const days = resolution.final.date === "övermorgon" ? 2 : resolution.final.date === "imorgon" ? 1 : 0;
      args.whenDate = localDatePlusDays(now, timezone, days);
    }
    if (typeof resolution.final.name === "string") {
      const verb = /^(ringa?|kolla|skicka|beställa|fakturera|kontakta|maila|mejla|boka)\b/i.exec(title);
      title = prettyReminderTitle(verb ? `${verb[0]} ${resolution.final.name}` : String(resolution.final.name));
    }
  }

  const related = relatedFromTitle(title);
  return { title, args: { title, ...args, ...(related ?? {}) } };
}

/** Sätter ihop titel + tid till den fras parseReminderText redan förstår. */
export function reminderTextFromParts(title: string, whenText: string): string {
  return `påminn mig ${whenText.trim()} att ${title.trim()}`;
}

/** Platta parser-/verktygsargument → samma tidsuttryck som resolvern tar. */
export function whenFromReminderArgs(args: Record<string, string | number | boolean>): WhenExpression | null {
  if (
    typeof args.relativeMinutes === "number" ||
    typeof args.relativeHours === "number" ||
    typeof args.relativeDays === "number"
  ) {
    return {
      kind: "relative",
      minutes: typeof args.relativeMinutes === "number" ? args.relativeMinutes : undefined,
      hours: typeof args.relativeHours === "number" ? args.relativeHours : undefined,
      days: typeof args.relativeDays === "number" ? args.relativeDays : undefined,
    };
  }
  if (typeof args.weekday === "string") {
    return {
      kind: "weekday",
      weekday: args.weekday as WeekdaySv,
      nextWeek: args.nextWeek === true,
      time: typeof args.time === "string" ? args.time : undefined,
      daypart: typeof args.daypart === "string" ? (args.daypart as Daypart) : undefined,
    };
  }
  if (typeof args.whenDate === "string") {
    return {
      kind: "date",
      date: args.whenDate,
      time: typeof args.time === "string" ? args.time : undefined,
      daypart: typeof args.daypart === "string" ? (args.daypart as Daypart) : undefined,
    };
  }
  if (typeof args.whenIso === "string") {
    return { kind: "isoDateTime", value: args.whenIso };
  }
  if (typeof args.daypart === "string") return { kind: "daypart", daypart: args.daypart as Daypart };
  return null;
}

/** HH:MM med nollutfyllnad ("9:00" → "09:00"). */
export function padClock(time: string): string {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(time.trim());
  if (!m) return time;
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2] ?? "00"}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export interface ReminderLocalWhen {
  date: string;
  time: string;
  whenIso: string;
}

/** Tolkade argument → lokal väggtid som förhandsvisningen visar och skapa skickar. */
export function reminderLocalFromArgs(
  args: Record<string, string | number | boolean>,
  now: Date,
  timezone: string
): ReminderLocalWhen | null {
  const expr = whenFromReminderArgs(args);
  if (!expr) return null;
  const resolved = resolveWhen(expr, now, timezone);
  if (!resolved.ok) return null;
  const p = localParts(new Date(resolved.value.dueAt), timezone);
  const date = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  const time = `${pad2(p.hour)}:${pad2(p.minute)}`;
  return { date, time, whenIso: `${date}T${time}` };
}

export function reminderArgsFromLocal(date: string, time: string): Record<string, string | number | boolean> {
  return { whenDate: date, time: padClock(time), whenIso: `${date}T${padClock(time)}` };
}

/* ----------------------------- Visning / rättelse ----------------------------- */

const TITLE_STOP = new Set([
  "att", "och", "om", "en", "ett", "på", "i", "den", "det", "av", "för", "med", "till",
  "hos", "åt", "från", "som", "vid", "efter", "innan", "under", "över",
]);

const NAME_AFTER = new Set(["till", "med", "hos", "åt", "och"]);
const LEAD_VERBS = new Set([
  "ring", "ringa", "skicka", "beställa", "kolla", "kontakta", "maila", "mejla", "boka", "följa", "prata",
]);

const INFINITIVE_HEAD: Record<string, string> = {
  ringa: "Ring",
  kolla: "Kolla",
  skicka: "Skicka",
  beställa: "Beställ",
  fakturera: "Fakturera",
  kontakta: "Kontakta",
  maila: "Maila",
  mejla: "Mejla",
  boka: "Boka",
};

/**
 * Rimlig visningsversalisering: "skicka till göran" → "Skicka till Göran",
 * "ringa Göran" → "Ring Göran".
 */
export function prettyReminderTitle(title: string): string {
  const words = title.replace(/\s+/g, " ").trim().split(" ");
  if (words.length === 1 && !words[0]) return "";
  return words
    .map((raw, i) => {
      if (!raw) return raw;
      const lower = raw.toLocaleLowerCase("sv");
      if (i === 0) return INFINITIVE_HEAD[lower] ?? raw.charAt(0).toLocaleUpperCase("sv") + raw.slice(1);
      if (TITLE_STOP.has(lower)) return lower;
      const prev = words[i - 1]?.toLocaleLowerCase("sv");
      if (prev && NAME_AFTER.has(prev)) {
        return raw.charAt(0).toLocaleUpperCase("sv") + raw.slice(1);
      }
      if (i === 1 && LEAD_VERBS.has(words[0]?.toLocaleLowerCase("sv") ?? "") && !TITLE_STOP.has(lower)) {
        return raw.charAt(0).toLocaleUpperCase("sv") + raw.slice(1);
      }
      return raw;
    })
    .join(" ");
}

const FOLLOW_UP_LEAD =
  /^(?:nej(?:\s+förresten)?|ändra(?:\s+till)?|gör\s+det|jag\s+menar|istället)\s+/i;
const CLOCK_ONLY = /^kl(?:ockan)?\.?\s*(\d{1,2})(?:[:.](\d{2}))?$/i;
const HAS_CLOCK = /\bkl(?:ockan)?\.?\s*\d{1,2}(?:[:.]\d{2})?\b/i;

function stripFollowUpLead(text: string): string {
  let rest = text.replace(WHEN_FILLER, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) {
    const next = rest.replace(FOLLOW_UP_LEAD, "").trim();
    if (next === rest) break;
    rest = next;
  }
  return rest.replace(/[\s,.!?…]+$/g, "").trim();
}

export interface ReminderFollowUp {
  title?: string;
  args: Record<string, string | number | boolean>;
}

/**
 * Tunn uppföljning i förhandsvisningen: "nej kl 10 istället" / "ändra till
 * imorgon kl 9" uppdaterar bara det fält som ändrades. Startar inte om
 * flödet. Delar parser med parseWhenText; korrektionslagret (nl-corrections)
 * kan byta ut den här haken när det landar.
 */
export function applyReminderFollowUp(
  current: Record<string, string | number | boolean>,
  followUp: string,
  now: Date,
  timezone: string
): ReminderFollowUp | null {
  const cleaned = stripFollowUpLead(followUp);
  if (!cleaned) return null;

  const local = reminderLocalFromArgs(current, now, timezone);

  const clockOnly = CLOCK_ONLY.exec(cleaned);
  if (clockOnly) {
    const time = padClock(`${clockOnly[1]}:${clockOnly[2] ?? "00"}`);
    if (local) return { args: reminderArgsFromLocal(local.date, time) };
    const whenArgs = parseWhenText(cleaned, now, timezone);
    return whenArgs ? { args: whenArgs } : null;
  }

  const whenArgs = parseWhenText(cleaned, now, timezone);
  if (whenArgs) {
    if (!HAS_CLOCK.test(cleaned) && local && !whenArgs.time && !whenArgs.daypart) {
      return { args: { ...whenArgs, time: local.time } };
    }
    return { args: whenArgs };
  }

  const parsed = parseReminderCommandInput(cleaned, now, timezone);
  if (parsed?.complete) {
    return { title: prettyReminderTitle(parsed.title), args: parsed.args };
  }
  return null;
}

/**
 * När förhandsvisning ska visas vs one-shot. HIGH + SAFE + komplett och inte
 * i guidat/tvetydigt läge → skapa + Ångra (oneshot-grenen). Annars redigerbar
 * preview. Guidat flöde (slot-fill) visar alltid preview när den finns.
 */
export function reminderNeedsReview(input: {
  complete: boolean;
  confidence: "high" | "low";
  inGuidedFlow: boolean;
  ambiguous?: boolean;
  explicitReview?: boolean;
}): boolean {
  if (input.explicitReview || input.ambiguous || input.inGuidedFlow) return true;
  if (!input.complete || input.confidence !== "high") return true;
  return false;
}

/* --------------------- Kommandokontext: tolka ALLT ur EN mening --------------------- */

/**
 * Resultat för påminnelseflödets inmatning: den TOLKADE påminnelsen är källan
 * till sanning för vilka fält som saknas – aldrig brödsmule-/chiptillståndet.
 */
export type ReminderCommandParse =
  /** Både VAD och NÄR fanns i meningen → direkt till förhandsvisning/skapa. */
  | { complete: true; title: string; args: Record<string, string | number | boolean> }
  /** Bara VAD → fråga enbart efter NÄR. */
  | { complete: false; missing: "when"; title: string }
  /** Bara NÄR → fråga enbart efter VAD. */
  | { complete: false; missing: "title"; args: Record<string, string | number | boolean> }
  /** Varken VAD eller NÄR ("skapa påminnelse") → guidat flöde från början. */
  | { complete: false; missing: "both" };

function hasReminderLead(text: string): boolean {
  return isReminderIntentQuery(text);
}

/**
 * Tolkning INUTI påminnelsekommandot: en naken mening ("Ring Göran klockan 8
 * imorgon") ÄR en påminnelse. Prefixet stripas först så att
 * "Skapa påminnelse imorgon kl 8" blir saknad titel, inte en titel som
 * heter "Skapa påminnelse". Hittas ingen tid returneras enbart titeln.
 */
export function parseReminderCommandInput(text: string, now: Date, timezone: string): ReminderCommandParse | null {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const prefixed = hasReminderLead(trimmed);
  const parsed =
    parseReminderText(trimmed, now, timezone) ??
    (prefixed ? null : parseReminderText(`påminn mig ${trimmed}`, now, timezone));
  if (parsed) return { complete: true, title: parsed.title, args: parsed.args };

  const body = prefixed ? stripReminderWrappers(trimmed) || stripReminderLeadPrefix(trimmed) : trimmed;
  // Tydlig påminnelse men olåst tidsspråk → null så OpenRouter får HELA frasen.
  if (hasUnresolvedWhenLanguage(trimmed) || hasUnresolvedWhenLanguage(body)) return null;
  if (!body) return { complete: false, missing: "both" };

  const whenArgs = parseWhenText(body, now, timezone);
  if (whenArgs) return { complete: false, missing: "title", args: whenArgs };

  return { complete: false, missing: "when", title: body };
}

/* ------------------------------ Ren tidfras (NÄR-steget) ----------------------------- */

/** Sentinel-titel: gemen så att relatedFromTitle aldrig träffar den. */
const WHEN_SENTINEL_TITLE = "x";

/** Utfyllnadsord i tidsfraser som inte bär betydelse: "kl 9 istället". */
const WHEN_FILLER = /\b(?:i\s?stället|istället|gärna|tack)\b/gi;

/**
 * Tolkar en REN tidfras ("imorgon kl 8", "onsdag", "kl 9 istället") till samma
 * platta verktygsargument som create_reminder tar. Hela frasen måste vara tid –
 * blir det ord över är frasen inte förstådd (ärligt null, ingen gissning) och
 * titeln förblir orörd data som aldrig tolkas om.
 */
export function parseWhenText(
  whenText: string,
  now: Date,
  timezone: string
): Record<string, string | number | boolean> | null {
  const cleaned = whenText.replace(WHEN_FILLER, " ").replace(/\s+/g, " ").replace(/[\s,.!?…]+$/g, "").trim();
  if (!cleaned) return null;
  const parsed = parseReminderText(reminderTextFromParts(WHEN_SENTINEL_TITLE, cleaned), now, timezone);
  if (!parsed || parsed.title !== WHEN_SENTINEL_TITLE) return null;
  const { title: _title, relatedType: _rt, relatedQuery: _rq, ...whenArgs } = parsed.args;
  return whenArgs;
}

/* ------------------------------- Förhandsvisning ------------------------------ */

/** "Sön 30 aug" – kort chip i förhandsvisningen. */
export function formatReminderDateChip(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const text = new Intl.DateTimeFormat("sv-SE", { weekday: "short", day: "numeric", month: "short" })
    .format(d)
    .replace(/\./g, "");
  return text.charAt(0).toLocaleUpperCase("sv") + text.slice(1);
}

/** Tolkade verktygsargument → "Onsdag 2 september kl 10:00" (eller null). */
export function previewReminderDueFromArgs(
  args: Record<string, string | number | boolean>,
  now: Date,
  timezone: string
): string | null {
  const expr = whenFromReminderArgs(args);
  if (!expr) return null;
  const resolved = resolveWhen(expr, now, timezone);
  if (!resolved.ok) return null;
  const text = formatDueAt(resolved.value.dueAt, timezone);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : null;
}

/** Tolkat förhandsdatum för en ren tidfras i det guidade flödet. */
export function previewReminderDue(whenText: string, now: Date, timezone: string): string | null {
  const whenArgs = parseWhenText(whenText, now, timezone);
  return whenArgs ? previewReminderDueFromArgs(whenArgs, now, timezone) : null;
}
