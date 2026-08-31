/**
 * Företagsunik autocomplete för prisradsbeskrivningar.
 *
 * Förslag byggs från redan sparade rader i den aktuella tenant-DB:n
 * (offerter, fakturor, uppdrag). Ingen separat historiktabell, ingen LLM.
 * Isolering sker genom att anroparen bara skickar in den redan scopade DB:n –
 * aldrig ett klient-angivet business_id.
 */
import { economicLineTypeFromKind, lineKindFromType, type LineKind } from "./economic-line-type";
import type { DB, DocLine, JobWorkEntry } from "./types";

export const LINE_DESCRIPTION_VOCAB_CAP = 500;
export const LINE_DESCRIPTION_SUGGESTION_LIMIT = 6;
export const LINE_DESCRIPTION_MIN_QUERY = 1;

export interface LineDescriptionVocabEntry {
  /** Visningscasing – vanligaste varianten, vid lika den senast använda. */
  text: string;
  count: number;
  lastUsed: string;
  kindCounts: Partial<Record<LineKind, number>>;
}

export interface RankLineDescriptionOptions {
  kind?: LineKind;
  limit?: number;
  now?: number;
}

const LETTER_RE = /\p{L}/u;

export function normalizeLineDescriptionKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase("sv-SE");
}

export function isMeaningfulLineDescription(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  return LETTER_RE.test(trimmed);
}

function laterIso(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function recencyScore(lastUsed: string, now: number): number {
  const t = Date.parse(lastUsed);
  if (!Number.isFinite(t)) return 0;
  const ageDays = Math.max(0, (now - t) / 86_400_000);
  return Math.max(0, Math.round(365 - ageDays));
}

function wordPrefixMatch(normalizedText: string, query: string): boolean {
  if (!query) return false;
  const parts = normalizedText.split(/[\s/|,;:()\-]+/).filter(Boolean);
  return parts.some((part) => part.startsWith(query));
}

function matchTier(normalizedText: string, query: string): number {
  if (!query) return 0;
  if (normalizedText.startsWith(query)) return 2;
  if (wordPrefixMatch(normalizedText, query)) return 1;
  return 0;
}

function kindOfDocLine(line: Pick<DocLine, "kind" | "type">): LineKind {
  return lineKindFromType(economicLineTypeFromKind(line.type ?? line.kind));
}

function kindOfWorkEntry(entry: Pick<JobWorkEntry, "type">): LineKind {
  return lineKindFromType(economicLineTypeFromKind(entry.type));
}

interface AccEntry {
  variants: Map<string, { count: number; lastUsed: string }>;
  count: number;
  lastUsed: string;
  kindCounts: Partial<Record<LineKind, number>>;
}

function addOccurrence(acc: Map<string, AccEntry>, raw: string, usedAt: string, kind: LineKind) {
  if (!isMeaningfulLineDescription(raw)) return;
  const display = raw.trim().replace(/\s+/g, " ");
  const key = normalizeLineDescriptionKey(display);
  const existing = acc.get(key);
  if (!existing) {
    acc.set(key, {
      variants: new Map([[display, { count: 1, lastUsed: usedAt }]]),
      count: 1,
      lastUsed: usedAt,
      kindCounts: { [kind]: 1 },
    });
    return;
  }
  existing.count += 1;
  existing.lastUsed = laterIso(existing.lastUsed, usedAt);
  existing.kindCounts[kind] = (existing.kindCounts[kind] ?? 0) + 1;
  const variant = existing.variants.get(display);
  if (variant) {
    variant.count += 1;
    variant.lastUsed = laterIso(variant.lastUsed, usedAt);
  } else {
    existing.variants.set(display, { count: 1, lastUsed: usedAt });
  }
}

function pickDisplayCasing(entry: AccEntry): string {
  let bestText = "";
  let bestCount = -1;
  let bestUsed = "";
  for (const [text, variant] of entry.variants) {
    if (
      variant.count > bestCount ||
      (variant.count === bestCount && Date.parse(variant.lastUsed) > Date.parse(bestUsed))
    ) {
      bestText = text;
      bestCount = variant.count;
      bestUsed = variant.lastUsed;
    }
  }
  return bestText;
}

function toVocabEntry(entry: AccEntry): LineDescriptionVocabEntry {
  return {
    text: pickDisplayCasing(entry),
    count: entry.count,
    lastUsed: entry.lastUsed,
    kindCounts: entry.kindCounts,
  };
}

/**
 * Bygg en kompakt vokabulär från historiska prisrader i EN tenant-DB.
 * Anroparen måste skicka den redan autentiserat scopade databasen.
 */
export function collectLineDescriptionVocabulary(
  data: Pick<DB, "quoteVersions" | "invoices" | "jobWorkEntries">
): LineDescriptionVocabEntry[] {
  const acc = new Map<string, AccEntry>();

  for (const version of data.quoteVersions ?? []) {
    const usedAt = version.createdAt ?? "";
    for (const line of version.lines ?? []) {
      addOccurrence(acc, line.description ?? "", usedAt, kindOfDocLine(line));
    }
  }

  for (const invoice of data.invoices ?? []) {
    const usedAt = invoice.issuedAt ?? invoice.createdAt ?? "";
    for (const line of invoice.lines ?? []) {
      addOccurrence(acc, line.description ?? "", usedAt, kindOfDocLine(line));
    }
  }

  for (const entry of data.jobWorkEntries ?? []) {
    const usedAt = entry.updatedAt ?? entry.createdAt ?? entry.date ?? "";
    addOccurrence(acc, entry.description ?? "", usedAt, kindOfWorkEntry(entry));
  }

  return [...acc.values()]
    .map(toVocabEntry)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return Date.parse(b.lastUsed) - Date.parse(a.lastUsed);
    })
    .slice(0, LINE_DESCRIPTION_VOCAB_CAP);
}

export function rankLineDescriptionSuggestions(
  vocab: readonly LineDescriptionVocabEntry[],
  query: string,
  options: RankLineDescriptionOptions = {}
): LineDescriptionVocabEntry[] {
  const q = normalizeLineDescriptionKey(query);
  if (q.length < LINE_DESCRIPTION_MIN_QUERY) return [];

  const now = options.now ?? Date.now();
  const limit = options.limit ?? LINE_DESCRIPTION_SUGGESTION_LIMIT;
  const kind = options.kind;

  const scored: { entry: LineDescriptionVocabEntry; score: number }[] = [];
  for (const entry of vocab) {
    const tier = matchTier(normalizeLineDescriptionKey(entry.text), q);
    if (tier === 0) continue;
    const typeBoost = kind ? (entry.kindCounts[kind] ?? 0) * 50 : 0;
    const score =
      tier * 1_000_000 +
      entry.count * 1_000 +
      recencyScore(entry.lastUsed, now) +
      typeBoost;
    scored.push({ entry, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.text.localeCompare(b.entry.text, "sv");
  });

  const seen = new Set<string>();
  const out: LineDescriptionVocabEntry[] = [];
  for (const row of scored) {
    const key = normalizeLineDescriptionKey(row.entry.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row.entry);
    if (out.length >= limit) break;
  }
  return out;
}
