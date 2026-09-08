/**
 * Notiser till företagaren – ren modul utan serverberoenden så att
 * Inställningar → Notiser och utskicksvägarna delar samma regler.
 *
 * Principen: bara händelser som sker UTANFÖR appen mejlas (kundens svar,
 * hemsidans formulär, dokument via mejl). Allt är på tills företagaren
 * stänger av något – en ny händelsetyp når alltså fram utan inställning.
 */

import type { CompanySettings, OwnerNoticeKind, OwnerNoticeSettings } from "../types";
import { isEmailFormat } from "../settings-validation";

export const OWNER_NOTICE_KINDS: OwnerNoticeKind[] = [
  "offert_godkand",
  "offert_avbojd",
  "forfragan",
  "inkorg",
  "orderbekraftelse",
];

export const OWNER_NOTICE_COPY: Record<OwnerNoticeKind, { label: string; description: string }> = {
  offert_godkand: {
    label: "Kunden godkänner en offert",
    description: "Vem som godkände, beloppet och en länk till uppdraget som nu kan startas.",
  },
  offert_avbojd: {
    label: "Kunden avböjer en offert",
    description: "Kundens eventuella skäl, så att du kan följa upp direkt.",
  },
  forfragan: {
    label: "Ny förfrågan från hemsidan",
    description: "Kundens meddelande och kontaktuppgifter. Uppdraget finns redan i Driva.",
  },
  inkorg: {
    label: "Faktura eller kvitto kommer in via mejl",
    description: "Om dokumentet bokfördes automatiskt eller behöver kontrolleras.",
  },
  orderbekraftelse: {
    label: "Orderbekräftelse från grossisten",
    description: "Om leveransen stämmer med beställningen eller avviker (restnoterat, annat pris).",
  },
};

type NoticeSettingsSource = Pick<CompanySettings, "email" | "notices">;

/** Sparad egen mottagare, eller undefined när företagets e-post gäller. */
export function ownerNoticeOverride(settings: NoticeSettingsSource): string | undefined {
  const override = settings.notices?.email?.trim() ?? "";
  if (!override) return undefined;
  const companyEmail = settings.email.trim();
  if (companyEmail && override.toLowerCase() === companyEmail.toLowerCase()) return undefined;
  return override;
}

/** Adressen notiser går till – bara en giltig adress, annars undefined (ingen notis). */
export function ownerNoticeRecipient(settings: NoticeSettingsSource): string | undefined {
  const to = ownerNoticeOverride(settings) ?? settings.email.trim();
  return to && isEmailFormat(to) ? to : undefined;
}

export function ownerNoticeEnabled(settings: Pick<CompanySettings, "notices">, kind: OwnerNoticeKind): boolean {
  return !(settings.notices?.off ?? []).includes(kind);
}

export function isOwnerNoticeKind(value: unknown): value is OwnerNoticeKind {
  return typeof value === "string" && (OWNER_NOTICE_KINDS as string[]).includes(value);
}

/**
 * Normaliserar det som sparas: ogiltiga händelser filtreras, dubbletter tas
 * bort och en override som är tom eller lika med företagets e-post blir ingen
 * override. Allt på + ingen egen adress ⇒ undefined (inget att lagra).
 */
export function normalizeOwnerNoticeSettings(
  input: { email?: string | null; off?: readonly string[] | null },
  company: Pick<CompanySettings, "email">,
): OwnerNoticeSettings | undefined {
  const email = ownerNoticeOverride({ email: company.email, notices: { email: input.email ?? undefined } });
  const off = OWNER_NOTICE_KINDS.filter((kind) => (input.off ?? []).includes(kind));
  if (!email && off.length === 0) return undefined;
  return { ...(email ? { email } : {}), ...(off.length > 0 ? { off } : {}) };
}
