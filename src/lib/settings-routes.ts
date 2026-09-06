export const SETTINGS_HREF = {
  root: "/installningar",
  foretag: "/installningar?flik=foretag",
  fakturering: "/installningar?flik=fakturering",
  funktioner: "/installningar?flik=funktioner",
  grossister: "/installningar?flik=grossister",
  konto: "/installningar?flik=konto",
} as const;

export type SettingsFlik = "foretag" | "fakturering" | "funktioner" | "grossister" | "konto";

/** Standardflikarna – exakt som innan Grossistbeställningar fanns. */
export const SETTINGS_TABS: { key: SettingsFlik; label: string; href: string }[] = [
  { key: "foretag", label: "Företag", href: SETTINGS_HREF.foretag },
  { key: "fakturering", label: "Fakturering & betalning", href: SETTINGS_HREF.fakturering },
  { key: "funktioner", label: "Funktioner", href: SETTINGS_HREF.funktioner },
  { key: "konto", label: "Konto", href: SETTINGS_HREF.konto },
];

const GROSSISTER_TAB = { key: "grossister", label: "Grossister", href: SETTINGS_HREF.grossister } as const;

/**
 * Fliken Grossister finns bara när funktionen Grossistbeställningar är aktiv –
 * för alla andra ser Inställningar ut precis som förut.
 */
export function settingsTabsFor(features: { wholesalers: boolean }): typeof SETTINGS_TABS {
  if (!features.wholesalers) return SETTINGS_TABS;
  const index = SETTINGS_TABS.findIndex((t) => t.key === "funktioner") + 1;
  return [...SETTINGS_TABS.slice(0, index), GROSSISTER_TAB, ...SETTINGS_TABS.slice(index)];
}

export const SETTINGS_FALT_PARAM = "falt";

const SETTINGS_FIELDS = new Set([
  "name",
  "orgNumber",
  "vatNumber",
  "address",
  "postalCode",
  "city",
  "bankgiro",
  "plusgiro",
  "bankAccount",
  "iban",
  "bic",
]);

export function parseSettingsFlik(raw: string | undefined): SettingsFlik {
  if (raw === "fakturering" || raw === "standardval") return "fakturering";
  if (raw === "funktioner") return "funktioner";
  if (raw === "grossister") return "grossister";
  if (raw === "konto") return "konto";
  return "foretag";
}

export function parseSettingsFalt(raw: string | undefined): string | null {
  if (!raw) return null;
  return SETTINGS_FIELDS.has(raw) ? raw : null;
}
