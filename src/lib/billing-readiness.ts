import {
  collectSellerBlockers,
  isBusinessLevelBlocker,
  QUOTE_BUSINESS_BLOCKER_CODES,
  type IssueBlocker,
  type SellerBlockerInput,
} from "./invoices/seller-blockers";
import { SETTINGS_HREF, type SettingsFlik } from "./settings-routes";

export type SettingsReadinessItemId = "name" | "orgnr" | "vat" | "address" | "payment";

export interface SettingsReadinessItem {
  id: SettingsReadinessItemId;
  /** Primär blocker-kod från collectSellerBlockers. */
  code: string;
  codes: string[];
  label: string;
  /** Extra vägledning, t.ex. att ett betalningssätt räcker. */
  hint?: string;
  flik: Extract<SettingsFlik, "foretag" | "fakturering">;
  field: string;
  fieldId: string;
  href: string;
  message: string;
}

export interface SettingsBillingReadiness {
  ready: boolean;
  missingCount: number;
  blockers: IssueBlocker[];
  items: SettingsReadinessItem[];
  /** Första tre saknade etiketterna – visas i banern utan klick. */
  previewLabels: string[];
  moreCount: number;
  blocksInvoiceSend: boolean;
  blocksQuoteSend: boolean;
  headline: string;
  consequence: string;
  mentionsQuotes: boolean;
}

const FIELD_ID_PREFIX = "installningar-";

export function settingsFieldId(field: string): string {
  return `${FIELD_ID_PREFIX}${field}`;
}

export function settingsFieldHref(flik: Extract<SettingsFlik, "foretag" | "fakturering">, field: string): string {
  return `${SETTINGS_HREF[flik]}&falt=${encodeURIComponent(field)}`;
}

interface ItemDef {
  id: SettingsReadinessItemId;
  codes: string[];
  label: string;
  hint?: string;
  flik: Extract<SettingsFlik, "foretag" | "fakturering">;
  fieldFor(codes: string[]): string;
}

const ITEM_DEFS: ItemDef[] = [
  {
    id: "name",
    codes: ["seller_name"],
    label: "Företagsnamn",
    flik: "foretag",
    fieldFor: () => "name",
  },
  {
    id: "orgnr",
    codes: ["seller_orgnr", "seller_orgnr_format"],
    label: "Organisationsnummer",
    flik: "foretag",
    fieldFor: () => "orgNumber",
  },
  {
    id: "address",
    codes: ["seller_address"],
    label: "Företagsadress",
    flik: "foretag",
    fieldFor: () => "address",
  },
  {
    id: "vat",
    codes: ["seller_vat", "seller_vat_format"],
    label: "Momsregistreringsnummer",
    flik: "foretag",
    fieldFor: () => "vatNumber",
  },
  {
    id: "payment",
    codes: ["seller_bankgiro", "seller_bankgiro_format", "seller_plusgiro_format", "seller_iban_format", "payment_bankgiro"],
    label: "Betalningsuppgifter",
    hint: "Lägg till minst ett betalningssätt.",
    flik: "fakturering",
    fieldFor: (codes) => {
      if (codes.includes("seller_plusgiro_format")) return "plusgiro";
      if (codes.includes("seller_iban_format")) return "iban";
      return "bankgiro";
    },
  },
];

export function groupBusinessBlockers(blockers: readonly IssueBlocker[]): SettingsReadinessItem[] {
  const byCode = new Map(blockers.filter((b) => isBusinessLevelBlocker(b.code)).map((b) => [b.code, b]));
  const items: SettingsReadinessItem[] = [];
  for (const def of ITEM_DEFS) {
    const matched = def.codes.filter((code) => byCode.has(code));
    if (matched.length === 0) continue;
    const primary = byCode.get(matched[0])!;
    const field = def.fieldFor(matched);
    items.push({
      id: def.id,
      code: primary.code,
      codes: matched,
      label: def.label,
      hint: def.id === "payment" ? def.hint : undefined,
      flik: def.flik,
      field,
      fieldId: settingsFieldId(field),
      href: settingsFieldHref(def.flik, field),
      message: primary.message,
    });
  }
  return items;
}

export function settingsBillingCopy(input: {
  missingCount: number;
  blocksInvoiceSend: boolean;
  blocksQuoteSend: boolean;
}): Pick<SettingsBillingReadiness, "headline" | "consequence" | "mentionsQuotes"> {
  if (input.missingCount === 0) {
    return {
      headline: "Redo att fakturera",
      consequence: "Du har fyllt i allt som krävs för att skicka fakturor.",
      mentionsQuotes: false,
    };
  }
  const task =
    input.missingCount === 1
      ? "1 uppgift behöver kompletteras"
      : `${input.missingCount} uppgifter behöver kompletteras`;
  // Säg bara "innan du kan skicka fakturor" när blockers faktiskt ligger i invoice-send.
  const consequence = input.blocksInvoiceSend ? `${task} innan du kan skicka fakturor.` : `${task}.`;
  return {
    headline: "Fakturering kan inte användas än",
    consequence,
    // Offerter blockeras av en mindre delmängd. Nämn dem inte – copy handlar om fakturor.
    mentionsQuotes: false,
  };
}

export function settingsBillingReadiness(seller: SellerBlockerInput): SettingsBillingReadiness {
  const blockers = collectSellerBlockers(seller).filter((b) => isBusinessLevelBlocker(b.code));
  const items = groupBusinessBlockers(blockers);
  const missingCount = items.length;
  const blocksInvoiceSend = missingCount > 0;
  const blocksQuoteSend = blockers.some((b) => QUOTE_BUSINESS_BLOCKER_CODES.has(b.code));
  const previewLabels = items.slice(0, 3).map((item) => item.label);
  const moreCount = Math.max(0, items.length - 3);
  const copy = settingsBillingCopy({ missingCount, blocksInvoiceSend, blocksQuoteSend });
  return {
    ready: missingCount === 0,
    missingCount,
    blockers,
    items,
    previewLabels,
    moreCount,
    blocksInvoiceSend,
    blocksQuoteSend,
    ...copy,
  };
}

export function extraPayFieldsNeeded(field: string | null | undefined): boolean {
  return field === "plusgiro" || field === "iban" || field === "bankAccount" || field === "bic";
}
