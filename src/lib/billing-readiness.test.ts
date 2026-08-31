process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "./store";
import { emptyTestDb, labor, testCompany, testCustomer } from "./invoices/test-db";
import { collectBuyerBlockers, collectIssueErrors, collectSellerBlockers } from "./invoices/validate";
import {
  isBusinessLevelBlocker,
  partitionSendBlockers,
  sellerHasPaymentMethod,
  type IssueBlocker,
} from "./invoices/seller-blockers";
import {
  groupBusinessBlockers,
  settingsBillingCopy,
  settingsBillingReadiness,
  settingsFieldHref,
  suggestedVatForCompletion,
} from "./billing-readiness";
import { parseSettingsFalt } from "./settings-routes";
import { createInvoice } from "./services/invoices";
import { billingReadiness } from "./services/settings";
import { createQuote, quoteDefaults, quoteSendBlockers } from "./services/quotes";

function incompleteBusiness(over: Partial<ReturnType<typeof testCompany>> = {}) {
  return testCompany({
    address: "",
    postalCode: "",
    city: "",
    vatNumber: "",
    bankgiro: "",
    plusgiro: undefined,
    bankAccount: undefined,
    iban: undefined,
    ...over,
  });
}

function reset(over: Parameters<typeof emptyTestDb>[0] = {}) {
  replaceDb(emptyTestDb(over));
}

describe("Företags- vs dokumentblockers", () => {
  it("räknar bara företagsnivå i Inställningar – inte kund, rad eller ROT", () => {
    const seller = incompleteBusiness();
    const buyer = testCustomer({ address: "", postalCode: "", city: "" });
    const mixed: IssueBlocker[] = [
      ...collectSellerBlockers(seller),
      ...collectBuyerBlockers(buyer),
      { code: "line_description", message: "Beskrivning saknas på första raden." },
      { code: "personnummer", message: "Göran Eriksson saknar personnummer." },
      { code: "buyer_email", message: "Kunden saknar e-post." },
    ];
    const { business, document } = partitionSendBlockers(mixed);
    assert.ok(business.every((b) => isBusinessLevelBlocker(b.code)));
    assert.ok(document.every((b) => !isBusinessLevelBlocker(b.code)));
    assert.deepEqual(
      business.map((b) => b.code).sort(),
      ["seller_address", "seller_bankgiro", "seller_vat"]
    );
    assert.ok(document.some((b) => b.code === "buyer_address"));
    assert.ok(document.some((b) => b.code === "personnummer"));
    assert.ok(document.some((b) => b.code === "buyer_email"));
    assert.ok(!business.some((b) => b.message.includes("Göran")));
    assert.ok(!business.some((b) => b.message.toLowerCase().includes("e-post")));
  });

  it("settingsBillingReadiness använder samma koder som collectSellerBlockers", () => {
    const seller = incompleteBusiness();
    const canonical = collectSellerBlockers(seller);
    const readiness = settingsBillingReadiness(seller);
    assert.deepEqual(
      readiness.blockers.map((b) => b.code).sort(),
      canonical.map((b) => b.code).sort()
    );
    assert.equal(readiness.missingCount, readiness.items.length);
    assert.equal(readiness.missingCount, 3);
    assert.deepEqual(
      readiness.items.map((i) => i.label),
      ["Företagsadress", "Momsregistreringsnummer", "Betalningsuppgifter"]
    );
    assert.deepEqual(readiness.previewLabels, [
      "Företagsadress",
      "Momsregistreringsnummer",
      "Betalningsuppgifter",
    ]);
    assert.equal(readiness.moreCount, 0);
  });

  it("visar första tre plus N till när fler än tre saker saknas", () => {
    const seller = incompleteBusiness({ name: "", orgNumber: "" });
    const readiness = settingsBillingReadiness(seller);
    assert.ok(readiness.missingCount > 3);
    assert.equal(readiness.previewLabels.length, 3);
    assert.equal(readiness.moreCount, readiness.missingCount - 3);
    assert.equal(readiness.missingCount, readiness.items.length);
  });
});

