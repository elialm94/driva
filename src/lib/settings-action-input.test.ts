process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FLIGHT_UNDEFINED,
  buildCompanySettingsActionInput,
  normalizeCompanySettingsInput,
  optionalActionText,
} from "./settings-action-input";
import type { SettingsFormPayload } from "./settings-action-input";

const here = dirname(fileURLToPath(import.meta.url));

function form(over: Partial<SettingsFormPayload> = {}): SettingsFormPayload {
  return {
    name: "Södermalms Snickeri AB",
    orgNumber: "556123-4567",
    vatNumber: "SE556123456701",
    email: "info@test.se",
    websiteNotificationEmail: "",
    phone: "08-123 45 67",
    websiteUrl: "",
    address: "Götgatan 1",
    postalCode: "118 46",
    city: "Stockholm",
    sate: "",
    country: "Sverige",
    bankgiro: "5678-1234",
    plusgiro: "",
    bankAccount: "",
    iban: "",
    bic: "",
    payerBankName: "",
    payerIban: "",
    payerBic: "",
    logoInitials: "SS",
    logoDataUrl: "",
    paymentTermsDays: 30,
    lateInterestRate: 10,
    quoteValidityDays: 30,
    defaultVatRate: 25,
    defaultHourlyRate: "",
    ...over,
  };
}

describe("settings action-payload (Flight)", () => {
  it("tom logotyp och tomt timpris blir null, aldrig undefined", () => {
    const input = buildCompanySettingsActionInput(form());
    assert.equal(input.logoDataUrl, null);
    assert.equal(input.defaultHourlyRate, null);
    assert.equal(Object.values(input).some((v) => v === undefined), false);
    assert.equal(JSON.stringify(input).includes(FLIGHT_UNDEFINED), false);
  });

  it("ifyllt timpris och logotyp följer med", () => {
    const input = buildCompanySettingsActionInput(
      form({ defaultHourlyRate: "550", logoDataUrl: "data:image/png;base64,AAA" })
    );
    assert.equal(input.defaultHourlyRate, 550);
    assert.equal(input.logoDataUrl, "data:image/png;base64,AAA");
  });

  it("normaliserar Flight-token $undefined så logotypvalidering inte smäller", () => {
    const dirty = buildCompanySettingsActionInput(form());
    dirty.logoDataUrl = FLIGHT_UNDEFINED;
    dirty.defaultHourlyRate = FLIGHT_UNDEFINED as unknown as number;
    const clean = normalizeCompanySettingsInput(dirty);
    assert.equal(clean.logoDataUrl, null);
    assert.equal(clean.defaultHourlyRate, null);
    assert.equal(optionalActionText(FLIGHT_UNDEFINED), null);
    assert.equal(optionalActionText(undefined), null);
  });

  it("klienten skickar inte undefined i settings-actionen", () => {
    const src = readFileSync(join(here, "../components/settings-form.tsx"), "utf8");
    assert.match(src, /updateCompanySettingsAction\(buildCompanySettingsActionInput\(form\)\)/);
    assert.equal(src.includes("defaultHourlyRate: form.defaultHourlyRate.trim() === \"\" ? undefined"), false);
  });
});
