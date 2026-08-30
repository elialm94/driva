process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectSellerBlockers } from "./invoices/validate";
import { testCompany } from "./invoices/test-db";
import { addressGapField, settingsBillingGaps } from "./settings-billing-gaps";

const emptyAddr = { address: "", postalCode: "", city: "" };

describe("komplettera-listan på Inställningar", () => {
  it("listar exakt de saknade fälten med fokus-id på samma flik", () => {
    const blockers = collectSellerBlockers(
      testCompany({ orgNumber: "", vatNumber: "", address: "", postalCode: "", city: "" })
    );
    const gaps = settingsBillingGaps(blockers, "foretag", emptyAddr, (h) => h);
    assert.deepEqual(
      gaps.map((g) => g.id),
      ["seller_orgnr", "seller_vat", "seller_address"]
    );
    assert.equal(gaps[0].fieldId, "installningar-orgNumber");
    assert.equal(gaps[0].href, undefined);
    assert.equal(gaps[1].fieldId, "installningar-vatNumber");
    assert.equal(gaps[2].fieldId, "installningar-address");
    assert.ok(gaps.every((g) => g.label && !g.label.includes("företagsuppgifterna")));
  });

  it("adresshålet pekar på första tomma av adress/postnummer/ort", () => {
    assert.equal(addressGapField({ address: "", postalCode: "", city: "" }), "address");
    assert.equal(addressGapField({ address: "Gatan 1", postalCode: "", city: "" }), "postalCode");
    assert.equal(addressGapField({ address: "Gatan 1", postalCode: "116 24", city: "" }), "city");
  });

  it("betalningshål på Företag-fliken blir länk till Fakturering, inte startsidan", () => {
    const blockers = collectSellerBlockers(testCompany({ bankgiro: "", plusgiro: "", iban: "", bankAccount: "" }));
    const gaps = settingsBillingGaps(blockers, "foretag", { address: "Gatan 1", postalCode: "116 24", city: "Stockholm" }, (h) => h);
    const pay = gaps.find((g) => g.id === "seller_bankgiro");
    assert.ok(pay);
    assert.match(pay.href ?? "", /flik=fakturering/);
    assert.match(pay.href ?? "", /#installningar-bankgiro/);
    assert.equal(pay.href?.includes("flik=foretag"), false);
  });

  it("betalningshål på Fakturering-fliken fokuserar bankgiro-fältet", () => {
    const blockers = collectSellerBlockers(testCompany({ bankgiro: "", plusgiro: "", iban: "", bankAccount: "" }));
    const gaps = settingsBillingGaps(blockers, "fakturering", { address: "Gatan 1", postalCode: "116 24", city: "Stockholm" }, (h) => h);
    const pay = gaps.find((g) => g.id === "seller_bankgiro");
    assert.equal(pay?.fieldId, "installningar-bankgiro");
    assert.equal(pay?.href, undefined);
  });
});
