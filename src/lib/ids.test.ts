process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bankgirotModulus10CheckDigit,
  isValidBankgirotOcr,
  issuedOcrForInvoice,
  ocrForInvoice,
} from "./ids";

/** Äldre Driva-schema: nummer + "77" + Luhn. Används för att visa att giltiga historiska värden behålls. */
function legacyOcrWith77Suffix(invoiceNumber: number): string {
  const base = `${invoiceNumber}77`;
  return base + bankgirotModulus10CheckDigit(base);
}

describe("Bankgirot OCR-10 (mjuk) – kontrollsiffra", () => {
  it("kända Bankgirot-exempel: 16541981 → 3 och 1234567 → 4", () => {
    assert.equal(bankgirotModulus10CheckDigit("16541981"), "3");
    assert.equal(ocrForInvoice(16541981), "165419813");
    assert.ok(isValidBankgirotOcr("165419813"));

    assert.equal(bankgirotModulus10CheckDigit("1234567"), "4");
    assert.equal(ocrForInvoice(1234567), "12345674");
    assert.ok(isValidBankgirotOcr("12345674"));
  });

  it("bas = fakturanumrets siffror + en kontrollsiffra (inte längdsiffra, inte 77-suffix)", () => {
    assert.equal(ocrForInvoice(1042), "10421");
    assert.equal(ocrForInvoice(100), "1008");
    assert.notEqual(ocrForInvoice(1042), legacyOcrWith77Suffix(1042));
    assert.ok(!ocrForInvoice(1042).includes("77"));
  });

  it("produkt > 9 summerar siffrorna (5·2 = 10 → 1)", () => {
    assert.equal(bankgirotModulus10CheckDigit("5"), "9");
    assert.equal(ocrForInvoice(5), "59");
    assert.ok(isValidBankgirotOcr("59"));
  });

  it("verifierar kontrollsiffran och avvisar ogiltiga värden", () => {
    assert.equal(isValidBankgirotOcr(ocrForInvoice(1048)), true);
    assert.equal(isValidBankgirotOcr("165419814"), false);
    assert.equal(isValidBankgirotOcr("legacy"), false);
    assert.equal(isValidBankgirotOcr(""), false);
    assert.equal(isValidBankgirotOcr("1"), false);
  });

  it("issuedOcrForInvoice fyller tomt/ogiltigt och behåller giltigt sparat", () => {
    assert.equal(issuedOcrForInvoice(1042, ""), ocrForInvoice(1042));
    assert.equal(issuedOcrForInvoice(1042, "legacy"), ocrForInvoice(1042));
    const legacy = legacyOcrWith77Suffix(1042);
    assert.ok(isValidBankgirotOcr(legacy));
    assert.equal(issuedOcrForInvoice(1042, legacy), legacy);
    assert.equal(issuedOcrForInvoice(1042, ocrForInvoice(1042)), ocrForInvoice(1042));
  });
});
