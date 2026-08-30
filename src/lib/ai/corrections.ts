/**
 * Korrektionsupplösning: argument är tillstånd som uppdateras genom meningen.
 *
 * Pipeline: helt yttrande → kandidater + markörer → senaste TYDLIGA
 * rättelsen vinner. Negerade värden släcks. Tvetydiga alternativ
 * ("12 eller 10") ger en klargörandefråga – vi gissar inte.
 *
 * Bara SLUTLIGT tillstånd går till verktyg. Kandidathistoriken hålls
 * internt för tester/felsökning.
 *
 * OpenRouter: vid motstridiga kandidater ELLER rättelsespråk med låg
 * deterministisk konfidens → samma befintliga verktygsloop, HELA
 * originalfrasen, aldrig avhuggen. Ingen separat LLM-påminnelseväg.
 */

import {
  collapseUtterance,
  extractAllCandidates,
  findCorrectionMarkers,
  identifyUtteranceIntent,
  padClock,
  type ArgCandidate,
  type ArgKind,
  type MarkerKind,
  type UtteranceIntent,
  type UtteranceMarker,
} from "./utterance";

export type CandidateStatus = "active" | "superseded" | "negated";

export interface ResolvedCandidate extends ArgCandidate {
  status: CandidateStatus;
}

export type ResolveConfidence = "high" | "low" | "ambiguous";

export interface CorrectionResolution {
  original: string;
  intent: UtteranceIntent;
  hasCorrectionLanguage: boolean;
  confidence: ResolveConfidence;
  candidates: ResolvedCandidate[];
  /** Slutgiltigt värde per argumenttyp. */
  final: Partial<Record<ArgKind, string | number>>;
  /** Extra flaggor för vinnande veckodag. */
  finalNextWeek?: boolean;
  clarify?: string;
  /**
   * Sant när deterministisk upplösning är osäker OCH det finns
   * rättelsespråk eller motstridiga kandidater – då ska OpenRouter
   * strukturerad extraktion köras på HELA originalfrasen.
   */
  needsStructuredExtraction: boolean;
}

const CREATE_REMINDER_FIELDS = [
  "title",
  "description",
  "whenIso",
  "whenDate",
  "weekday",
  "nextWeek",
  "time",
  "daypart",
  "relativeMinutes",
  "relativeHours",
  "relativeDays",
  "relatedType",
  "relatedQuery",
] as const;

function markersBetween(markers: UtteranceMarker[], from: number, to: number): UtteranceMarker[] {
  return markers.filter((m) => m.start >= from && m.end <= to);
}

function kindsOf(markers: UtteranceMarker[]): Set<MarkerKind> {
  return new Set(markers.map((m) => m.kind));
}

function formatValue(kind: ArgKind, value: string | number): string {
  if (kind === "time" && typeof value === "string") return value;
  if (kind === "amount" && typeof value === "number") return value.toLocaleString("sv-SE");
  if (kind === "quantity" && typeof value === "number") return String(value);
  return String(value);
}

function clarifyKindLabel(kind: ArgKind): { which: string; noun: string } {
  switch (kind) {
    case "time":
      return { which: "Vilken tid", noun: "tid" };
    case "weekday":
    case "date":
      return { which: "Vilken dag", noun: "dag" };
    case "name":
      return { which: "Vilken kund", noun: "kund" };
    case "amount":
      return { which: "Vilket belopp", noun: "belopp" };
    case "quantity":
      return { which: "Vilket antal", noun: "antal" };
    case "phone":
      return { which: "Vilket telefonnummer", noun: "nummer" };
  }
}

export function formatClarifyQuestion(kind: ArgKind, values: Array<string | number>): string {
  const { which } = clarifyKindLabel(kind);
  const shown =
    kind === "time"
      ? [...values].map((v) => String(v)).sort()
      : values.map((v) => formatValue(kind, v));
  return `${which} vill du använda - ${shown.join(" eller ")}?`;
}

