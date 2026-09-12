process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taxAccountOcrFromOrgnr } from "./tax-account-model";

/**
 * Kända par från Skatteverkets OCR-beräkning (OCR-10, tio organisationssiffror
 * plus kontrollsiffra). Implementationen får inte användas förrän de stämmer.
 */
describe("skattekonto-OCR", () => {
  it("räknar fram kända par från Skatteverkets OCR-beräkning", () => {
    assert.equal(taxAccountOcrFromOrgnr("556000-0000"), "55600000008");
    assert.equal(taxAccountOcrFromOrgnr("556036-0793"), "55603607932");
    assert.equal(taxAccountOcrFromOrgnr("202100-5489"), "20210054894");
  });

  it("avvisar organisationsnummer som inte har tio siffror", () => {
    assert.throws(() => taxAccountOcrFromOrgnr("556000000"), /tio siffror/);
  });
});
