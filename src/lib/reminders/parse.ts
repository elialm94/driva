/**
 * Deterministisk snabbväg för de vanligaste påminnelsefraserna – noll LLM,
 * noll kostnad. Fångar mönster som kan tolkas säkert, ur HELA originalfrasen:
 *
 *   "påminn mig [imorgon|på onsdag|nästa onsdag|om 2 timmar|om 30 minuter|
 *    på fredag eftermiddag|imorgon kl 14|i övermorgon|ikväll] att X"
 *   "skapa (en) påminnelse att X kl 12 nästa onsdag"
 *
 * Allt annat (eller tvetydiga fraser) returnerar null och går LLM-vägen.
 * Resultatet är SAMMA platta verktygsargument som create_reminder tar –
 * policyn bor kvar i resolvern och verktygshanteraren (en källa till sanning
 * för länkning, veckodagsregel och standardtider).
 *
 * Viktigt: prefixet ("skapa påminnelse" / "påminn mig") konsumeras – resten
 * av meningen slängs ALDRIG. Slot-filling frågar bara efter det som saknas.
 */
import {
  DAYPARTS,
  WEEKDAYS_SV,
  formatDueAtCompact,
  formatDueAtDisplay,
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
 * Inledningar som markerar intern påminnelse – INTE betalningspåminnelse
 * ("skicka påminnelse"). Hela resten av meningen är argument, aldrig skräp.
 */
const REMINDER_LEAD_RE =
  /^\s*(?:skapa(?:\s+en)?\s+påminnelse|påminn(?:a)?(?:\s+mig)?)(?:\s+gärna)?(?:\s+om(?=\s+att\b))?(?:\s+|$)/i;

const PAYMENT_REMINDER_RE = /^\s*skicka\s+(?:en\s+)?påminnelse/i;

export function isPaymentReminderQuery(text: string): boolean {
  return PAYMENT_REMINDER_RE.test(text.trim());
}

/** Deterministisk intern påminnelse-intent (prefix), inte bara ämnesordet. */
export function isReminderIntentQuery(text: string): boolean {
  const t = text.trim();
  if (!t || isPaymentReminderQuery(t)) return false;
  return REMINDER_LEAD_RE.test(t + " ") || REMINDER_LEAD_RE.test(t);
}

function hasReminderLead(text: string): boolean {
  return REMINDER_LEAD_RE.test(text.trim() + " ") || REMINDER_LEAD_RE.test(text.trim());
}

/** Första bokstaven versal – visning och persisterad titel ("Ring Göran"). */
export function prettyReminderTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

interface ReminderSlots {
  title: string;
  args: Record<string, string | number | boolean>;
  hasWhen: boolean;
}

/**
 * Plockar ut NÄR och VAD ur en mening (redan utan intent-prefix).
 * Tidfraser tas bort; det som blir kvar är titeln. Inget fält gissas.
 */
function extractReminderSlots(body: string, now: Date, timezone: string): ReminderSlots {
  let rest = ` ${body.trim()} `;
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

  // "i övermorgon" före "imorgon" så inte "morgon"-delen stjäls.
  if (!matched) {
    const over = /\bi\s+övermorgon\b/i.exec(rest);
    if (over) {
      args.whenDate = localDatePlusDays(now, timezone, 2);
      rest = rest.replace(over[0], " ");
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

  // Klockslag: "kl 14" / "klockan 14:30" / "kl. 12" (kombineras med dag ovan)
  const clock = /\bkl(?:ockan)?\.?\s*(\d{1,2})(?:[:.](\d{2}))?\b/i.exec(rest);
  if (clock) {
    args.time = `${clock[1]}:${clock[2] ?? "00"}`;
    rest = rest.replace(clock[0], " ");
    if (!matched) {
      // "idag kl 15" eller bara "kl 15" → idag.
      rest = rest.replace(/\bidag\b/i, " ");
      args.whenDate = localDatePlusDays(now, timezone, 0);
      matched = true;
    }
  }

  // "idag" utan klockslag → dagsnivå (standardtid 10:00 i resolvern).
  if (!matched) {
    const today = /\bidag\b/i.exec(rest);
    if (today) {
      args.whenDate = localDatePlusDays(now, timezone, 0);
      rest = rest.replace(today[0], " ");
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
        if (!matched) matched = DAYPARTS.includes(daypart);
        break;
      }
    }
  }

  const title = rest
    .replace(/^\s*att\s+/i, "")
    .replace(/\s+att\s*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,.!?…]+$/g, "")
    .trim();

  return { title, args, hasWhen: matched };
}

function slotsToParsed(slots: ReminderSlots): ParsedReminder | null {
  if (!slots.hasWhen || !slots.title) return null;
  const related = relatedFromTitle(slots.title);
  return { title: slots.title, args: { title: slots.title, ...slots.args, ...(related ?? {}) } };
}

export function parseReminderText(text: string, now: Date, timezone: string): ParsedReminder | null {
  const trimmed = text.trim();
  if (!trimmed || isPaymentReminderQuery(trimmed) || !hasReminderLead(trimmed)) return null;
  const body = stripReminderLead(trimmed);
  if (!body) return null;
  return slotsToParsed(extractReminderSlots(body, now, timezone));
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
  if (typeof args.daypart === "string") return { kind: "daypart", daypart: args.daypart as Daypart };
  return null;
}

/* --------------------- Kommandokontext: tolka ALLT ur EN mening --------------------- */

/**
 * Resultat för påminnelseflödets inmatning: den TOLKADE påminnelsen är källan
 * till sanning för vilka fält som saknas – aldrig brödsmule-/chiptillståndet.
 *
 * Fråga ALDRIG efter ett fält som redan fanns i originalmeningen.
 */
export type ReminderCommandParse =
  /** Både VAD och NÄR fanns i meningen → one-shot skapa / förhandsvisning. */
  | { complete: true; title: string; args: Record<string, string | number | boolean> }
  /** Bara VAD → fråga enbart efter NÄR. */
  | { complete: false; missing: "when"; title: string }
  /** Bara NÄR → fråga enbart efter VAD. */
  | { complete: false; missing: "title"; args: Record<string, string | number | boolean> }
  /** Varken VAD eller NÄR ("skapa påminnelse") → guidat flöde från början. */
  | { complete: false; missing: "both" };

/** Inledningar som inte hör till titeln: "skapa en påminnelse" / "påminn mig att …". */
function stripReminderLead(text: string): string {
  return text
    .replace(REMINDER_LEAD_RE, "")
    .replace(/^\s*att\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,.!?…]+$/g, "")
    .trim();
}

