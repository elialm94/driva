import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatSwedishOrganizationNumber,
  formatSwedishPersonalIdentityNumber,
  formatSwedishPhone,
  formatSwedishPostalCode,
  normalizeSwedishOcr,
  normalizeSwedishOrganizationNumber,
  normalizeSwedishPersonalIdentityNumber,
  normalizeSwedishPhone,
  toE164Swedish,
  normalizeSwedishPostalCode,
  swedishEmailInputProps,
  swedishOrgnrInputProps,
  swedishPersonnummerInputProps,
  swedishPhoneInputProps,
  swedishPostalCodeInputProps,
  validateOnboardingFields,
  validateSwedishBankgiro,
  validateSwedishEmail,
  validateSwedishOcr,
  validateSwedishOrganizationNumber,
  validateSwedishPersonalIdentityNumber,
  validateSwedishPhone,
  validateSwedishPlusgiro,
  validateSwedishPostalCode,
} from "./validation";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");

function source(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

describe("organisationsnummer", () => {
  it("godkänner 10 siffror utan bindestreck och normaliserar till NNNNNN-NNNN", () => {
    const r = validateSwedishOrganizationNumber("5555555555", { required: true });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.normalized, "555555-5555");
      assert.equal(r.formatted, "555555-5555");
    }
    assert.equal(normalizeSwedishOrganizationNumber("5555555555"), "555555-5555");
  });

  it("godkänner 555555-5555", () => {
    const r = validateSwedishOrganizationNumber("555555-5555");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.normalized, "555555-5555");
  });

  it("godkänner mellanslag: 555 555 5555", () => {
    const r = validateSwedishOrganizationNumber("555 555 5555");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.normalized, "555555-5555");
  });

  it("för få siffror ger svensk förklaring", () => {
    const r = validateSwedishOrganizationNumber("555");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "too_few");
      assert.equal(r.message, "Organisationsnumret ska innehålla 10 siffror.");
    }
  });

  it("bokstäver avvisas tydligt", () => {
    const r = validateSwedishOrganizationNumber("55AB555555");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "invalid");
      assert.equal(r.message, "Ange ett giltigt organisationsnummer med 10 siffror.");
    }
  });

  it("tomt och obligatoriskt", () => {
    const r = validateSwedishOrganizationNumber("  ", { required: true });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "empty");
      assert.equal(r.message, "Ange företagets organisationsnummer.");
    }
  });

  it("formaterar bara siffror progressivt utan att kräva bindestreck", () => {
    assert.equal(formatSwedishOrganizationNumber("5555555555"), "555555-5555");
    assert.equal(formatSwedishOrganizationNumber("555555"), "555555");
  });
});

describe("personnummer", () => {
  it("normaliserar YYYYMMDDXXXX och YYYYMMDD-XXXX", () => {
    assert.equal(normalizeSwedishPersonalIdentityNumber("198505151234"), "19850515-1234");
    assert.equal(normalizeSwedishPersonalIdentityNumber("19850515-1234"), "19850515-1234");
    const r = validateSwedishPersonalIdentityNumber("198505151234");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.normalized, "19850515-1234");
  });

  it("stöder kort format YYMMDDXXXX / YYMMDD-XXXX", () => {
    assert.equal(normalizeSwedishPersonalIdentityNumber("8505151234"), "850515-1234");
    assert.equal(normalizeSwedishPersonalIdentityNumber("850515-1234"), "850515-1234");
    assert.equal(validateSwedishPersonalIdentityNumber("8505151234").ok, true);
    assert.equal(formatSwedishPersonalIdentityNumber("8505151234"), "850515-1234");
  });

  it("ogiltigt ger Ange ett giltigt personnummer.", () => {
    const empty = validateSwedishPersonalIdentityNumber("", { required: true });
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.message, "Ange ett giltigt personnummer.");
    const letters = validateSwedishPersonalIdentityNumber("abc");
    assert.equal(letters.ok, false);
    if (!letters.ok) assert.equal(letters.message, "Ange ett giltigt personnummer.");
  });
});

describe("postnummer", () => {
  it("godkänner 11624 och 116 24", () => {
    const a = validateSwedishPostalCode("11624");
    const b = validateSwedishPostalCode("116 24");
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (a.ok) assert.equal(a.normalized, "116 24");
    if (b.ok) assert.equal(b.normalized, "116 24");
    assert.equal(normalizeSwedishPostalCode("11624"), "116 24");
    assert.equal(formatSwedishPostalCode("11624"), "116 24");
  });

  it("ogiltigt postnummer", () => {
    const r = validateSwedishPostalCode("116");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.message, "Ange ett giltigt postnummer.");
  });
});

