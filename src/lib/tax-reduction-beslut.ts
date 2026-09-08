/**
 * Importera Skatteverkets ROT/RUT-beslut från JSON. Formatet varierar
 * mellan e-tjänstens exporter – vi läser de fält som faktiskt betyder
 * godkänt / delvis / nekat och belopp.
 */
export type BeslutOutcome = "godkant" | "delvis_godkant" | "nekat";

export interface ParsedBeslut {
  outcome: BeslutOutcome;
  deniedAmount?: number;
  approvedAmount?: number;
  reference?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const n = Number(value.replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(n)) return Math.round(n);
  }
  return undefined;
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), obj[k]]));
  for (const key of keys) {
    if (key in obj) return obj[key];
    const found = lower.get(key.toLowerCase());
    if (found !== undefined) return found;
  }
  return undefined;
}

function outcomeFromText(raw: unknown): BeslutOutcome | undefined {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!t) return undefined;
  if (/(delvis|partial)/.test(t)) return "delvis_godkant";
  if (/(nek|avslag|avvis|denied|reject)/.test(t)) return "nekat";
  if (/(godk|bevilj|approved|granted)/.test(t)) return "godkant";
  return undefined;
}

export function parseBeslutJson(raw: string): ParsedBeslut {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Filen är inte giltig JSON.");
  }
  const root = asRecord(parsed);
  if (!root) throw new Error("JSON måste vara ett objekt.");
  const inner = asRecord(pick(root, ["beslut", "decision", "rotBeslut", "rutBeslut"])) ?? root;

  const outcome =
    outcomeFromText(pick(inner, ["utfall", "outcome", "status", "beslut", "resultat", "result"])) ??
    outcomeFromText(pick(root, ["utfall", "outcome", "status", "beslut"]));
  if (!outcome) throw new Error("Hittade inget beslut (godkänt, delvis eller nekat) i filen.");

  const approved = num(pick(inner, ["godkantBelopp", "approvedAmount", "belopp", "amount", "utbetalt", "payout"]));
  const denied = num(pick(inner, ["nekatBelopp", "deniedAmount", "avslag", "avslagetBelopp"]));
  const reference = String(pick(inner, ["diarienummer", "referens", "reference", "id"]) ?? "").trim() || undefined;

  return {
    outcome,
    approvedAmount: approved,
    deniedAmount: denied,
    reference,
  };
}
