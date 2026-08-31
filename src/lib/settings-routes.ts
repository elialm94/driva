export const SETTINGS_HREF = {
  root: "/installningar",
  foretag: "/installningar?flik=foretag",
  fakturering: "/installningar?flik=fakturering",
  standardval: "/installningar?flik=standardval",
  funktioner: "/installningar?flik=funktioner",
  konto: "/installningar?flik=konto",
} as const;

export type SettingsFlik = "foretag" | "fakturering" | "standardval" | "funktioner" | "konto";

export function parseSettingsFlik(raw: string | undefined): SettingsFlik {
  if (raw === "fakturering" || raw === "standardval" || raw === "funktioner" || raw === "konto") return raw;
  return "foretag";
}
