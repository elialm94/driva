/**
 * Katalog för valfria funktioner – klientsäker: inga store-/fs-importer.
 * Aktivering och backfill bor i features.ts (server).
 */

export const OPTIONAL_FEATURE_IDS = ["website", "collaboration"] as const;
export type OptionalFeatureId = (typeof OPTIONAL_FEATURE_IDS)[number];

export type OptionalFeatures = {
  website?: boolean;
  collaboration?: boolean;
};

export type ResolvedOptionalFeatures = {
  website: boolean;
  collaboration: boolean;
};

export const OPTIONAL_FEATURE_HREF: Record<OptionalFeatureId, string> = {
  website: "/hemsida",
  collaboration: "/samarbeta",
};

export const OPTIONAL_FEATURE_COPY: Record<
  OptionalFeatureId,
  { title: string; description: string; activate: string }
> = {
  website: {
    title: "Hemsida",
    description: "Skapa och publicera företagets hemsida.",
    activate: "Aktivera",
  },
  collaboration: {
    title: "Samarbeta",
    description: "Arbeta tillsammans med din redovisningskonsult.",
    activate: "Aktivera",
  },
};

export function isOptionalFeatureId(value: unknown): value is OptionalFeatureId {
  return value === "website" || value === "collaboration";
}

export function optionalFeatureHref(id: OptionalFeatureId): string {
  return OPTIONAL_FEATURE_HREF[id];
}