describe("telefon", () => {
  it("godkänner vanliga svenska format", () => {
    for (const value of ["0701234567", "070-123 45 67", "+46701234567"]) {
      const r = validateSwedishPhone(value);
      assert.equal(r.ok, true, value);
    }
    assert.equal(normalizeSwedishPhone("0701234567"), "070-123 45 67");
    assert.equal(formatSwedishPhone("+46701234567"), "+46 70 123 45 67");
  });

  it("avvisar bokstäver", () => {
    const r = validateSwedishPhone("070-ABC");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.message, "Ange ett giltigt telefonnummer.");
  });

  it("tomt är ok när fältet är valfritt", () => {
    assert.equal(validateSwedishPhone("").ok, true);
  });

  it("normaliserar svenska nummer till E.164 för 46elks", () => {
    assert.equal(toE164Swedish("070-123 45 67"), "+46701234567");
    assert.equal(toE164Swedish("0701234567"), "+46701234567");
    assert.equal(toE164Swedish("+46 70 123 45 67"), "+46701234567");
    assert.equal(toE164Swedish("+46701234567"), "+46701234567");
    assert.equal(toE164Swedish("123"), null);
    assert.equal(toE164Swedish(""), null);
  });
});

describe("e-post", () => {
  it("ogiltig e-post ger svensk text", () => {
    const r = validateSwedishEmail("sara");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.message, "Ange en giltig e-postadress.");
    assert.equal(validateSwedishEmail("sara@example.se").ok, true);
  });
});

describe("bankgiro, plusgiro och OCR", () => {
  it("bankgiro: siffror med eller utan bindestreck", () => {
    assert.equal(validateSwedishBankgiro("56781234").ok, true);
    assert.equal(validateSwedishBankgiro("5678-1234").ok, true);
    const r = validateSwedishBankgiro("56781234");
    if (r.ok) assert.equal(r.normalized, "5678-1234");
  });

  it("plusgiro: siffror med eller utan bindestreck", () => {
    assert.equal(validateSwedishPlusgiro("1234561").ok, true);
    assert.equal(validateSwedishPlusgiro("123456-1").ok, true);
  });

  it("OCR: mellanslag och bindestreck tas bort utan att ändra siffrorna", () => {
    assert.equal(normalizeSwedishOcr("1234 5678-901"), "12345678901");
    assert.equal(validateSwedishOcr("1234 567890").ok, true);
  });
});

describe("onboardingfält", () => {
  it("accepterar siffror-only orgnr och behåller övriga värden", () => {
    const r = validateOnboardingFields({
      name: "Elias Snickarfirma",
      orgNumber: "5555555555",
      email: "almqvist94@hotmail.com",
      phone: "",
    });
    assert.deepEqual(r.fieldErrors, {});
    assert.equal(r.values.orgNumber, "555555-5555");
    assert.equal(r.firstField, undefined);
  });

  it("markerar flera fel och pekar ut första fältet", () => {
    const r = validateOnboardingFields({
      name: "",
      orgNumber: "555",
      email: "inte-epost",
      phone: "abc",
    });
    assert.equal(r.fieldErrors.name, "Ange företagets namn.");
    assert.equal(r.fieldErrors.orgNumber, "Organisationsnumret ska innehålla 10 siffror.");
    assert.equal(r.fieldErrors.email, "Ange en giltig e-postadress.");
    assert.equal(r.fieldErrors.phone, "Ange ett giltigt telefonnummer.");
    assert.equal(r.firstField, "ob-name");
  });
});

describe("inputMode och native-validering i källan", () => {
  it("orgnr/personnummer/postnummer/telefon har numeric/tel-tangentbord", () => {
    assert.equal(swedishOrgnrInputProps.inputMode, "numeric");
    assert.equal(swedishPersonnummerInputProps.inputMode, "numeric");
    assert.equal(swedishPostalCodeInputProps.inputMode, "numeric");
    assert.equal(swedishPhoneInputProps.inputMode, "tel");
    assert.equal(swedishEmailInputProps.type, "email");
  });

  it("onboarding: noValidate, inget pattern, numeric orgnr, svenska fel", () => {
    const src = source("src/app/onboarding/onboarding-form.tsx");
    assert.match(src, /noValidate/);
    assert.doesNotMatch(src, /pattern=/);
    assert.match(src, /swedishOrgnrInputProps/);
    assert.equal(swedishOrgnrInputProps.placeholder, "555555-5555");
    assert.match(src, /validateOnboardingFields/);
    assert.match(src, /inputMode/);
  });

  it("login och signup: noValidate eller useNativeFieldErrors, ingen native e-postbubbla", () => {
    const login = source("src/app/(auth)/login/login-form.tsx");
    assert.match(login, /useNativeFieldErrors|noValidate/);
    assert.doesNotMatch(login, /pattern=/);
  });
});
