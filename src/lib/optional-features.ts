/**
 * Katalog för valfria funktioner – klientsäker: inga store-/fs-importer.
 * Aktivering, avstängning och backfill bor i features.ts (server).
 */

export const OPTIONAL_FEATURE_IDS = ["website", "collaboration", "wholesalers"] as const;
export type OptionalFeatureId = (typeof OPTIONAL_FEATURE_IDS)[number];

export type OptionalFeatures = {
  website?: boolean;
  collaboration?: boolean;
  wholesalers?: boolean;
};

export type ResolvedOptionalFeatures = {
  website: boolean;
  collaboration: boolean;
  wholesalers: boolean;
};

/**
 * Dit användaren landar efter Aktivera. Grossistbeställningar har ingen egen
 * meny eller sida – funktionen bor i uppdragets materialyta och under
 * Inställningar → Grossister.
 */
export const OPTIONAL_FEATURE_HREF: Record<OptionalFeatureId, string> = {
  website: "/hemsida",
  collaboration: "/samarbeta",
  wholesalers: "/installningar?flik=grossister",
};

export const OPTIONAL_FEATURE_COPY: Record<
  OptionalFeatureId,
  {
    title: string;
    description: string;
    activate: string;
    deactivate: string;
    statusActive: string;
    statusInactive: string;
    deactivateConfirmTitle: string;
    deactivateConfirmBody: string;
    deactivateConfirmAction: string;
    disabledHint: string;
    activateCta: string;
  }
> = {
  website: {
    title: "Hemsida",
    description: "Skapa och publicera företagets hemsida.",
    activate: "Aktivera",
    deactivate: "Stäng av",
    statusActive: "Aktiv",
    statusInactive: "Avstängd",
    deactivateConfirmTitle: "Stänga av Hemsida?",
    deactivateConfirmBody:
      "Din publicerade hemsida pausas och Hemsida försvinner från menyn. Innehåll, tema, domän och inställningar sparas så att du kan fortsätta senare.",
    deactivateConfirmAction: "Stäng av hemsida",
    disabledHint: "Hemsida är avstängd.",
    activateCta: "Aktivera Hemsida",
  },
  collaboration: {
    title: "Samarbeta",
    description: "Arbeta tillsammans med din redovisningskonsult.",
    activate: "Aktivera",
    deactivate: "Stäng av",
    statusActive: "Aktiv",
    statusInactive: "Avstängd",
    deactivateConfirmTitle: "Stänga av Samarbeta?",
    deactivateConfirmBody:
      "Din redovisningskonsult förlorar åtkomst till företaget. Historik och inställningar sparas så att du kan aktivera funktionen igen senare.",
    deactivateConfirmAction: "Stäng av Samarbeta",
    disabledHint: "Samarbeta är avstängd.",
    activateCta: "Aktivera Samarbeta",
  },
  wholesalers: {
    title: "Grossistbeställningar",
    description: "Sök material med dina priser och skicka beställningar till grossisten.",
    activate: "Aktivera",
    deactivate: "Stäng av",
    statusActive: "Aktiv",
    statusInactive: "Avstängd",
    deactivateConfirmTitle: "Stänga av Grossistbeställningar?",
    deactivateConfirmBody:
      "Grossistsöket försvinner från uppdragens materialyta och fliken Grossister döljs. Anslutningar, prisfiler, artiklar och beställningshistorik sparas så att du kan aktivera funktionen igen senare.",
    deactivateConfirmAction: "Stäng av Grossistbeställningar",
    disabledHint: "Grossistbeställningar är avstängd.",
    activateCta: "Aktivera Grossistbeställningar",
  },
};

export function isOptionalFeatureId(value: unknown): value is OptionalFeatureId {
  return value === "website" || value === "collaboration" || value === "wholesalers";
}

export function optionalFeatureHref(id: OptionalFeatureId): string {
  return OPTIONAL_FEATURE_HREF[id];
}
