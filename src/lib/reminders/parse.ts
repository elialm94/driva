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
import { DAYPARTS, WEEKDAYS_SV, localParts, type Daypart, type WeekdaySv } from "./when";

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
function relatedFromTitle(title: string): { relatedType: string; relatedQuery: string } | undefined {
  const quote = /\boffert(?:en)?\s*(?:nr\s*)?#?(\d+)/i.exec(title);
  if (quote) return { relatedType: "quote", relatedQuery: quote[1] };
  const invoice = /\bfaktura(?:n)?\s*(?:nr\s*)?#?(\d+)/i.exec(title);
  if (invoice) return { relatedType: "invoice", relatedQuery: invoice[1] };
  const capRun = /(?:^|\s)((?:[A-ZÅÄÖ][a-zåäöé]+)(?:\s+[A-ZÅÄÖ][a-zåäöé]+)*)/.exec(title);
  if (capRun) return { relatedType: "customer", relatedQuery: capRun[1].trim() };
  return undefined;
}

export function parseReminderText(text: string, now: Date, timezone: string): ParsedReminder | null {
  // "om" konsumeras bara i "påminn mig om att …" – aldrig i "om två timmar".
  const m = /^\s*påminn(?:a)?(?:\s+mig)?(?:\s+gärna)?(?:\s+om(?=\s+att\b))?\s+(.+)$/i.exec(text.trim());
  if (!m) return null;
  let rest = ` ${m[1].trim()} `;

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

  // Klockslag: "kl 14" / "klockan 14:30" (kombineras med dag ovan; kräver dag)
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
  const title = rest
    .replace(/^\s*att\s+/i, "")
    .replace(/\s+att\s*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,.!]+$/g, "")
    .trim();
  if (!title) return null;

  const related = relatedFromTitle(title);
  return { title, args: { title, ...args, ...(related ?? {}) } };
}
