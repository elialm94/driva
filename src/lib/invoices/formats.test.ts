import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  companyVatNumber,
  deriveSwedishVatNumber,
  formatOrgnr,
  formatPostalCode,
  isForeignVatNumberFormat,
  isOrgnrFormat,
  isPostalCodeFormat,
  isSwedishCountry,
  normalizeOrgnr,
  normalizePostalCode,
} from "./formats";

describe("orgnr-format", () => {
  it("visar progressivt NNNNNN-NNNN och tar bara siffror", () => {
    assert.equal(formatOrgnr(""), "");
    assert.equal(formatOrgnr("559123"), "559123");
    assert.equal(formatOrgnr("5591234"), "559123-4");
    assert.equal(formatOrgnr("5591234567"), "559123-4567");
    assert.equal(formatOrgnr("SE 559123-4567 abc"), "559123-4567");
    assert.equal(formatOrgnr("12312323123123123"), "123123-2312");
    assert.equal(formatOrgnr("abc"), "");
  });

  it("normaliserar 10 siffror till NNNNNN-NNNN", () => {
    assert.equal(normalizeOrgnr("5591234567"), "559123-4567");
    assert.equal(normalizeOrgnr("559123-4567"), "559123-4567");
  });

  it("godkänner format med exakt 10 siffror, avvisar annat", () => {
    assert.equal(isOrgnrFormat("559123-4567"), true);
    assert.equal(isOrgnrFormat("5591234567"), true);
    assert.equal(isOrgnrFormat("559123"), false);
    assert.equal(isOrgnrFormat("12312323123123123"), false);
    assert.equal(isOrgnrFormat("abc"), false);
  });

});

describe("deriveSwedishVatNumber", () => {
  it("härleder SE + org.nr + 01 oavsett inmatningsformat", () => {
    assert.equal(deriveSwedishVatNumber("559327-4086"), "SE559327408601");
    assert.equal(deriveSwedishVatNumber("5593274086"), "SE559327408601");
    assert.equal(deriveSwedishVatNumber("  559327-4086  "), "SE559327408601");
    assert.equal(deriveSwedishVatNumber("559 327 40 86"), "SE559327408601");
  });

  it("härleder inget ur ett org.nr som inte är 10 siffror", () => {
    assert.equal(deriveSwedishVatNumber(""), "");
    assert.equal(deriveSwedishVatNumber("559327"), "");
    assert.equal(deriveSwedishVatNumber("55932740861234"), "");
    assert.equal(deriveSwedishVatNumber("inte ett nummer"), "");
  });
});

describe("isSwedishCountry", () => {
  it("tomt/utelämnat land är Sverige – samma default som CompanySettings", () => {
    assert.equal(isSwedishCountry(undefined), true);
    assert.equal(isSwedishCountry(""), true);
    assert.equal(isSwedishCountry("  Sverige "), true);
    assert.equal(isSwedishCountry("Sweden"), true);
    assert.equal(isSwedishCountry("SE"), true);
  });

  it("andra länder är inte Sverige", () => {
    assert.equal(isSwedishCountry("Norge"), false);
    assert.equal(isSwedishCountry("Tyskland"), false);
    assert.equal(isSwedishCountry("Danmark"), false);
  });
});

describe("companyVatNumber", () => {
  it("svenskt företag: härlett ur org.nr, sparat värde ignoreras", () => {
    assert.equal(
      companyVatNumber({ orgNumber: "559327-4086", vatNumber: "SE000000000001", country: "Sverige" }),
      "SE559327408601"
    );
    // Utan land: Sverige är default.
    assert.equal(companyVatNumber({ orgNumber: "5593274086" }), "SE559327408601");
  });

  it("svenskt företag med ofullständigt org.nr får inget halvt momsnummer", () => {
    assert.equal(companyVatNumber({ orgNumber: "559327", country: "Sverige" }), "");
  });

  it("utländskt företag behåller sitt manuella momsnummer", () => {
    assert.equal(
      companyVatNumber({ orgNumber: "5593274086", vatNumber: "DE123456789", country: "Tyskland" }),
      "DE123456789"
    );
    // Svenska regler får inte tvingas på ett utländskt bolag.
    assert.equal(companyVatNumber({ orgNumber: "5593274086", vatNumber: "", country: "Tyskland" }), "");
  });
});

describe("isForeignVatNumberFormat", () => {
  it("kräver landskod plus tecken, inte den svenska mallen", () => {
    assert.equal(isForeignVatNumberFormat("DE123456789"), true);
    assert.equal(isForeignVatNumberFormat("dk 12345678"), true);
    assert.equal(isForeignVatNumberFormat("123456789"), false);
    assert.equal(isForeignVatNumberFormat("D1"), false);
  });
});

describe("postnummer-format", () => {
  it("accepterar 11624 och 116 24 och normaliserar till 116 24", () => {
    assert.equal(formatPostalCode("11624"), "116 24");
    assert.equal(formatPostalCode("116 24"), "116 24");
    assert.equal(normalizePostalCode("11624"), "116 24");
    assert.equal(normalizePostalCode("116 24"), "116 24");
    assert.equal(isPostalCodeFormat("11624"), true);
    assert.equal(isPostalCodeFormat("116 24"), true);
    assert.equal(isPostalCodeFormat("1162"), false);
  });
});
