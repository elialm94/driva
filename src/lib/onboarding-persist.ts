/**
 * Server-/testväg: sparar Kom igång mot samma settings-tjänst som Inställningar.
 * Hålls skild från onboarding.ts så klientformuläret inte drar in store/fs.
 */
import { onboardingToBusinessProfile, type OnboardingPersistInput } from "./onboarding";
import { updateBusinessProfile } from "./services/settings";
import type { CompanySettings } from "./types";

export function applyOnboardingProfile(input: OnboardingPersistInput): CompanySettings {
  return updateBusinessProfile(onboardingToBusinessProfile(input));
}
