export const SETTINGS_HREF = {
  root: "/installningar",
  foretag: "/installningar?flik=foretag",
  fakturering: "/installningar?flik=fakturering",
  konto: "/installningar?flik=konto",
} as const;

export type SettingsFlik = "foretag" | "fakturering" | "konto";

export const SETTINGS_TABS: { key: SettingsFlik; label: string; href: string }[] = [
  { key: "foretag", label: "Företag", href: SETTINGS_HREF.foretag },
  { key: "fakturering", label: "Fakturering & betalning", href: SETTINGS_HREF.fakturering },
  { key: "konto", label: "Konto", href: SETTINGS_HREF.konto },
];

export function parseSettingsFlik(raw: string | undefined): SettingsFlik {
  if (raw === "fakturering" || raw === "standardval") return "fakturering";
  if (raw === "konto") return "konto";
  return "foretag";
}
