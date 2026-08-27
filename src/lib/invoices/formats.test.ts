import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatOrgnr, formatVatNumber, isOrgnrFormat, normalizeOrgnr } from "./formats";

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
