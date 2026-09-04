process.env.DRIVA_TEST = "1";

/**
 * Momsreg.nr för svenska företag: härlett ur organisationsnumret, aldrig
 * inskrivet. Testerna följer kedjan hela vägen – formulär → sparning →
 * lagring → frusen snapshot → sidfot – plus utländska bolag som fortfarande
 * har ett manuellt fält.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, normalize, replaceDb } from "./store";
import { emptyTestDb, labor, testCompany, testCustomer } from "./invoices/test-db";
import { deriveSwedishVatNumber } from "./invoices/formats";
import { sellerIdentityFooter } from "./invoices/document-view";
import { sellerSnapshot } from "./invoices/snapshot";
import { updateBusinessProfile, getBusinessProfile, applyBusinessProfilePatch } from "./services/settings";
import { requestUpdateBusinessProfile } from "./ai/domain";
import { settingsProfileFieldErrors } from "./settings-validation";
import { createInvoice, issueInvoice } from "./services/invoices";
import { getInvoice } from "./services/data";
import { validateOnboardingFields, companySettingsFromOnboarding } from "./onboarding";

const ORG = "559327-4086";
const VAT = "SE559327408601";

function profileInput(over: Record<string, unknown> = {}) {
  return {
    name: "Calles Bygg AB",
    orgNumber: ORG,
    vatNumber: "",
    email: "info@callesbygg.se",
    phone: "070-123 45 67",
    address: "Renstiernas gata 12",
    postalCode: "116 24",
    city: "Stockholm",
    country: "Sverige",
    bankgiro: "5678-1234",
    logoInitials: "CB",
    ...over,
  } as Parameters<typeof updateBusinessProfile>[0];
}

describe("Momsreg.nr sparas härlett ur org.nr", () => {
  beforeEach(() => replaceDb(emptyTestDb({ settings: testCompany() })));

  it("sparar det härledda numret även när fältet skickas tomt", () => {
    const saved = updateBusinessProfile(profileInput());
    assert.equal(saved.orgNumber, ORG);
    assert.equal(saved.vatNumber, VAT);
  });

  it("ignorerar ett inskrivet momsnummer – org.nr är sanningen", () => {
    const saved = updateBusinessProfile(profileInput({ vatNumber: "SE111111111101" }));
    assert.equal(saved.vatNumber, VAT);
  });

  it("ett nytt org.nr flyttar momsnumret med sig", () => {
    updateBusinessProfile(profileInput());
    const moved = updateBusinessProfile(profileInput({ orgNumber: "556123-4567" }));
    assert.equal(moved.vatNumber, "SE556123456701");
  });

  it("ofullständigt org.nr ger inget halvt momsnummer", () => {
    // Formatvalideringen släpper igenom tomt org.nr; då finns inget att härleda ur.
    const saved = updateBusinessProfile(profileInput({ orgNumber: "" }));
    assert.equal(saved.orgNumber, "");
    assert.equal(saved.vatNumber, "");
  });

  it("validerar inte momsfältet för svenska företag – det finns inget att skriva fel", () => {
    const errors = settingsProfileFieldErrors({
      name: "Calles Bygg AB",
      orgNumber: ORG,
      vatNumber: "helt fel",
      country: "Sverige",
      bankgiro: "5678-1234",
    });
    assert.equal(errors.length, 0);
  });
});

describe("Utländska bolag behåller manuellt momsnummer", () => {
  beforeEach(() => replaceDb(emptyTestDb({ settings: testCompany() })));

  it("sparar det inskrivna numret oförändrat", () => {
    const saved = updateBusinessProfile(
      profileInput({ country: "Tyskland", vatNumber: "DE123456789" })
    );
    assert.equal(saved.country, "Tyskland");
    assert.equal(saved.vatNumber, "DE123456789");
  });

  it("tvingar inte den svenska mallen på ett utländskt nummer", () => {
    const errors = settingsProfileFieldErrors({
      name: "Bau GmbH",
      orgNumber: ORG,
      vatNumber: "DE123456789",
      country: "Tyskland",
      bankgiro: "5678-1234",
    });
    assert.equal(errors.length, 0);
  });

  it("avvisar uppenbart skräp i det utländska fältet", () => {
    const errors = settingsProfileFieldErrors({
      name: "Bau GmbH",
      orgNumber: ORG,
      vatNumber: "12345",
      country: "Tyskland",
      bankgiro: "5678-1234",
    });
    assert.deepEqual(
      errors.map((e) => e.field),
      ["vatNumber"]
    );
  });

  it("byte till Sverige härleder om, byte tillbaka kräver ett eget nummer igen", () => {
    updateBusinessProfile(profileInput({ country: "Tyskland", vatNumber: "DE123456789" }));
    assert.equal(updateBusinessProfile(profileInput()).vatNumber, VAT);
  });

  it("assistenten får ändra momsnummer utomlands men inte i Sverige", () => {
    updateBusinessProfile(profileInput({ country: "Tyskland", vatNumber: "DE123456789" }));
    assert.equal(applyBusinessProfilePatch({ vatNumber: "DE999888777" }).vatNumber, "DE999888777");

    const svenskt = requestUpdateBusinessProfile({ vatNumber: "SE111111111101" });
    assert.equal(svenskt.ok, true);

    updateBusinessProfile(profileInput());
    const avvisad = requestUpdateBusinessProfile({ vatNumber: "SE111111111101" });
    assert.equal(avvisad.ok, false);
    assert.match(avvisad.text, /organisationsnumret/);
  });
});

describe("Befintliga rader normaliseras vid inläsning", () => {
  it("tomt sparat momsnummer fylls i ur org.nr", () => {
    const loaded = normalize(emptyTestDb({ settings: testCompany({ orgNumber: ORG, vatNumber: "" }) }), {
      persistIfDirty: false,
    });
    assert.equal(loaded.settings.vatNumber, VAT);
  });

  it("ett avvikande svenskt momsnummer ersätts av det härledda", () => {
    const loaded = normalize(
      emptyTestDb({ settings: testCompany({ orgNumber: ORG, vatNumber: "SE999999999902" }) }),
      { persistIfDirty: false }
    );
    assert.equal(loaded.settings.vatNumber, VAT);
  });

  it("utan org.nr att härleda ur raderas inte ett sparat nummer", () => {
    const loaded = normalize(
      emptyTestDb({ settings: testCompany({ orgNumber: "", vatNumber: VAT }) }),
      { persistIfDirty: false }
    );
    assert.equal(loaded.settings.vatNumber, VAT);
  });

  it("ett utländskt momsnummer överlever inläsningen", () => {
    const loaded = normalize(
      emptyTestDb({
        settings: testCompany({ orgNumber: ORG, vatNumber: "DE123456789", country: "Tyskland" }),
      }),
      { persistIfDirty: false }
    );
    assert.equal(loaded.settings.vatNumber, "DE123456789");
  });
});

describe("Kom igång härleder utan eget fält", () => {
  it("momsnumret följer org.nr genom validering och sparning", () => {
    const result = validateOnboardingFields({
      name: "Calles Bygg AB",
      orgNumber: "5593274086",
      address: "Renstiernas gata 12",
      postalCode: "11624",
      city: "Stockholm",
      paymentMethod: "bankgiro",
      bankgiro: "56781234",
      plusgiro: "",
      bankAccount: "",
      email: "info@callesbygg.se",
      phone: "",
    });
    assert.deepEqual(result.fieldErrors, {});
    assert.equal(result.values.vatNumber, VAT);
    assert.equal(companySettingsFromOnboarding(result.values).vatNumber, VAT);
  });
});

describe("Utskrifter och frysta dokument", () => {
  beforeEach(() =>
    replaceDb(
      emptyTestDb({
        settings: testCompany({ orgNumber: ORG, vatNumber: "" }),
        customers: [testCustomer({ id: "cust-1" })],
      })
    )
  );

  it("sidfoten visar org.nr och det härledda momsnumret", () => {
    const company = { ...getBusinessProfile(), vatNumber: deriveSwedishVatNumber(ORG) };
    const lines = sellerIdentityFooter(company);
    const identity = lines.lines.at(-1)!.map((t) => t.text);
    assert.ok(identity.includes(`Org.nr ${ORG}`));
    assert.ok(identity.includes(`Momsreg.nr ${VAT}`));
  });

  it("säljarsnapshot fryser det härledda numret", () => {
    assert.equal(sellerSnapshot(getBusinessProfile()).vatNumber, VAT);
  });

  it("en utfärdad faktura behåller sitt frysta momsnummer när org.nr ändras", () => {
    const draft = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor()], rot: null });
    issueInvoice(draft.id);
    db().settings.orgNumber = "556123-4567";
    assert.equal(getInvoice(draft.id)?.issuedSnapshot?.seller.vatNumber, VAT);
  });
});
