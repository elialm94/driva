import {
  validateSwedishEmail,
  validateSwedishOrganizationNumber,
  validateSwedishPhone,
} from "./swedish";

export const ONBOARDING_FIELD_IDS = {
  name: "ob-name",
  orgNumber: "ob-orgnr",
  email: "ob-email",
  phone: "ob-phone",
} as const;

export type OnboardingField = keyof typeof ONBOARDING_FIELD_IDS;

export type OnboardingValues = {
  name: string;
  orgNumber: string;
  email: string;
  phone: string;
};

export type OnboardingValidation = {
  fieldErrors: Partial<Record<OnboardingField, string>>;
  firstField?: string;
  values: OnboardingValues;
};

export function validateOnboardingFields(input: OnboardingValues): OnboardingValidation {
  const fieldErrors: Partial<Record<OnboardingField, string>> = {};
  const name = input.name.trim();
  if (name.length < 2) {
    fieldErrors.name = "Ange företagets namn.";
  }

  const org = validateSwedishOrganizationNumber(input.orgNumber, { required: true });
  if (!org.ok) fieldErrors.orgNumber = org.message;

  const email = validateSwedishEmail(input.email, { required: true });
  if (!email.ok) fieldErrors.email = email.message;

  const phone = validateSwedishPhone(input.phone);
  if (!phone.ok) fieldErrors.phone = phone.message;

  const order: OnboardingField[] = ["name", "orgNumber", "email", "phone"];
  const first = order.find((key) => fieldErrors[key]);

  return {
    fieldErrors,
    firstField: first ? ONBOARDING_FIELD_IDS[first] : undefined,
    values: {
      name,
      orgNumber: org.ok ? org.normalized : input.orgNumber.trim(),
      email: email.ok ? email.normalized : input.email.trim(),
      phone: phone.ok ? phone.normalized : input.phone.trim(),
    },
  };
}

/** För tester: samma fokusordning som UI:t. */
export function firstOnboardingFieldId(errors: Partial<Record<OnboardingField, string>>): string | undefined {
  const order: OnboardingField[] = ["name", "orgNumber", "email", "phone"];
  const first = order.find((key) => errors[key]);
  return first ? ONBOARDING_FIELD_IDS[first] : undefined;
}