describe("Fakturering-status: konsekvens och copy", () => {
  it("säger att fakturor inte kan skickas när företagsblockers finns", () => {
    const readiness = settingsBillingReadiness(incompleteBusiness());
    assert.equal(readiness.headline, "Fakturering kan inte användas än");
    assert.equal(readiness.consequence, "3 uppgifter behöver kompletteras innan du kan skicka fakturor.");
    assert.equal(readiness.blocksInvoiceSend, true);
    assert.equal(readiness.mentionsQuotes, false);
    assert.match(readiness.consequence, /fakturor/);
    assert.doesNotMatch(readiness.consequence, /offert/i);
    assert.doesNotMatch(`${readiness.headline} ${readiness.consequence}`, /%|profil är/i);
  });

  it("nämner inte offerter när bara moms och betalning saknas", () => {
    const seller = incompleteBusiness({ address: "Gatan 1", postalCode: "111 22", city: "Stockholm" });
    const readiness = settingsBillingReadiness(seller);
    assert.equal(readiness.blocksQuoteSend, false);
    assert.equal(readiness.blocksInvoiceSend, true);
    assert.equal(readiness.mentionsQuotes, false);
    assert.equal(readiness.missingCount, 2);
    assert.doesNotMatch(readiness.consequence, /offert/i);
    const copy = settingsBillingCopy({
      missingCount: 2,
      blocksInvoiceSend: true,
      blocksQuoteSend: false,
    });
    assert.equal(copy.mentionsQuotes, false);
  });

  it("nämner inte offerter ens när adress också blockerar offert", () => {
    const readiness = settingsBillingReadiness(incompleteBusiness());
    assert.equal(readiness.blocksQuoteSend, true);
    assert.equal(readiness.mentionsQuotes, false);
  });

  it("säger inte 'innan du kan skicka fakturor' om blockers inte ligger i invoice-send", () => {
    const copy = settingsBillingCopy({
      missingCount: 2,
      blocksInvoiceSend: false,
      blocksQuoteSend: false,
    });
    assert.doesNotMatch(copy.consequence, /innan du kan skicka fakturor/);
  });
});

describe("Fylla i en i taget", () => {
  it("räknar ner 3 → 2 → 1 → redo när adress, moms och bankgiro fylls i", () => {
    let seller = incompleteBusiness();
    assert.equal(settingsBillingReadiness(seller).missingCount, 3);
    assert.equal(settingsBillingReadiness(seller).ready, false);

    seller = { ...seller, address: "Renstiernas gata 12", postalCode: "116 24", city: "Stockholm" };
    const afterAddress = settingsBillingReadiness(seller);
    assert.equal(afterAddress.missingCount, 2);
    assert.deepEqual(
      afterAddress.items.map((i) => i.label),
      ["Momsregistreringsnummer", "Betalningsuppgifter"]
    );

    seller = { ...seller, vatNumber: "SE559123456701" };
    const afterVat = settingsBillingReadiness(seller);
    assert.equal(afterVat.missingCount, 1);
    assert.deepEqual(
      afterVat.items.map((i) => i.label),
      ["Betalningsuppgifter"]
    );
    assert.equal(afterVat.items[0].hint, "Lägg till minst ett betalningssätt.");

    seller = { ...seller, bankgiro: "5678-1234" };
    const ready = settingsBillingReadiness(seller);
    assert.equal(ready.missingCount, 0);
    assert.equal(ready.ready, true);
    assert.equal(ready.headline, "Redo att fakturera");
    assert.equal(ready.consequence, "Du har fyllt i allt som krävs för att skicka fakturor.");
    assert.equal(collectSellerBlockers(seller).length, 0);
  });

  it("ett giltigt betalningssätt räcker – inte alla", () => {
    const base = incompleteBusiness({
      address: "Gatan 1",
      postalCode: "111 22",
      city: "Stockholm",
      vatNumber: "SE559123456701",
    });
    assert.equal(sellerHasPaymentMethod(base), false);
    assert.ok(settingsBillingReadiness(base).items.some((i) => i.id === "payment"));

    assert.equal(settingsBillingReadiness({ ...base, bankgiro: "5678-1234" }).ready, true);
    assert.equal(settingsBillingReadiness({ ...base, plusgiro: "123456-1", bankgiro: "" }).ready, true);
    assert.equal(settingsBillingReadiness({ ...base, bankAccount: "1234-567 890 12", bankgiro: "" }).ready, true);
    assert.equal(settingsBillingReadiness({ ...base, iban: "SE4550000000058398257466", bankgiro: "" }).ready, true);
  });
});

