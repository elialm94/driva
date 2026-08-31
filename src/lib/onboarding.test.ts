process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "./store";
import { emptyTestDb, labor, testCompany } from "./invoices/test-db";
import { createCustomer } from "./services/customers";
import { createInvoice, issueInvoice } from "./services/invoices";
import { collectIssueErrors, collectSellerBlockers, InvoiceNotReadyError } from "./invoices/validate";
import { billingReadiness, getBusinessProfile } from "./services/settings";
import { settingsFromRow, settingsToRow } from "./storage/mappers";
import { applyOnboardingProfile } from "./onboarding-persist";
import {
  companySettingsFromOnboarding,
  firstOnboardingFieldId,
  needsCompanyOnboarding,
  readOnboardingFormData,
  suggestedOnboardingVatNumber,
  validateOnboardingFields,
  type OnboardingValues,
} from "./onboarding";

function filled(over: Partial<OnboardingValues> = {}): OnboardingValues {
  return {
    name: "Söders Snickeri AB",
    orgNumber: "5591234567",
    vatNumber: "",
    address: "Renstiernas gata 12",
    postalCode: "11624",
    city: "Stockholm",
    paymentMethod: "bankgiro",
    bankgiro: "56781234",
    plusgiro: "",
    bankAccount: "",
    email: "info@soders.se",
    phone: "",
    ...over,
  };
}

function formDataFrom(values: OnboardingValues): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function emptyCompanyDb() {
  replaceDb(
    emptyTestDb({
      settings: testCompany({
        name: "",
        orgNumber: "",
        vatNumber: "",
        email: "",
        phone: "",
        address: "",
        postalCode: "",
        city: "",
        bankgiro: "",
        plusgiro: undefined,
        bankAccount: undefined,
        iban: undefined,
        logoInitials: "",
      }),
      customers: [],
      invoices: [],
    })
  );
}

const COMPANY_BLOCKER_CODES = new Set([
  "seller_name",
  "seller_orgnr",
  "seller_orgnr_format",
  "seller_vat",
  "seller_vat_format",
  "seller_vat_orgnr",
  "seller_address",
  "seller_bankgiro",
  "seller_bankgiro_format",
  "seller_plusgiro_format",
  "seller_iban_format",
]);

describe("Kom igång-validering", () => {
  it("godkänner 5591234567 / 559123-4567 och föreslår momsreg.nr", () => {
    const a = validateOnboardingFields(filled({ orgNumber: "5591234567" }));
    const b = validateOnboardingFields(filled({ orgNumber: "559123-4567" }));
    assert.deepEqual(a.fieldErrors, {});
    assert.deepEqual(b.fieldErrors, {});
    assert.equal(a.values.orgNumber, "559123-4567");
    assert.equal(b.values.orgNumber, "559123-4567");
    assert.equal(a.values.vatNumber, "SE559123456701");
    assert.equal(suggestedOnboardingVatNumber("559123-4567"), "SE559123456701");
  });

  it("accepterar postnummer 11624 och 116 24", () => {
    const compact = validateOnboardingFields(filled({ postalCode: "11624" }));
    const spaced = validateOnboardingFields(filled({ postalCode: "116 24" }));
    assert.equal(compact.values.postalCode, "116 24");
    assert.equal(spaced.values.postalCode, "116 24");
  });

  it("kräver minst ett betalningssätt och visar bara det valda fältet", () => {
    const missing = validateOnboardingFields(filled({ paymentMethod: "", bankgiro: "" }));
    assert.equal(missing.fieldErrors.paymentMethod, "Välj ett betalningssätt.");
    assert.equal(firstOnboardingFieldId(missing.fieldErrors), "ob-payment-method");

    const plus = validateOnboardingFields(
      filled({ paymentMethod: "plusgiro", bankgiro: "", plusgiro: "123456-1" })
    );
    assert.deepEqual(plus.fieldErrors, {});
    assert.equal(plus.values.plusgiro, "123456-1");
    assert.equal(plus.values.bankgiro, "");

    const account = validateOnboardingFields(
      filled({ paymentMethod: "bankkonto", bankgiro: "", bankAccount: "1234-567 890 12" })
    );
    assert.deepEqual(account.fieldErrors, {});
    assert.equal(account.values.bankAccount, "1234-567 890 12");
  });

  it("behåller alla ifyllda fält och fokuserar första felet", () => {
    const result = validateOnboardingFields(filled({ name: "", city: "" }));
    assert.equal(result.fieldErrors.name, "Ange företagets namn.");
    assert.equal(result.fieldErrors.city, "Ange ort.");
    assert.equal(result.firstField, "ob-name");
    assert.equal(result.values.address, "Renstiernas gata 12");
    assert.equal(result.values.email, "info@soders.se");
  });

  it("telefon är valfri men valideras om den fylls i", () => {
    assert.deepEqual(validateOnboardingFields(filled({ phone: "" })).fieldErrors, {});
    const bad = validateOnboardingFields(filled({ phone: "hej" }));
    assert.equal(bad.fieldErrors.phone, "Ange ett giltigt telefonnummer.");
  });

  it("läser samma fält från FormData som webbläsaren skickar", () => {
    const parsed = readOnboardingFormData(formDataFrom(filled({ orgNumber: "559123-4567", vatNumber: "SE559123456701" })));
    const result = validateOnboardingFields(parsed);
    assert.deepEqual(result.fieldErrors, {});
    assert.equal(result.values.orgNumber, "559123-4567");
    assert.equal(result.values.vatNumber, "SE559123456701");
    assert.equal(result.values.postalCode, "116 24");
    assert.equal(result.values.bankgiro, "5678-1234");
  });
});

