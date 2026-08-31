/**
 * En källa för vart hemsidans kontaktformulär skickar förfrågningar.
 *
 * Lagras som `CompanySettings.websiteNotificationEmail` (valfri override).
 * Tom, blank eller samma som företagets kontaktmail räknas som ingen override
 * – då följer mottagaren `company.email` automatiskt.
 */

export type WebsiteFormRecipientSettings = {
  websiteNotificationEmail?: string | null;
};

export type WebsiteFormRecipientCompany = {
  email: string;
};

/** Sparad egen mottagare, eller undefined om företagets e-post ska användas. */
export function websiteFormRecipientOverride(
  settings: WebsiteFormRecipientSettings | null | undefined,
  company: WebsiteFormRecipientCompany,
): string | undefined {
  const override = settings?.websiteNotificationEmail?.trim() ?? "";
  if (!override) return undefined;
  const companyEmail = company.email.trim();
  if (companyEmail && override.toLowerCase() === companyEmail.toLowerCase()) return undefined;
  return override;
}

/** Kanonisk mottagare: custom override ?? företagets kontaktmail. */
export function resolveWebsiteFormRecipient(
  settings: WebsiteFormRecipientSettings | null | undefined,
  company: WebsiteFormRecipientCompany,
): string {
  return websiteFormRecipientOverride(settings, company) ?? company.email.trim();
}

export function hasWebsiteFormRecipientOverride(
  settings: WebsiteFormRecipientSettings | null | undefined,
  company: WebsiteFormRecipientCompany,
): boolean {
  return websiteFormRecipientOverride(settings, company) !== undefined;
}
