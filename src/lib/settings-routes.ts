export const SETTINGS_HREF = {
  root: "/installningar",
  foretag: "/installningar?flik=foretag",
  fakturering: "/installningar?flik=fakturering",
  funktioner: "/installningar?flik=funktioner",
  konto: "/installningar?flik=konto",
} as const;

export type SettingsFlik = "foretag" | "fakturering" | "funktioner" | "konto";

export const SETTINGS_TABS: { key: SettingsFlik; label: string; href: string }[] = [
  { key: "foretag", label: "Företag", href: SETTINGS_HREF.foretag },
  { key: "fakturering", label: "Fakturering & betalning", href: SETTINGS_HREF.fakturering },
  { key: "funktioner", label: "Funktioner", href: SETTINGS_HREF.funktioner },
  { key: "konto", label: "Konto", href: SETTINGS_HREF.konto },
];

export function parseSettingsFlik(raw: string | undefined): SettingsFlik {
  if (raw === "fakturering" || raw === "standardval") return "fakturering";
  if (raw === "funktioner") return "funktioner";
  if (raw === "konto") return "konto";
  return "foretag";
}