describe("Kom igång – befintliga konton", () => {
  it("tvingar inte tillbaka företag som redan finns, även om moms/adress/betalning saknas", () => {
    assert.equal(needsCompanyOnboarding(0), true);
    assert.equal(needsCompanyOnboarding(1), false);
    assert.equal(needsCompanyOnboarding(3), false);
    const incomplete = testCompany({ vatNumber: "", address: "", postalCode: "", city: "", bankgiro: "" });
    assert.ok(collectSellerBlockers(incomplete).length > 0);
    assert.ok(billingReadiness(incomplete).blockers.some((b) => b.code === "seller_vat"));
  });
});

describe("Nytt konto: Kom igång → kund → faktura", () => {
  beforeEach(() => emptyCompanyDb());

  it("sparar i samma inställningar och tar bort företagets fakturablockeringar", () => {
    const result = validateOnboardingFields(readOnboardingFormData(formDataFrom(filled())));
    assert.deepEqual(result.fieldErrors, {});
    applyOnboardingProfile(result.values);

    const settings = getBusinessProfile();
    assert.equal(settings.name, "Söders Snickeri AB");
    assert.equal(settings.orgNumber, "559123-4567");
    assert.equal(settings.vatNumber, "SE559123456701");
    assert.equal(settings.address, "Renstiernas gata 12");
    assert.equal(settings.postalCode, "116 24");
    assert.equal(settings.city, "Stockholm");
    assert.equal(settings.bankgiro, "5678-1234");
    assert.equal(settings.email, "info@soders.se");
    assert.equal(settings.phone, "");
    assert.equal(billingReadiness(settings).ready, true);
    assert.equal(collectSellerBlockers(settings).length, 0);

    const customer = createCustomer({ kind: "privat", name: "Anna Andersson", email: "anna@test.se" });
    assert.equal(customer.address, undefined);

    const invoice = createInvoice({
      customerId: customer.id,
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    const blockers = collectIssueErrors({ invoice, seller: db().settings, buyer: customer });
    const companyCodes = blockers.map((b) => b.code).filter((code) => COMPANY_BLOCKER_CODES.has(code));
    assert.deepEqual(companyCodes, []);
    assert.ok(blockers.some((b) => b.code === "buyer_address"));
    assert.throws(() => issueInvoice(invoice.id), InvoiceNotReadyError);
  });

  it("kan skapa kund med adress och utfärda faktura utan företagsblockeringar", () => {
    applyOnboardingProfile(validateOnboardingFields(filled()).values);
    const customer = createCustomer({
      kind: "privat",
      name: "Karin Kund",
      email: "karin@test.se",
      address: "Folkungagatan 1",
      postalCode: "116 30",
      city: "Stockholm",
    });
    const invoice = createInvoice({
      customerId: customer.id,
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    const blockers = collectIssueErrors({ invoice, seller: getBusinessProfile(), buyer: customer });
    assert.deepEqual(
      blockers.filter((b) => COMPANY_BLOCKER_CODES.has(b.code)),
      []
    );
    const issued = issueInvoice(invoice.id);
    assert.equal(issued.status, "skickad");
    assert.ok(issued.number != null);
  });

  it("speglar samma rader som business_settings (JSON + Supabase-mappers)", () => {
    const settings = companySettingsFromOnboarding(validateOnboardingFields(filled()).values);
    const row = settingsToRow(settings, "biz-1");
    assert.equal(row.vat_number, "SE559123456701");
    assert.equal(row.address, "Renstiernas gata 12");
    assert.equal(row.postal_code, "116 24");
    assert.equal(row.city, "Stockholm");
    assert.equal(row.bankgiro, "5678-1234");
    assert.equal(row.email, "info@soders.se");
    const back = settingsFromRow(row);
    assert.equal(back.vatNumber, settings.vatNumber);
    assert.equal(back.postalCode, settings.postalCode);
    assert.equal(back.bankgiro, settings.bankgiro);
  });
});