function resolveKind(
  kind: ArgKind,
  candidates: ArgCandidate[],
  markers: UtteranceMarker[]
): { resolved: ResolvedCandidate[]; confidence: ResolveConfidence; clarify?: string } {
  const ofKind = candidates.filter((c) => c.kind === kind).sort((a, b) => a.start - b.start);
  if (ofKind.length === 0) return { resolved: [], confidence: "high" };

  const resolved: ResolvedCandidate[] = ofKind.map((c) => ({ ...c, status: "active" as const }));
  let confidence: ResolveConfidence = "high";
  let clarify: string | undefined;
  let cursor = 0;

  for (let i = 0; i < ofKind.length; i++) {
    const current = ofKind[i];
    const between = markersBetween(markers, cursor, current.start);
    const kinds = kindsOf(between);
    const prevActiveIdx = resolved.findIndex((r, idx) => idx < i && r.status === "active");

    if (prevActiveIdx >= 0) {
      const prev = resolved[prevActiveIdx];
      const sameValue = prev.value === current.value;
      const negationBeforePrev = markers.some(
        (m) => m.kind === "negation" && m.end <= prev.start && prev.start - m.end <= 24
      );
      if (sameValue) {
        resolved[i].status = "active";
        prev.status = "superseded";
      } else if (kinds.has("alternative") && !kinds.has("correction") && !kinds.has("negation")) {
        confidence = "ambiguous";
        clarify = formatClarifyQuestion(kind, [prev.value, current.value]);
        resolved[i].status = "active";
      } else if (negationBeforePrev || kinds.has("negation")) {
        prev.status = "negated";
        resolved[i].status = "active";
      } else if (kinds.has("correction")) {
        prev.status = "superseded";
        resolved[i].status = "active";
      } else {
        // Två olika värden utan markör – inte en tydlig rättelse.
        confidence = "low";
        resolved[i].status = "active";
        prev.status = "superseded";
      }
    }

    cursor = current.end;
  }

  // "inte X" utan efterföljande ersättning: negera X.
  for (const m of markers) {
    if (m.kind !== "negation") continue;
    const target = resolved.find((r) => r.start >= m.end && r.start - m.end <= 24);
    if (target && !resolved.some((r) => r.start > target.end && r.status === "active")) {
      // Ersättning kan sitta efter; om det finns en active efter, låt den vara.
    }
    if (target) {
      const laterActive = resolved.some((r) => r.start > target.end && r.status === "active" && r.value !== target.value);
      if (laterActive || markers.some((x) => x.kind === "correction" && x.start >= target.end)) {
        target.status = "negated";
      } else if (!laterActive && resolved.filter((r) => r.status === "active").length > 1) {
        target.status = "negated";
      }
    }
  }

  // En active per kind: sista active vinner om flera blev active via low-confidence last-write.
  const actives = resolved.filter((r) => r.status === "active");
  if (actives.length > 1 && confidence !== "ambiguous") {
    const last = actives[actives.length - 1]!;
    for (const r of resolved) {
      if (r.status === "active" && r !== last && r.value !== last.value) {
        r.status = "superseded";
      }
    }
  }

  return { resolved, confidence, clarify };
}

export function resolveUtteranceCorrections(text: string): CorrectionResolution {
  const original = collapseUtterance(text);
  const intent = identifyUtteranceIntent(original);
  const markers = findCorrectionMarkers(original);
  const hasCorrectionLanguage = markers.some((m) => m.kind === "correction" || m.kind === "negation");
  const extracted = extractAllCandidates(original, markers);

  const byKind: ArgKind[] = ["time", "weekday", "date", "amount", "quantity", "name", "phone"];
  const candidates: ResolvedCandidate[] = [];
  let confidence: ResolveConfidence = "high";
  let clarify: string | undefined;

  for (const kind of byKind) {
    const part = resolveKind(kind, extracted, markers);
    candidates.push(...part.resolved);
    if (part.confidence === "ambiguous") {
      confidence = "ambiguous";
      clarify = clarify ?? part.clarify;
    } else if (part.confidence === "low" && confidence !== "ambiguous") {
      confidence = "low";
    }
  }

  const final: Partial<Record<ArgKind, string | number>> = {};
  let finalNextWeek: boolean | undefined;
  if (confidence !== "ambiguous") {
    for (const kind of byKind) {
      const active = [...candidates].reverse().find((c) => c.kind === kind && c.status === "active");
      if (active) {
        final[kind] = active.value;
        if (kind === "weekday") finalNextWeek = active.nextWeek === true;
      }
    }
  }

  const conflicting =
    byKind.some((kind) => {
      const vals = new Set(
        candidates.filter((c) => c.kind === kind && c.status !== "negated").map((c) => String(c.value))
      );
      return vals.size > 1;
    });

  const needsStructuredExtraction =
    confidence !== "ambiguous" &&
    ((hasCorrectionLanguage && confidence === "low") || (conflicting && confidence === "low"));

  return {
    original,
    intent,
    hasCorrectionLanguage,
    confidence,
    candidates: candidates.sort((a, b) => a.start - b.start),
    final,
    finalNextWeek,
    clarify,
    needsStructuredExtraction,
  };
}

