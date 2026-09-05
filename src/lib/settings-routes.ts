export const SETTINGS_HREF = {
  root: "/installningar",
  foretag: "/installningar?flik=foretag",
  fakturering: "/installningar?flik=fakturering",
  funktioner: "/installningar?flik=funktioner",
  grossister: "/installningar?flik=grossister",
  konto: "/installningar?flik=konto",
} as const;

export type SettingsFlik = "foretag" | "fakturering" | "funktioner" | "grossister" | "konto";

export const SETTINGS_TABS: { key: SettingsFlik; label: string; href: string }[] = [
  { key: "foretag", label: "Företag", href: SETTINGS_HREF.foretag },
  { key: "fakturering", label: "Fakturering & betalning", href: SETTINGS_HREF.fakturering },
  { key: "funktioner", label: "Funktioner", href: SETTINGS_HREF.funktioner },
  { key: "grossister", label: "Grossister", href: SETTINGS_HREF.grossister },
  { key: "konto", label: "Konto", href: SETTINGS_HREF.konto },
];

/**
 * Fliken Grossister finns bara när funktionen Grossistbeställningar är aktiv –
 * för alla andra ser Inställningar ut precis som förut.
 */
export function settingsTabsFor(features: { wholesalers: boolean }): typeof SETTINGS_TABS {
  return SETTINGS_TABS.filter((tab) => tab.key !== "grossister" || features.wholesalers);
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
