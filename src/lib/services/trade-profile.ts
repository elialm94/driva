import { db, save } from "../store";
import type { OnboardingIndustry } from "../types";

export type TradeProfile = "snickare" | "elektriker" | "vvs" | "malare" | "ovrigt";

/** Branschprofil ur onboardingens områden. Styr bara startregler för leverantörer. */
export function tradeProfileFromIndustries(industries: OnboardingIndustry[]): TradeProfile {
  if (industries.includes("maleri")) return "malare";
  if (industries.includes("el")) return "elektriker";
  if (industries.includes("vvs")) return "vvs";
  if (industries.includes("bygg")) return "snickare";
  return "ovrigt";
}

/**
 * Sparar profilen och sår startregler. Användarens egna regler vinner alltid
 * eftersom categorizeMerchant läser merchantCategoryRules först.
 */
export function applyTradeProfile(profile: TradeProfile): void {
  const data = db();
  data.settings.tradeProfile = profile;
  data.meta.tradeProfile = profile;
  if (profile === "malare") {
    const rules = { ...(data.meta.merchantCategoryRules ?? {}) };
    const now = new Date().toISOString();
    for (const key of ["flügger", "flugger", "beckers"]) {
      if (!rules[key]) rules[key] = { category: "material", count: 1, lastUsedAt: now };
    }
    data.meta.merchantCategoryRules = rules;
  }
  save();
}