function parsedArgsFromSlots(slots: ReminderSlots): Record<string, string | number | boolean> {
  const related = slots.title ? relatedFromTitle(slots.title) : undefined;
  return { ...(slots.title ? { title: slots.title } : {}), ...slots.args, ...(related ?? {}) };
}

/**
 * Tolkning av HELA originalfrasen: extraherar intent + argument först,
 * därefter vilka fält som faktiskt saknas. En naken mening ("Ring Göran
 * klockan 8 imorgon") ÄR en påminnelse när vi redan är i kommandot.
 */
export function parseReminderCommandInput(text: string, now: Date, timezone: string): ReminderCommandParse | null {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed || isPaymentReminderQuery(trimmed)) return null;

  const body = hasReminderLead(trimmed) ? stripReminderLead(trimmed) : trimmed;
  const slots = extractReminderSlots(body, now, timezone);

  if (slots.hasWhen && slots.title) {
    return { complete: true, title: slots.title, args: parsedArgsFromSlots(slots) };
  }
  if (slots.title && !slots.hasWhen) {
    return { complete: false, missing: "when", title: slots.title };
  }
  if (slots.hasWhen && !slots.title) {
    return { complete: false, missing: "title", args: parsedArgsFromSlots(slots) };
  }
  // Tomt efter prefix ("skapa påminnelse") eller tom inmatning efter strip.
  if (hasReminderLead(trimmed) && !body) return { complete: false, missing: "both" };
  return body || hasReminderLead(trimmed) ? { complete: false, missing: "both" } : null;
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

/** Tolkade verktygsargument → "Onsdag 2 september kl. 12:00" (eller null). */
export function previewReminderDueFromArgs(
  args: Record<string, string | number | boolean>,
  now: Date,
  timezone: string
): string | null {
  const expr = whenFromReminderArgs(args);
  if (!expr) return null;
  const resolved = resolveWhen(expr, now, timezone);
  if (!resolved.ok) return null;
  return formatDueAtDisplay(resolved.value.dueAt, timezone) || null;
}

/** Kompakt sekundärrad: "Ring Göran · onsdag 2 sep. kl. 12:00". */
export function reminderSuggestionPreview(
  title: string,
  args: Record<string, string | number | boolean>,
  now: Date,
  timezone: string
): string | null {
  const expr = whenFromReminderArgs(args);
  if (!expr) return prettyReminderTitle(title) || null;
  const resolved = resolveWhen(expr, now, timezone);
  if (!resolved.ok) return prettyReminderTitle(title) || null;
  const due = formatDueAtCompact(resolved.value.dueAt, timezone);
  const pretty = prettyReminderTitle(title);
  return pretty ? `${pretty} · ${due}` : due;
}

/** Tolkat förhandsdatum för en ren tidfras i det guidade flödet. */
export function previewReminderDue(whenText: string, now: Date, timezone: string): string | null {
  const whenArgs = parseWhenText(whenText, now, timezone);
  return whenArgs ? previewReminderDueFromArgs(whenArgs, now, timezone) : null;
}
