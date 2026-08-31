process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, replaceDb } from "./store";
import { emptyTestDb, testCompany } from "./invoices/test-db";
import {
  getBusinessProfile,
  getWebsiteNotificationEmail,
  updateCompanySettings,
  updateWebsiteFormRecipient,
  type CompanySettingsInput,
} from "./services/settings";
import {
  hasWebsiteFormRecipientOverride,
  resolveWebsiteFormRecipient,
  websiteFormRecipientOverride,
} from "./website-form-recipient";

const here = dirname(fileURLToPath(import.meta.url));

function settingsInput(over: Partial<CompanySettingsInput> = {}): CompanySettingsInput {
  const s = getBusinessProfile();
  return {
    name: s.name,
    orgNumber: s.orgNumber,
    vatNumber: s.vatNumber,
    email: s.email,
    websiteNotificationEmail: s.websiteNotificationEmail,
    phone: s.phone,
    websiteUrl: s.websiteUrl,
    address: s.address,
    postalCode: s.postalCode,
    city: s.city,
    sate: s.sate,
    country: s.country,
    bankgiro: s.bankgiro,
    plusgiro: s.plusgiro,
    bankAccount: s.bankAccount,
    iban: s.iban,
    bic: s.bic,
    logoInitials: s.logoInitials,
    logoDataUrl: s.logoDataUrl,
    paymentTermsDays: s.paymentTermsDays,
    lateInterestRate: s.lateInterestRate,
    quoteValidityDays: s.quoteValidityDays ?? 30,
    defaultVatRate: s.defaultVatRate ?? 25,
    defaultHourlyRate: s.defaultHourlyRate,
    defaultQuoteTerms: s.defaultQuoteTerms,
    ...over,
  };
}

describe("resolveWebsiteFormRecipient", () => {
  it("faller tillbaka på företagets e-post utan override", () => {
    assert.equal(
      resolveWebsiteFormRecipient({}, { email: "info@test.se" }),
      "info@test.se",
    );
    assert.equal(
      resolveWebsiteFormRecipient({ websiteNotificationEmail: "" }, { email: "info@test.se" }),
      "info@test.se",
    );
    assert.equal(
      resolveWebsiteFormRecipient({ websiteNotificationEmail: "   " }, { email: "info@test.se" }),
      "info@test.se",
    );
  });

  it("egen mottagare vinner över företagets e-post", () => {
    assert.equal(
      resolveWebsiteFormRecipient(
        { websiteNotificationEmail: "chef@test.se" },
        { email: "info@test.se" },
      ),
      "chef@test.se",
    );
  });

  it("samma adress som företaget räknas som ingen override", () => {
    assert.equal(
      websiteFormRecipientOverride(
        { websiteNotificationEmail: "Info@test.se" },
        { email: "info@test.se" },
      ),
      undefined,
    );
    assert.equal(
      resolveWebsiteFormRecipient(
        { websiteNotificationEmail: "Info@test.se" },
        { email: "info@test.se" },
      ),
      "info@test.se",
    );
    assert.equal(
      hasWebsiteFormRecipientOverride(
        { websiteNotificationEmail: "info@test.se" },
        { email: "info@test.se" },
      ),
      false,
    );
  });

  it("följer ny företagsmail när override saknas", () => {
    const settings = { websiteNotificationEmail: undefined as string | undefined };
    assert.equal(resolveWebsiteFormRecipient(settings, { email: "gammal@test.se" }), "gammal@test.se");
    assert.equal(resolveWebsiteFormRecipient(settings, { email: "ny@test.se" }), "ny@test.se");
  });

  it("behåller egen mottagare när företagsmailen ändras", () => {
    const settings = { websiteNotificationEmail: "chef@test.se" };
    assert.equal(resolveWebsiteFormRecipient(settings, { email: "gammal@test.se" }), "chef@test.se");
    assert.equal(resolveWebsiteFormRecipient(settings, { email: "ny@test.se" }), "chef@test.se");
  });
});

describe("updateWebsiteFormRecipient", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb({ settings: testCompany({ email: "info@test.se" }) }));
  });

  it("sätter egen mottagare och rensar tillbaka till företagets e-post", () => {
    assert.equal(getWebsiteNotificationEmail(), "info@test.se");
    assert.equal(updateWebsiteFormRecipient("chef@test.se"), "chef@test.se");
    assert.equal(db().settings.websiteNotificationEmail, "chef@test.se");
    assert.equal(getWebsiteNotificationEmail(), "chef@test.se");

    assert.equal(updateWebsiteFormRecipient(""), "info@test.se");
    assert.equal(db().settings.websiteNotificationEmail, undefined);
    assert.equal(getWebsiteNotificationEmail(), "info@test.se");
  });

  it("sparar inte företagets adress som override", () => {
    updateWebsiteFormRecipient("chef@test.se");
    assert.equal(updateWebsiteFormRecipient("info@test.se"), "info@test.se");
    assert.equal(db().settings.websiteNotificationEmail, undefined);
  });

  it("vägrar ogiltig e-post", () => {
    assert.throws(() => updateWebsiteFormRecipient("inte-en-adress"), /giltig e-postadress/);
    assert.equal(db().settings.websiteNotificationEmail, undefined);
  });

  it("företagsmail-ändring slår igenom utan override, inte med override", () => {
    updateCompanySettings(settingsInput({ email: "ny@test.se" }));
    assert.equal(getWebsiteNotificationEmail(), "ny@test.se");

    updateWebsiteFormRecipient("chef@test.se");
    updateCompanySettings(settingsInput({ email: "annan@test.se" }));
    assert.equal(getBusinessProfile().email, "annan@test.se");
    assert.equal(getWebsiteNotificationEmail(), "chef@test.se");
    assert.equal(db().settings.websiteNotificationEmail, "chef@test.se");
  });
});

describe("webbformulärets inställning ligger bara på Hemsida", () => {
  it("Inställningar visar inte sektionen Uppdrag från hemsidan", () => {
    const src = readFileSync(join(here, "../components/settings-form.tsx"), "utf8");
    assert.doesNotMatch(src, /Uppdrag från hemsidan/);
    assert.doesNotMatch(src, /id="webbformulär"/);
    assert.doesNotMatch(src, /installningar-websiteNotificationEmail/);
  });

  it("Hemsida redigerar mottagaren på plats utan länk till Inställningar", () => {
    const page = readFileSync(join(here, "../app/(app)/hemsida/page.tsx"), "utf8");
    assert.match(page, /WebsiteFormRecipientCard/);
    assert.doesNotMatch(page, /#webbformulär/);
    assert.doesNotMatch(page, /SETTINGS_HREF/);

    const card = readFileSync(join(here, "../components/website-form-recipient.tsx"), "utf8");
    assert.match(card, /Vart ska nya förfrågningar skickas/);
    assert.match(card, /Använd företagets e-post/);
    assert.match(card, /updateWebsiteFormRecipientAction/);
  });
});
