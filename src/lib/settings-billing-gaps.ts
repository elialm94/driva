import type { MissingRequirement } from "./form-requirements";
import type { SettingsTab } from "./settings-validation";
import { SETTINGS_HREF, type SettingsFlik } from "./settings-routes";

/** Vilket fält en fakturerings-blockerare hör till – för fokus och flikbyte. */
const GAP_TARGET: Record<string, { field: string; tab: SettingsTab; label: string }> = {
  seller_name: { field: "name", tab: "foretag", label: "Företagsnamn" },
  seller_orgnr: { field: "orgNumber", tab: "foretag", label: "Organisationsnummer" },
  seller_orgnr_format: { field: "orgNumber", tab: "foretag", label: "Organisationsnummer" },
  seller_vat: { field: "vatNumber", tab: "foretag", label: "Momsregistreringsnummer" },
  seller_vat_format: { field: "vatNumber", tab: "foretag", label: "Momsregistreringsnummer" },
  seller_vat_orgnr: { field: "vatNumber", tab: "foretag", label: "Momsregistreringsnummer" },
  seller_address: { field: "address", tab: "foretag", label: "Adress, postnummer och ort" },
  seller_bankgiro: { field: "bankgiro", tab: "fakturering", label: "Bankgiro, PlusGiro, bankkonto eller IBAN" },
  seller_bankgiro_format: { field: "bankgiro", tab: "fakturering", label: "Bankgiro" },
  seller_plusgiro_format: { field: "plusgiro", tab: "fakturering", label: "PlusGiro" },
  seller_iban_format: { field: "iban", tab: "fakturering", label: "IBAN" },
};

export function addressGapField(form: { address: string; postalCode: string; city: string }): string {
  if (!form.address.trim()) return "address";
  if (!form.postalCode.trim()) return "postalCode";
  return "city";
}

export function settingsBillingGaps(
  blockers: { code: string; message: string }[],
  currentTab: SettingsFlik,
  form: { address: string; postalCode: string; city: string },
  tabHref: (href: string) => string
): MissingRequirement[] {
  return blockers.map((b) => {
    const target = GAP_TARGET[b.code];
    const field = b.code === "seller_address" ? addressGapField(form) : target?.field;
    const tab = target?.tab ?? "foretag";
    const label = target?.label ?? b.message;
    const fieldId = field ? `installningar-${field}` : undefined;
    const onThisTab = tab === currentTab;
    if (onThisTab) {
      return { id: b.code, label, fieldId };
    }
    const href = `${tabHref(SETTINGS_HREF[tab])}${fieldId ? `#${fieldId}` : ""}`;
    return { id: b.code, label: `${label} – fliken ${tab === "fakturering" ? "Fakturering & betalning" : "Företag"}`, href, fieldId };
  });
}