describe("Momsreg.nr från org.nr", () => {
  it("föreslår SE + org.nr + 01 när org.nr är giltigt och moms saknas", () => {
    assert.equal(suggestedVatForCompletion("559123-4567", ""), "SE559123456701");
    assert.equal(suggestedVatForCompletion("5591234567", "  "), "SE559123456701");
    assert.equal(suggestedVatForCompletion("559123-4567", "SE559123456701"), null);
    assert.equal(suggestedVatForCompletion("", ""), null);
    assert.equal(suggestedVatForCompletion("123", ""), null);
  });
});

describe("Deeplänkar till rätt fält", () => {
  it("pekar adress, moms och betalning till rätt flik och fält", () => {
    const items = groupBusinessBlockers(collectSellerBlockers(incompleteBusiness()));
    const address = items.find((i) => i.id === "address");
    const vat = items.find((i) => i.id === "vat");
    const payment = items.find((i) => i.id === "payment");
    assert.equal(address?.href, "/installningar?flik=foretag&falt=address");
    assert.equal(address?.fieldId, "installningar-address");
    assert.equal(vat?.href, "/installningar?flik=foretag&falt=vatNumber");
    assert.equal(vat?.fieldId, "installningar-vatNumber");
    assert.equal(payment?.href, "/installningar?flik=fakturering&falt=bankgiro");
    assert.equal(payment?.fieldId, "installningar-bankgiro");
    assert.equal(settingsFieldHref("foretag", "address"), "/installningar?flik=foretag&falt=address");
    assert.equal(parseSettingsFalt("address"), "address");
    assert.equal(parseSettingsFalt("vatNumber"), "vatNumber");
    assert.equal(parseSettingsFalt("bankgiro"), "bankgiro");
    assert.equal(parseSettingsFalt("hack"), null);
  });
});

describe("Efter komplettering: faktura och offert", () => {
  beforeEach(() => reset({ settings: incompleteBusiness(), customers: [testCustomer()] }));

  it("tar bort företagsblockers från fakturans send-lista när uppgifterna fylls i", () => {
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    const before = collectIssueErrors({
      invoice,
      seller: db().settings,
      buyer: db().customers[0],
    });
    assert.ok(before.some((b) => b.code === "seller_address"));
    assert.ok(before.some((b) => b.code === "seller_vat"));
    assert.ok(before.some((b) => b.code === "seller_bankgiro"));
    assert.equal(billingReadiness().missingCount, 3);

    const filled = testCompany();
    db().settings = { ...db().settings, ...filled };
    const after = collectIssueErrors({
      invoice,
      seller: db().settings,
      buyer: db().customers[0],
    });
    assert.ok(!after.some((b) => b.code === "seller_address"));
    assert.ok(!after.some((b) => b.code === "seller_vat"));
    assert.ok(!after.some((b) => b.code === "seller_bankgiro"));
    assert.ok(!after.some((b) => isBusinessLevelBlocker(b.code)));
    assert.equal(settingsBillingReadiness(db().settings).ready, true);
    assert.equal(billingReadiness().ready, true);
  });

  it("blockerar inte Skicka offert för moms eller betalning", () => {
    db().settings = incompleteBusiness({
      address: "Gatan 1",
      postalCode: "111 22",
      city: "Stockholm",
    });
    const defaults = quoteDefaults();
    const quote = createQuote({
      customerId: "cust-1",
      title: "Renovering",
      intro: "",
      lines: [labor()],
      rot: null,
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: defaults.terms,
    });
    const codes = quoteSendBlockers(quote.id).map((b) => b.code);
    assert.ok(!codes.includes("seller_vat"));
    assert.ok(!codes.includes("seller_bankgiro"));
    const readiness = settingsBillingReadiness(db().settings);
    assert.equal(readiness.blocksQuoteSend, false);
    assert.equal(readiness.mentionsQuotes, false);
  });
});
