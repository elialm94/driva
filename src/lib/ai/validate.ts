/**
 * Strikt validering av verktygsargument mot verktygets egna JSON-schema
 * (samma `parameters` som skickas till modellen – en källa till sanning).
 *
 * Modellgenererade argument är OPÅLITLIGA: okända nycklar, fel typ, saknade
 * obligatoriska fält och ogiltiga enum-värden avvisas med ett tydligt fel som
 * modellen kan rätta sig efter. Ingen koercion – "25 500" är inte ett tal.
 */

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema & { enum?: unknown[]; description?: string }>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
};

export type ValidatedArgs =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

export function validateToolArgs(schema: Record<string, unknown>, raw: unknown): ValidatedArgs {
  const s = schema as JsonSchema;
  if (raw == null) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Argument måste vara ett objekt." };
  }
  const args = raw as Record<string, unknown>;
  const properties = s.properties ?? {};
  const errors: string[] = [];

  if (s.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!(key in properties)) errors.push(`okänt fält "${key}"`);
    }
  }

  for (const key of s.required ?? []) {
    const v = args[key];
    if (v == null || (typeof v === "string" && v.trim() === "")) {
      errors.push(`"${key}" krävs`);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const prop = properties[key];
    if (!prop || value == null) continue;
    if (prop.type === "string" && typeof value !== "string") {
      errors.push(`"${key}" ska vara en sträng`);
    } else if (prop.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      errors.push(`"${key}" ska vara ett tal`);
    } else if (prop.type === "boolean" && typeof value !== "boolean") {
      errors.push(`"${key}" ska vara true/false`);
    } else if (prop.enum && !prop.enum.includes(value)) {
      errors.push(`"${key}" ska vara en av: ${prop.enum.join(", ")}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, error: `Ogiltiga argument: ${errors.join("; ")}. Inget utfördes.` };
  }
  return { ok: true, value: args };
}
