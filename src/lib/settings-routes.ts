export const SETTINGS_HREF = {
  root: "/installningar",
  foretag: "/installningar?flik=foretag",
  fakturering: "/installningar?flik=fakturering",
  standardval: "/installningar?flik=standardval",
  konto: "/installningar?flik=konto",
} as const;

export type SettingsFlik = "foretag" | "fakturering" | "standardval" | "konto";

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
  if (raw === "fakturering" || raw === "standardval" || raw === "konto") return raw;
  return "foretag";
}

export function parseSettingsFalt(raw: string | undefined): string | null {
  if (!raw) return null;
  return SETTINGS_FIELDS.has(raw) ? raw : null;
}
