/**
 * Företagsunik autocomplete för prisradsbeskrivningar.
 *
 * Förslag byggs från redan sparade rader i den aktuella tenant-DB:n
 * (offerter, fakturor, uppdrag). Ingen separat historiktabell, ingen LLM.
 * Isolering sker genom att anroparen bara skickar in den redan scopade DB:n –
 * aldrig ett klient-angivet business_id.
 *
 * Historiska dokumenttexter är immutable. Stavfel och engångsvarianter
 * saneras bara i förslagsvyn: normalisering, frekvens, fuzzy match,
 * near-duplicate-kollaps och en per-företag ignore-lista.
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
  ignored?: readonly string[];
}

const LETTER_RE = /\p{L}/u;

export function normalizeLineDescriptionKey(text: string): string {
  return text
    .replace(/[\u00a0\u202f\u2007]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("sv-SE");
}

export function isMeaningfulLineDescription(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  return LETTER_RE.test(trimmed);
}

/** Deterministisk Levenshtein på Unicode-kodpunkter (åäö räknas som ett tecken). */
export function levenshtein(a: string, b: string): number {
  const s = [...a];
  const t = [...b];
  const n = s.length;
  const m = t.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const curr = new Array<number>(m + 1);
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[m] ?? 0;
}

export function readIgnoredLineDescriptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const keys = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const key = normalizeLineDescriptionKey(item);
    if (key) keys.add(key);
  }
  return [...keys];
}

/**
 * Lägg till en term i företagets ignore-lista. Muterar bara meta –
 * historiska rader lämnas orörda.
 */
export function addIgnoredLineDescription(meta: DB["meta"], text: string): string[] {
  const key = normalizeLineDescriptionKey(text);
  const next = new Set(readIgnoredLineDescriptions(meta.ignoredLineDescriptions));
  if (key) next.add(key);
  const list = [...next].sort((a, b) => a.localeCompare(b, "sv"));
  meta.ignoredLineDescriptions = list;
  return list;
}

/**
 * Near-duplicate: mycket lika strängar, men aldrig prefix-av-varandra
 * (Rör vs Rörskydd) och aldrig avstånd 2 på korta ord (Montering vs Demontering).
 */
export function isNearDuplicateKey(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  if (a.startsWith(b) || b.startsWith(a)) return false;
  const dist = levenshtein(a, b);
  const minLen = Math.min(a.length, b.length);
  if (dist === 1 && minLen >= 4) return true;
  if (dist === 2 && minLen >= 10) return true;
  return false;
}

/** Kollapsa bara när vinnaren är etablerad och förloraren är sällsynt. */
export function shouldCollapseNearDuplicate(winnerCount: number, loserCount: number): boolean {
  if (winnerCount < 3) return false;
  if (loserCount >= 3) return false;
  if (loserCount <= 0) return false;
  if (loserCount === 1) return true;
  return winnerCount >= 3 * loserCount;
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

function queryMaxEditDistance(queryLen: number): number {
  if (queryLen <= 3) return 0;
  if (queryLen <= 5) return 1;
  return 2;
}

/**
 * Matchkvalitet mot query.
 * 3 = prefix, 2 = ordprefix, 1 = lätt fuzzy (edit distance).
 */
function matchQuality(normalizedText: string, query: string): { tier: number; dist: number } | null {
  if (!query) return null;
  if (normalizedText.startsWith(query)) return { tier: 3, dist: 0 };
  if (wordPrefixMatch(normalizedText, query)) return { tier: 2, dist: 0 };

  const maxDist = queryMaxEditDistance(query.length);
  if (maxDist <= 0) return null;

  const full = levenshtein(query, normalizedText);
  if (full <= maxDist) return { tier: 1, dist: full };

  const textChars = [...normalizedText];
  const queryLen = [...query].length;
  if (textChars.length > queryLen) {
    const prefix = textChars.slice(0, queryLen).join("");
    const d = levenshtein(query, prefix);
    if (d > 0 && d <= Math.min(maxDist, 1)) return { tier: 1, dist: d };
  }
  return null;
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
  const display = raw.replace(/[\u00a0\u202f\u2007]/g, " ").trim().replace(/\s+/g, " ");
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

function ignoredKeySet(raw: unknown, extra?: readonly string[]): Set<string> {
  const set = new Set(readIgnoredLineDescriptions(raw));
  for (const item of extra ?? []) {
    const key = normalizeLineDescriptionKey(item);
    if (key) set.add(key);
  }
  return set;
}

function collapseNearDuplicates(
  vocab: readonly LineDescriptionVocabEntry[],
  query: string
): LineDescriptionVocabEntry[] {
  const q = normalizeLineDescriptionKey(query);
  const suppressed = new Set<string>();
  for (let i = 0; i < vocab.length; i++) {
    const a = vocab[i];
    if (!a) continue;
    for (let j = i + 1; j < vocab.length; j++) {
      const b = vocab[j];
      if (!b) continue;
      const ka = normalizeLineDescriptionKey(a.text);
      const kb = normalizeLineDescriptionKey(b.text);
      if (!isNearDuplicateKey(ka, kb)) continue;
      const winner = a.count >= b.count ? a : b;
      const loser = a.count >= b.count ? b : a;
      if (!shouldCollapseNearDuplicate(winner.count, loser.count)) continue;
      const loserKey = normalizeLineDescriptionKey(loser.text);
      if (q && q === loserKey) continue;
      suppressed.add(loserKey);
    }
  }
  if (suppressed.size === 0) return [...vocab];
  return vocab.filter((entry) => !suppressed.has(normalizeLineDescriptionKey(entry.text)));
}

/**
 * Bygg en kompakt vokabulär från historiska prisrader i EN tenant-DB.
 * Anroparen måste skicka den redan autentiserat scopade databasen.
 * Ignore-listan filtreras här – dokumentraderna läses bara, skrivs aldrig.
 */
export function collectLineDescriptionVocabulary(
  data: Pick<DB, "quoteVersions" | "invoices" | "jobWorkEntries"> & {
    meta?: Pick<DB["meta"], "ignoredLineDescriptions">;
  }
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

  const ignored = ignoredKeySet(data.meta?.ignoredLineDescriptions);
  return [...acc.values()]
    .map(toVocabEntry)
    .filter((entry) => !ignored.has(normalizeLineDescriptionKey(entry.text)))
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
  const ignored = ignoredKeySet(undefined, options.ignored);
  const candidates = collapseNearDuplicates(
    vocab.filter((entry) => !ignored.has(normalizeLineDescriptionKey(entry.text))),
    q
  );

  const scored: { entry: LineDescriptionVocabEntry; score: number }[] = [];
  for (const entry of candidates) {
    const match = matchQuality(normalizeLineDescriptionKey(entry.text), q);
    if (!match) continue;
    const typeBoost = kind ? (entry.kindCounts[kind] ?? 0) * 50 : 0;
    const frequency = entry.count === 1 ? 200 : entry.count * 10_000;
    const score =
      match.tier * 1_000_000 -
      match.dist * 10_000 +
      frequency +
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
