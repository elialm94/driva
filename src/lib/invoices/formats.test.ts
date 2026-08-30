import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatOrgnr,
  formatPostalCode,
  formatVatNumber,
  isOrgnrFormat,
  isPostalCodeFormat,
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

  it("föreslår momsreg.nr från orgnr-siffrorna", () => {
    assert.equal(formatVatNumber("559123-4567"), "SE559123456701");
    assert.equal(formatVatNumber("SE 559123-4567 abc"), "SE559123456701");
    assert.equal(formatVatNumber("559123"), "");
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
