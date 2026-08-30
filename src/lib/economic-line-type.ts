/**
 * Gemensam radtyp för offert, uppdrag och faktura.
 * Kanoniska värden: LABOR / MATERIAL / TRAVEL / OTHER.
 * Svenska UI-etiketter: Arbete / Material / Resor / Övrigt.
 *
 * `kind` är det lagrade fältet (arbete/material/resor/ovrigt) så äldre
 * dokument och SQL-check behåller sin form. `type` är samma klassning i
 * kanonisk form – skrivs på nya rader och kopieras oförändrat i kedjan.
 */

export const ECONOMIC_LINE_TYPES = ["LABOR", "MATERIAL", "TRAVEL", "OTHER"] as const;
export type EconomicLineType = (typeof ECONOMIC_LINE_TYPES)[number];

/** Lagrad radtyp (svenska nycklar, bakåtkompatibel). */
export const LINE_KINDS = ["arbete", "material", "resor", "ovrigt"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export const LINE_KIND_BY_TYPE: Record<EconomicLineType, LineKind> = {
  LABOR: "arbete",
  MATERIAL: "material",
  TRAVEL: "resor",
  OTHER: "ovrigt",
};

export const LINE_TYPE_BY_KIND: Record<LineKind, EconomicLineType> = {
  arbete: "LABOR",
  material: "MATERIAL",
  resor: "TRAVEL",
  ovrigt: "OTHER",
};

export const LINE_TYPE_LABELS: Record<EconomicLineType, string> = {
  LABOR: "Arbete",
  MATERIAL: "Material",
  TRAVEL: "Resor",
  OTHER: "Övrigt",
};

export const LINE_TYPE_HINTS: Record<EconomicLineType, string> = {
  LABOR: "Kan ge ROT/RUT-avdrag.",
  MATERIAL: "Ger inte ROT/RUT-avdrag.",
  TRAVEL: "Ger inte ROT/RUT-avdrag.",
  OTHER: "Ger inte ROT/RUT-avdrag.",
};

export const TRAVEL_RECLASSIFY_PROMPT = "Restid ger inte ROT/RUT-avdrag. Ändra till Resor?";
export const TRAVEL_RECLASSIFY_ACTION = "Ändra till Resor";

export function isEconomicLineType(value: string | undefined | null): value is EconomicLineType {
  return value === "LABOR" || value === "MATERIAL" || value === "TRAVEL" || value === "OTHER";
}

export function isLineKind(value: string | undefined | null): value is LineKind {
  return value === "arbete" || value === "material" || value === "resor" || value === "ovrigt";
}

/** Tolka äldre/alternativa nycklar utan att gissa från beskrivning. */
export function economicLineTypeFromKind(kind: string | undefined | null): EconomicLineType {
  if (!kind) return "OTHER";
  if (isEconomicLineType(kind)) return kind;
  if (isLineKind(kind)) return LINE_TYPE_BY_KIND[kind];
  if (kind === "labor") return "LABOR";
  if (kind === "travel") return "TRAVEL";
  if (kind === "other") return "OTHER";
  return "OTHER";
}

export function lineKindFromType(type: EconomicLineType): LineKind {
  return LINE_KIND_BY_TYPE[type];
}

export function lineTypeLabel(type: EconomicLineType): string {
  return LINE_TYPE_LABELS[type];
}

export function lineKindLabel(kind: string | undefined | null): string {
  return lineTypeLabel(economicLineTypeFromKind(kind));
}

export function lineTypeHint(type: EconomicLineType): string {
  return LINE_TYPE_HINTS[type];
}

export function defaultUnitForLineType(type: EconomicLineType): string {
  return type === "LABOR" || type === "TRAVEL" ? "tim" : "st";
}

/**
 * En enda plats: bara ARBETE (LABOR) är ROT/RUT-grundande.
 * MATERIAL, TRAVEL och OTHER ingår aldrig i underlaget – samma regel för ROT och RUT.
 */
export function isTaxReductionEligible(
  lineType: EconomicLineType,
  taxReductionType: "rot" | "rut"
): boolean {
  void taxReductionType;
  return lineType === "LABOR";
}

export interface LineClassificationSource {
  type?: string;
  kind?: string;
}

/** Föredra kanonisk `type` om den finns, annars mappa `kind`. Aldrig beskrivning. */
export function lineTypeOf(line: LineClassificationSource): EconomicLineType {
  if (isEconomicLineType(line.type)) return line.type;
  return economicLineTypeFromKind(line.kind);
}

export function lineKindOf(line: LineClassificationSource): LineKind {
  return lineKindFromType(lineTypeOf(line));
}

export function syncDocLineClassification<T extends LineClassificationSource>(
  line: T
): T & { kind: LineKind; type: EconomicLineType } {
  const type = lineTypeOf(line);
  return { ...line, type, kind: lineKindFromType(type) };
}

/**
 * Lättviktsförslag till AI/kommando – inte enda skyddet mot felklassning.
 * Historiska signerade/skickade dokument ska inte skrivas om härifrån.
 */
const TRAVEL_HINT =
  /\b(restid|resetid|resa|resor|milersättning|milersattning|framkörning|framkorning|körningstid|resetillägg|resetillagg|resetimme|resetimmar|körtid|milavgift|milersättning|km-ersättning|kmersättning)\b|\bmil\b/i;
const MATERIAL_HINT =
  /\b(virke|material|luckor|skruv|stommar|trall|beslag|lister|foder|panel|reglar|plintar|bänkskiva|bankskiva)\b/i;
const LABOR_HINT =
  /\b(snickeriarbete|snickeri|arbete|timmar|hantverk|montage|montering|installation|renovering)\b/i;

export function classifyEconomicLineType(description: string): EconomicLineType {
  const text = description.trim();
  if (!text) return "LABOR";
  if (TRAVEL_HINT.test(text)) return "TRAVEL";
  if (MATERIAL_HINT.test(text)) return "MATERIAL";
  if (LABOR_HINT.test(text)) return "LABOR";
  return "LABOR";
}

export function shouldSuggestTravelType(line: LineClassificationSource & { description?: string }): boolean {
  if (lineTypeOf(line) !== "LABOR") return false;
  return classifyEconomicLineType(line.description ?? "") === "TRAVEL";
}