/**
 * Tar bort supersedade/negerade kandidater och rättelsemarkörer så att
 * befintliga first-match-parsers ser BARA det slutliga värdet.
 */
export function collapseCorrectedUtterance(text: string, resolution?: CorrectionResolution): string {
  const original = collapseUtterance(text);
  const r = resolution ?? resolveUtteranceCorrections(original);
  const markers = findCorrectionMarkers(original);
  const drop: Array<{ start: number; end: number }> = [
    ...markers,
    ...r.candidates.filter((c) => c.status === "superseded" || c.status === "negated"),
  ].sort((a, b) => b.start - a.start);

  let out = original;
  for (const span of drop) {
    out = `${out.slice(0, span.start)} ${out.slice(span.end)}`;
  }
  out = out
    .replace(/\b(?:att)\s+(?=att\b)/gi, " ")
    .replace(/[.,;:!?…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return collapseDuplicatePhrase(out);
}

function collapseDuplicatePhrase(s: string): string {
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 2) return s;
  const cleaned = words.filter((w) => !/^(?:att|och)$/i.test(w));
  for (let len = Math.floor(cleaned.length / 2); len >= 2; len--) {
    const a = cleaned.slice(0, len).join(" ");
    const b = cleaned.slice(len).join(" ");
    if (a.toLowerCase() === b.toLowerCase()) return a;
  }
  // "ringa Göran ringa Göran"
  for (let len = Math.floor(words.length / 2); len >= 2; len--) {
    const a = words.slice(0, len).join(" ");
    const b = words.slice(len).join(" ");
    if (a.toLowerCase() === b.toLowerCase()) return a;
  }
  return s;
}

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

/** Visning och persisterad titel: "ringa Göran" → "Ring Göran". */
export function prettyReminderTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t) return t;
  const words = t.split(" ");
  const first = words[0]?.toLowerCase() ?? "";
  if (INFINITIVE_HEAD[first]) {
    words[0] = INFINITIVE_HEAD[first];
    return words.join(" ");
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function shouldFallbackToStructuredExtraction(resolution: CorrectionResolution): boolean {
  return resolution.needsStructuredExtraction;
}

/**
 * En avslutad strukturerad extraktion (OpenRouter-verktygsanrop eller
 * test-stub) → platta create_reminder-argument. Hitta ALDRIG på fält.
 */
export function reminderArgsFromStructuredExtraction(
  extracted: Record<string, unknown>
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const key of CREATE_REMINDER_FIELDS) {
    const v = extracted[key];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[key] = v;
    }
  }
  if (typeof out.time === "string") {
    const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(out.time);
    if (m) out.time = padClock(Number(m[1]), m[2] != null ? Number(m[2]) : 0);
  }
  if (typeof out.title === "string") out.title = prettyReminderTitle(out.title);
  return out;
}

/** Senaste tydliga belopp, eller null om tvetydigt/saknas. */
export function resolveAmount(text: string): number | null {
  const r = resolveUtteranceCorrections(text);
  if (r.confidence === "ambiguous") return null;
  return typeof r.final.amount === "number" ? r.final.amount : null;
}

/** Senaste tydliga timantal. */
export function resolveQuantityHours(text: string): number | null {
  const r = resolveUtteranceCorrections(text);
  if (r.confidence === "ambiguous") return null;
  return typeof r.final.quantity === "number" ? r.final.quantity : null;
}

/** Senaste tydliga kundnamn. */
export function resolveCustomerNameArg(text: string): string | null {
  const r = resolveUtteranceCorrections(text);
  if (r.confidence === "ambiguous") return null;
  return typeof r.final.name === "string" ? r.final.name : null;
}

/** Senaste tydliga telefonnummer. */
export function resolvePhoneArg(text: string): string | null {
  const r = resolveUtteranceCorrections(text);
  if (r.confidence === "ambiguous") return null;
  return typeof r.final.phone === "string" ? r.final.phone : null;
}

/** CTA: "Skapa påminnelse / Ring Göran / Söndag 30 augusti kl 10:00". */
export function formatResolvedCommandCta(parts: { command: string; detail?: string; when?: string }): string {
  return [parts.command, parts.detail, parts.when].filter(Boolean).join(" / ");
}

export function timeCandidateHistory(resolution: CorrectionResolution): Array<{
  value: string;
  status: CandidateStatus;
}> {
  return resolution.candidates
    .filter((c) => c.kind === "time")
    .map((c) => ({ value: String(c.value), status: c.status }));
}
