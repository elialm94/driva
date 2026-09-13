import type { SuggestionDecision, SuggestionEvent } from "./types";

/**
 * Aggregerad förslagskvalitet för admin – beräknas ur suggestion_events som
 * aldrig innehåller motpart, belopp eller dokumentinnehåll. "Falskt positiv"
 * = ett förslag som visades som Säker/Troligt men som människan ändrade,
 * avvisade eller markerade som privat.
 */

export interface DecisionCounts {
  total: number;
  auto: number;
  accepted: number;
  changed: number;
  rejected: number;
  private: number;
  /** (changed + rejected + private) / (alla mänskliga beslut på Säker/Troligt). null = ingen data. */
  falsePositiveRate: number | null;
}

export interface SuggestionQualityReport {
  windowDays: number;
  overall: DecisionCounts;
  byTier: Record<SuggestionEvent["tier"], DecisionCounts>;
  bySource: { source: string; counts: DecisionCounts }[];
  byMerchantType: { merchantType: string; counts: DecisionCounts }[];
  byProvider: { provider: string; counts: DecisionCounts }[];
  humanRequired: { flag: string; count: number }[];
  /** Andel beslut där LLM inte var inblandad (provider null) – "fallback" = deterministiskt. */
  llm: { withLlm: number; withoutLlm: number };
  kbVersions: string[];
  amountBuckets: Record<SuggestionEvent["amountBucket"], number>;
}

function emptyCounts(): DecisionCounts {
  return { total: 0, auto: 0, accepted: 0, changed: 0, rejected: 0, private: 0, falsePositiveRate: null };
}

function add(counts: DecisionCounts, decision: SuggestionDecision): void {
  counts.total += 1;
  counts[decision] += 1;
}

function finish(counts: DecisionCounts, events: SuggestionEvent[]): DecisionCounts {
  const confident = events.filter((e) => e.decision !== "auto" && (e.tier === "saker" || e.tier === "troligt"));
  const wrong = confident.filter((e) => e.decision === "changed" || e.decision === "rejected" || e.decision === "private").length;
  return { ...counts, falsePositiveRate: confident.length > 0 ? wrong / confident.length : null };
}

function group<K extends string>(events: SuggestionEvent[], keyOf: (e: SuggestionEvent) => K | undefined): Map<K, SuggestionEvent[]> {
  const map = new Map<K, SuggestionEvent[]>();
  for (const e of events) {
    const k = keyOf(e);
    if (k == null) continue;
    const list = map.get(k) ?? [];
    list.push(e);
    map.set(k, list);
  }
  return map;
}

function countsFor(events: SuggestionEvent[]): DecisionCounts {
  const c = emptyCounts();
  for (const e of events) add(c, e.decision);
  return finish(c, events);
}

export function suggestionQualityReport(events: SuggestionEvent[], windowDays: number): SuggestionQualityReport {
  const byTier = {
    saker: countsFor(events.filter((e) => e.tier === "saker")),
    troligt: countsFor(events.filter((e) => e.tier === "troligt")),
    osakert: countsFor(events.filter((e) => e.tier === "osakert")),
  };
  const bySource = [...group(events, (e) => e.source).entries()]
    .map(([source, list]) => ({ source, counts: countsFor(list) }))
    .sort((a, b) => b.counts.total - a.counts.total);
  const byMerchantType = [...group(events, (e) => e.merchantType).entries()]
    .map(([merchantType, list]) => ({ merchantType, counts: countsFor(list) }))
    .sort((a, b) => b.counts.total - a.counts.total);
  const byProvider = [...group(events, (e) => e.provider ?? "deterministisk").entries()]
    .map(([provider, list]) => ({ provider, counts: countsFor(list) }))
    .sort((a, b) => b.counts.total - a.counts.total);
  const flagCounts = new Map<string, number>();
  for (const e of events) for (const f of e.humanRequired) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
  const amountBuckets: SuggestionQualityReport["amountBuckets"] = { under_500: 0, "500_5000": 0, over_5000: 0 };
  for (const e of events) amountBuckets[e.amountBucket] += 1;

  return {
    windowDays,
    overall: countsFor(events),
    byTier,
    bySource,
    byMerchantType,
    byProvider,
    humanRequired: [...flagCounts.entries()].map(([flag, count]) => ({ flag, count })).sort((a, b) => b.count - a.count),
    llm: {
      withLlm: events.filter((e) => e.provider).length,
      withoutLlm: events.filter((e) => !e.provider).length,
    },
    kbVersions: [...new Set(events.map((e) => e.kbVersion))].sort(),
    amountBuckets,
  };
}
